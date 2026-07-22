import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { uploadFile } from '../services/storage';
import { complete, isAiConfigured } from '../services/aiProvider';
import { dateInZone } from '../lib/timezone';
import { extractText, buildIngestPrompt } from '../services/documentIngest';
import { extractActions, executeActions, actionSchema, type AssistantAction } from '../services/aiActions';

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

  const text = extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
  if (!text || text.length < 20) {
    res.json({
      document_id: (doc as { id: string }).id,
      text_found: false,
      summary: 'The file was saved, but no readable text could be pulled from it. A scanned image or photo needs a vision-capable assistant, which is not set up yet. You can still file its details by hand.',
      actions: [],
    });
    return;
  }
  if (!isAiConfigured()) {
    res.json({
      document_id: (doc as { id: string }).id,
      text_found: true,
      summary: 'The file was saved and its text was read, but the assistant is not configured, so nothing could be filed automatically. Set up the AI provider in System settings to file uploads.',
      actions: [],
    });
    return;
  }

  const today = dateInZone(new Date(), (req.headers['x-time-zone'] as string) || null);
  const system = buildIngestPrompt(personName, today);
  const result = await complete(system, [{ role: 'user', content: text.slice(0, 12000) }], 1500, 'chat');
  const { actions, parseErrors } = extractActions(result.text);

  res.json({
    document_id: (doc as { id: string }).id,
    text_found: true,
    summary: result.text.replace(/```parecare-action[\s\S]*?```/g, '').trim(),
    actions,
    parse_errors: parseErrors,
  });
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
