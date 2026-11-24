import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db } from '../config/database';
import { getStorageConfig } from '../config/settings';
import { requireAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/subscriptionGate';
import { uploadFile, deleteFile, getDownloadUrl } from '../services/storage';
import type { Document } from '../types';
import { canonicalRole, roleMaySee } from '../lib/circleRoles';
import { accountIdForProfile, resolveCategoryByName, withCategory } from '../services/documentCategories';
import { contactSummaries, resolveContactInput } from '../services/professionals';
import { attachedTo } from '../services/recordLabels';
import { doneFromItem } from '../services/journeyItems';
import { referralValidity, validityNote, type DocDates } from '../services/documentDates';
import type { Knex } from 'knex';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

export const documentsRouter = Router({ mergeParams: true });

// A category is chosen by name. A name the account has not used before
// becomes a new category, which is how people add one while filing.
const categoryName = z.string().trim().max(100);

// Multipart forms send everything as text: an empty box is "not given",
// and "true" or "false" is a yes or no.
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const dayField = z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()).optional();
const idField = z.preprocess(blankToNull, z.string().uuid().nullable()).optional();
const textField = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable()).optional();
const yesNo = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional();

/**
 * The dates and people a document carries, each its own field: the date it
 * was written, when it runs out (or that it does not), who wrote it and who
 * it is to. A name not in Contacts yet is filed there with what they do.
 */
const documentDetails = {
  issued_on: dayField,
  valid_until: dayField,
  no_expiry: yesNo,
  from_provider_id: idField,
  from_name: textField(255),
  from_type: textField(100),
  from_phone: textField(50),
  to_provider_id: idField,
  to_name: textField(255),
  to_type: textField(100),
  to_phone: textField(50),
};
export type DocumentDetails = {
  issued_on?: string | null;
  valid_until?: string | null;
  no_expiry?: boolean;
  from_provider_id?: string | null;
  from_name?: string | null;
  from_type?: string | null;
  from_phone?: string | null;
  to_provider_id?: string | null;
  to_name?: string | null;
  to_type?: string | null;
  to_phone?: string | null;
};

/** A problem with what was sent, said plainly. */
export class DocumentInputError extends Error {}

/**
 * Save a document's dates and people, then work a referral's dates out.
 * Shared by upload, edit and Pare, so they never drift apart. A person who
 * cannot be used is left off and said in the sentence returned; everything
 * else is still saved.
 */
export async function applyDocumentDetails(conn: Knex | Knex.Transaction, profileId: string, docId: string, data: DocumentDetails): Promise<string | null> {
  let problem: string | null = null;
  const before = (await conn('documents').where({ id: docId }).first('valid_until', 'no_expiry')) as { valid_until: string | null; no_expiry: boolean } | undefined;
  const changes: Record<string, unknown> = {};
  if (data.issued_on !== undefined) changes['issued_on'] = data.issued_on;
  if (data.no_expiry !== undefined) changes['no_expiry'] = data.no_expiry;
  if (data.valid_until !== undefined) {
    changes['valid_until'] = data.valid_until;
    // A date given is a person's; clearing it hands it back to the rule.
    changes['valid_until_worked_out'] = !data.valid_until;
    if (!data.valid_until) {
      changes['valid_from'] = null;
      changes['valid_from_appointment_id'] = null;
    }
  }
  for (const side of ['from', 'to'] as const) {
    const id = data[`${side}_provider_id`];
    const name = data[`${side}_name`];
    if (id === undefined && name === undefined) continue;
    const who = await resolveContactInput(
      conn,
      profileId,
      { id: id ?? null, name: name ?? null, type: data[`${side}_type`] ?? null, phone: data[`${side}_phone`] ?? null },
      side === 'from' ? 'gp' : 'specialist'
    );
    if ('error' in who) {
      problem = who.error;
      continue;
    }
    changes[`${side}_provider_id`] = who.id;
  }
  if (Object.keys(changes).length) await conn('documents').where({ id: docId }).update(changes);
  const moved =
    (data.valid_until !== undefined && String(data.valid_until ?? '') !== String(before?.valid_until ?? '')) ||
    (data.no_expiry !== undefined && data.no_expiry !== before?.no_expiry);
  await referralValidity(conn, docId, { dateChanged: moved });
  return problem;
}

/**
 * Documents as every screen reads them: what each is attached to, who wrote
 * it and who it is to as someone to call, and how its dates were worked out.
 */
export async function documentsOut(profileId: string, docs: Document[]): Promise<Array<Record<string, unknown>>> {
  const ids = docs.map((d) => d.id);
  const people = [...new Set(docs.flatMap((d) => [d.from_provider_id, d.to_provider_id]).filter((v): v is string => !!v))];
  const [links, contacts] = await Promise.all([attachedTo(db, profileId, ids), contactSummaries(db, people, profileId)]);
  return Promise.all(
    docs.map(async (d) => ({
      ...d,
      attached_to: links.get(d.id) ?? [],
      from: (d.from_provider_id && contacts.get(d.from_provider_id)) || null,
      to: (d.to_provider_id && contacts.get(d.to_provider_id)) || null,
      validity_note: await validityNote(db, d as unknown as DocDates),
    }))
  );
}

const documentMeta = z.object({
  ...documentDetails,
  category: categoryName.optional(),
  label: z.string().min(1).max(255),
  // The condition this document came out of, so a scan report files itself
  // under the sore ankle it was taken for.
  medical_condition_id: z.string().uuid().optional().nullable(),
  // Multipart forms deliver a single value as a string and repeated values
  // as an array — accept both.
  visible_to_roles: z
    .preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(z.string()))
    .optional(),
  // Attach the new document to a record as it is filed, e.g. a scan report
  // uploaded from the appointment it came out of.
  // Repeated pairs attach it to several records, such as a next step and
  // the appointment it came from.
  link_entity_type: z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)).max(10)).optional(),
  link_entity_id: z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(z.string().uuid()).max(10)).optional(),
});

const documentUpdate = z.object({
  ...documentDetails,
  category: categoryName.optional(),
  label: z.string().min(1).max(255).optional(),
  visible_to_roles: z.array(z.string().min(1).max(100)).max(50).optional(),
});

// Empty visible_to_roles = visible to the whole circle; otherwise only the
// owner and members whose circle role is in the list can see the document.
// Roles are compared without case, so a document shared with "Carer" is
// seen by someone whose role is "carer".
export function canSeeDocument(req: { careAccess?: { level: string; member: { role: string } | null } }, doc: Document): boolean {
  const roles = Array.isArray(doc.visible_to_roles) ? doc.visible_to_roles : [];
  if (roles.length === 0) return true;
  if (req.careAccess?.level === 'owner') return true;
  return roleMaySee(roles, req.careAccess?.member?.role);
}

/** The roles a document is shared with, in the listed form and without repeats. */
const tidyRoles = (roles: string[] | undefined): string[] | undefined =>
  roles === undefined ? undefined : [...new Set(roles.map(canonicalRole).filter(Boolean))];

documentsRouter.get('/', requireAuth, async (req, res) => {
  const profileId = String(req.params['id']);
  const docs = (await withCategory(db('documents'))
    .where('documents.care_profile_id', profileId)
    .orderBy('documents.created_at', 'desc')) as Document[];
  res.json({ documents: await documentsOut(profileId, docs.filter((d) => canSeeDocument(req, d))) });
});

// S3 storage required for cloud-hosted uploads; local storage available to all
documentsRouter.post(
  '/',
  requireAuth,
  (req, res, next) => {
    if (getStorageConfig().provider === 's3') {
      return requireFeature('s3_storage')(req, res, next);
    }
    next();
  },
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided', code: 'VALIDATION_ERROR' });
      return;
    }

    const parsed = documentMeta.safeParse(
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    );
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
      return;
    }

    const ext = path.extname(req.file.originalname);
    const key = `${req.params['id']}/${Date.now()}${ext}`;
    const fileUrl = await uploadFile(req.file.buffer, key, req.file.mimetype);

    const accountId = (await accountIdForProfile(String(req.params['id'])))!;
    const categoryId = await resolveCategoryByName(accountId, parsed.data.category ?? '');
    const [inserted] = await db<Document>('documents')
      .insert({
        care_profile_id: req.params['id'],
        category_id: categoryId,
        label: parsed.data.label,
        medical_condition_id: parsed.data.medical_condition_id ?? null,
        file_url: fileUrl,
        file_size_bytes: req.file.size,
        mime_type: req.file.mimetype,
        visible_to_roles: tidyRoles(parsed.data.visible_to_roles) ?? [],
      })
      .returning('id');
    const docId = (inserted as { id: string }).id;
    const types = parsed.data.link_entity_type ?? [];
    const ids = parsed.data.link_entity_id ?? [];
    const pairs = types.slice(0, ids.length).map((t, i) => ({ document_id: docId, entity_type: t, entity_id: ids[i]! }));
    if (pairs.length) {
      await db('document_links').insert(pairs).onConflict(['document_id', 'entity_type', 'entity_id']).ignore();
    }
    const profileId = String(req.params['id']);
    // Uploaded from a journey step: the step is done.
    for (const p of pairs.filter((x) => x.entity_type === 'checklists')) {
      await doneFromItem(db, { profileId, itemId: p.entity_id, actorId: req.account!.id });
    }
    // The file and its dates are kept either way; only a person who cannot be used is left off.
    const problem = await applyDocumentDetails(db, profileId, docId, parsed.data);
    const warning = problem ? `The file is saved. ${problem}` : undefined;
    const doc = (await withCategory(db('documents')).where('documents.id', docId).first()) as Document;

    res.status(201).json({ document: (await documentsOut(profileId, [doc]))[0], ...(warning ? { warning } : {}) });
  }
);

documentsRouter.get('/:docId/download', requireAuth, async (req, res) => {
  const doc = await db<Document>('documents')
    .where({ id: req.params['docId'], care_profile_id: req.params['id'] })
    .first();
  if (!doc || !canSeeDocument(req, doc)) {
    res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
    return;
  }

  const url = await getDownloadUrl(doc.file_url);
  res.json({ url });
});

// Streams locally stored files — nothing serves the raw /uploads path.
// S3-stored files are redirected to a presigned URL instead.
documentsRouter.get('/:docId/file', requireAuth, async (req, res) => {
  const doc = await db<Document>('documents')
    .where({ id: req.params['docId'], care_profile_id: req.params['id'] })
    .first();
  if (!doc || !canSeeDocument(req, doc)) {
    res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
    return;
  }

  if (!doc.file_url.startsWith('/uploads/')) {
    res.redirect(await getDownloadUrl(doc.file_url));
    return;
  }

  const localPath = path.resolve(getStorageConfig().localPath, doc.file_url.slice('/uploads/'.length));
  if (doc.mime_type) res.setHeader('Content-Type', doc.mime_type);
  const ext = path.extname(doc.file_url);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.label.replace(/[^\w .-]/g, '_')}${ext}"`);
  res.sendFile(localPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File missing from storage', code: 'NOT_FOUND' });
    }
  });
});

documentsRouter.patch('/:docId', requireAuth, async (req, res) => {
  const parsed = documentUpdate.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const doc = await db<Document>('documents')
    .where({ id: req.params['docId'], care_profile_id: req.params['id'] })
    .first();
  if (!doc || !canSeeDocument(req, doc)) {
    res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
    return;
  }

  const profileId = String(req.params['id']);
  const { category, label, visible_to_roles, ...details } = parsed.data;
  const changes: Record<string, unknown> = {};
  if (label !== undefined) changes['label'] = label;
  if (visible_to_roles !== undefined) changes['visible_to_roles'] = tidyRoles(visible_to_roles);
  if (category !== undefined) {
    const accountId = (await accountIdForProfile(profileId))!;
    changes['category_id'] = await resolveCategoryByName(accountId, category);
  }
  try {
    await db.transaction(async (trx) => {
      if (Object.keys(changes).length) await trx('documents').where({ id: doc.id }).update(changes);
      // Nothing is saved when a person named cannot be used, so the form says why and keeps what was typed.
      const problem = await applyDocumentDetails(trx, profileId, doc.id, details);
      if (problem) throw new DocumentInputError(problem);
    });
  } catch (err) {
    if (err instanceof DocumentInputError) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
  const updated = (await withCategory(db('documents')).where('documents.id', doc.id).first()) as Document;
  res.json({ document: (await documentsOut(profileId, [updated]))[0] });
});

documentsRouter.delete('/:docId', requireAuth, async (req, res) => {
  const doc = await db<Document>('documents')
    .where({ id: req.params['docId'], care_profile_id: req.params['id'] })
    .first();
  if (!doc || !canSeeDocument(req, doc)) {
    res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
    return;
  }

  await deleteFile(doc.file_url).catch((err) => console.warn('File delete failed:', err));
  // Its "Get a new referral" reminder goes with it, unless it is already done.
  if (doc.renewal_task_id) await db('reminders').where({ id: doc.renewal_task_id, completed: false }).delete();
  await db('documents').where({ id: doc.id }).delete();
  res.json({ message: 'Document deleted.' });
});
