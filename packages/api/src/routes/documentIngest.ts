import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { uploadFile } from '../services/storage';
import { complete, isAiConfigured, type ChatTurn } from '../services/aiProvider';
import { dateInZone } from '../lib/timezone';
import { extractText, buildIngestPrompt } from '../services/documentIngest';
import { executeActions, actionSchema, type AssistantAction } from '../services/aiActions';

/**
 * Pull proposed actions out of the assistant's reply, tolerantly. Models vary:
 * they may key the object on "action" instead of "type", fence the block
 * loosely, or wrap the JSON in prose. Every candidate JSON object is normalised
 * and validated against the real action schema, so only well-formed, known
 * actions survive; anything else is ignored rather than filed.
 */
function parseProposedActions(reply: string): AssistantAction[] {
  const found: AssistantAction[] = [];
  const seen = new Set<string>();
  // Prefer fenced parecare-action blocks; fall back to any fenced/bare object.
  const candidates: string[] = [];
  for (const m of reply.matchAll(/```(?:parecare-action|json)?\s*([\s\S]*?)```/g)) {
    if (m[1]) candidates.push(m[1].trim());
  }
  // Also any bare {...} object that mentions type/action, for models that skip fences.
  for (const m of reply.matchAll(/\{[^{}]*"(?:type|action)"[^{}]*\}/g)) {
    candidates.push(m[0]);
  }
  for (const raw of candidates) {
    // A block may hold several objects; split on the boundary between them.
    const objects = raw.match(/\{[\s\S]*?\}(?=\s*,?\s*(?:\{|$))/g) ?? [raw];
    for (const objText of objects) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(objText.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const obj = parsed as Record<string, unknown>;
      if (obj['type'] === undefined && typeof obj['action'] === 'string') obj['type'] = obj['action'];
      delete obj['action'];
      const result = actionSchema.safeParse(obj);
      if (!result.success) continue;
      const key = JSON.stringify(result.data);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(result.data);
    }
  }
  return found;
}

/**
 * Upload anything (a care plan, an invoice, a business card) and let the
 * assistant read it, say what it is, and file what it finds against this
 * profile. The upload extracts and proposes; a separate apply step commits the
 * changes, so nothing is written to the record without a look first.
 */
export const documentIngestRouter = Router({ mergeParams: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const profileIdOf = (req: { params: unknown }): string => String((req.params as Record<string, string>)['id']);

documentIngestRouter.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file provided', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  const profile = await db('care_profiles').where({ id: profileId }).select('full_name', 'preferred_name').first();
  const name = (profile as { preferred_name?: string; full_name?: string } | undefined);
  const personName = name?.preferred_name || name?.full_name || 'this person';

  // Keep the file: store it as a document on the profile so the source stays.
  const ext = path.extname(req.file.originalname);
  const key = `${profileId}/ingest/${Date.now()}${ext}`;
  const fileUrl = await uploadFile(req.file.buffer, key, req.file.mimetype);
  const [doc] = await db('documents')
    .insert({
      care_profile_id: profileId,
      category: 'other',
      label: req.file.originalname.slice(0, 255),
      file_url: fileUrl,
      file_size_bytes: req.file.size,
      mime_type: req.file.mimetype,
      visible_to_roles: [],
    })
    .returning('id');

  const docId = (doc as { id: string }).id;
  const isImage = req.file.mimetype.startsWith('image/');
  const text = extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
  const haveText = !!text && text.length >= 20;

  if (!isAiConfigured()) {
    res.json({
      document_id: docId,
      text_found: haveText,
      summary: 'The file was saved, but the assistant is not configured, so nothing could be filed automatically. Set up the AI provider in System settings to file uploads.',
      actions: [],
    });
    return;
  }

  // A photo or scan goes to the model as an image, read natively; a text-based
  // file goes as its extracted text. Anything else that yielded no text is kept
  // and left for the person to file by hand.
  let userTurn: ChatTurn;
  if (haveText) {
    userTurn = { role: 'user', content: text.slice(0, 12000) };
  } else if (isImage) {
    userTurn = {
      role: 'user',
      content: [
        { type: 'text', text: 'The document is the attached image. Read it and file what you find.' },
        { type: 'image', media_type: req.file.mimetype, data: req.file.buffer.toString('base64') },
      ],
    };
  } else {
    res.json({
      document_id: docId,
      text_found: false,
      summary: 'The file was saved, but no readable text could be pulled from it. You can still file its details by hand.',
      actions: [],
    });
    return;
  }

  const today = dateInZone(new Date(), (req.headers['x-time-zone'] as string) || null);
  // Addresses already on file in this account, so the assistant can tell the
  // person's own address (the "invoice to") from a vendor's and not file it.
  const account = await db('care_profiles').where({ id: profileId }).select('account_id').first();
  const knownRows = account
    ? await db('addresses').where({ account_id: (account as { account_id: string }).account_id }).select('formatted').limit(30)
    : [];
  const knownAddresses = knownRows.map((r) => (r as { formatted: string | null }).formatted).filter((v): v is string => !!v);
  const system = buildIngestPrompt(personName, today, knownAddresses);

  try {
    // Reading a whole document is a heavy, rare job worth the best model available.
    const result = await complete(system, [userTurn], 1500, 'mediation');
    const actions = parseProposedActions(result.text);
    // The summary is the model's prose with any fenced blocks removed.
    const summary = result.text.replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
    res.json({
      document_id: docId,
      text_found: haveText,
      summary: summary || (isImage ? 'Read the photo.' : 'Read the document.'),
      actions,
    });
  } catch (err) {
    // The file is already saved, so a model that is still warming up or cannot
    // read this kind of file never costs the capture. Say which, plainly.
    const preparing = (err as { code?: string }).code === 'AI_MODEL_PREPARING';
    res.json({
      document_id: docId,
      text_found: haveText,
      summary: preparing
        ? 'The file was saved. The assistant on this machine is still getting ready, so it could not be read yet. Try again in a moment, or file its details by hand.'
        : 'The file was saved, but the assistant could not read it automatically. You can still file its details by hand.',
      actions: [],
    });
  }
});

const applySchema = z.object({ actions: z.array(z.unknown()).min(1).max(50) });

documentIngestRouter.post('/apply', requireAuth, async (req, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  // Re-validate each action against the real schema before executing, so only
  // known, well-formed actions are ever run.
  const valid: AssistantAction[] = [];
  const errors: string[] = [];
  for (const raw of parsed.data.actions) {
    const a = actionSchema.safeParse(raw);
    if (a.success) valid.push(a.data);
    else errors.push('Skipped an item that was not a valid action.');
  }
  const outcomes = await executeActions(valid, profileIdOf(req), req.account!, req.careAccess!, (req.headers['x-time-zone'] as string) || null);
  res.json({ outcomes: [...outcomes, ...errors] });
});
