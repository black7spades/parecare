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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

export const documentsRouter = Router({ mergeParams: true });

// A category is chosen by name. A name the account has not used before
// becomes a new category, which is how people add one while filing.
const categoryName = z.string().trim().max(100);

const documentMeta = z.object({
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
  link_entity_type: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).optional(),
  link_entity_id: z.string().uuid().optional(),
});

const documentUpdate = z.object({
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
  const docs = (await withCategory(db('documents'))
    .where('documents.care_profile_id', req.params['id'])
    .orderBy('documents.created_at', 'desc')) as Document[];
  res.json({ documents: docs.filter((d) => canSeeDocument(req, d)) });
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
    if (parsed.data.link_entity_type && parsed.data.link_entity_id) {
      await db('document_links')
        .insert({ document_id: docId, entity_type: parsed.data.link_entity_type, entity_id: parsed.data.link_entity_id })
        .onConflict(['document_id', 'entity_type', 'entity_id'])
        .ignore();
    }
    const doc = await withCategory(db('documents')).where('documents.id', docId).first();

    res.status(201).json({ document: doc });
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

  const localPath = path.join(getStorageConfig().localPath, doc.file_url.slice('/uploads/'.length));
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

  if (Object.keys(parsed.data).length === 0) {
    res.json({ document: doc });
    return;
  }

  const { category, ...rest } = parsed.data;
  const changes: Record<string, unknown> = { ...rest };
  if (rest.visible_to_roles !== undefined) changes['visible_to_roles'] = tidyRoles(rest.visible_to_roles);
  if (category !== undefined) {
    const accountId = (await accountIdForProfile(String(req.params['id'])))!;
    changes['category_id'] = await resolveCategoryByName(accountId, category);
  }
  await db('documents').where({ id: doc.id }).update(changes);
  const updated = await withCategory(db('documents')).where('documents.id', doc.id).first();
  res.json({ document: updated });
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
  await db('documents').where({ id: doc.id }).delete();
  res.json({ message: 'Document deleted.' });
});
