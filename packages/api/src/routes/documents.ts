import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db } from '../config/database';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/subscriptionGate';
import { uploadFile, deleteFile, getDownloadUrl } from '../services/storage';
import type { Document } from '../types';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

export const documentsRouter = Router({ mergeParams: true });

const documentMeta = z.object({
  category: z.enum([
    'poa',
    'will',
    'advance_care_directive',
    'insurance',
    'identity',
    'medical_record',
    'facility_contract',
    'financial',
    'other',
  ]),
  label: z.string().min(1).max(255),
  // Multipart forms deliver a single value as a string and repeated values
  // as an array — accept both.
  visible_to_roles: z
    .preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(z.string()))
    .optional(),
});

// Empty visible_to_roles = visible to the whole circle; otherwise only the
// owner and members whose circle role is in the list can see the document.
function canSeeDocument(req: { careAccess?: { level: string; member: { role: string } | null } }, doc: Document): boolean {
  const roles = Array.isArray(doc.visible_to_roles) ? doc.visible_to_roles : [];
  if (roles.length === 0) return true;
  if (req.careAccess?.level === 'owner') return true;
  const memberRole = req.careAccess?.member?.role;
  return !!memberRole && roles.includes(memberRole);
}

documentsRouter.get('/', requireAuth, async (req, res) => {
  const docs = await db<Document>('documents')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('created_at', 'desc');
  res.json({ documents: docs.filter((d) => canSeeDocument(req, d)) });
});

// S3 storage required for cloud-hosted uploads; local storage available to all
documentsRouter.post(
  '/',
  requireAuth,
  (req, res, next) => {
    if (env.STORAGE_PROVIDER === 's3') {
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

    const [doc] = await db<Document>('documents')
      .insert({
        care_profile_id: req.params['id'],
        category: parsed.data.category,
        label: parsed.data.label,
        file_url: fileUrl,
        file_size_bytes: req.file.size,
        mime_type: req.file.mimetype,
        visible_to_roles: parsed.data.visible_to_roles ?? [],
      })
      .returning('*');

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

  const localPath = path.join(env.STORAGE_LOCAL_PATH, doc.file_url.slice('/uploads/'.length));
  if (doc.mime_type) res.setHeader('Content-Type', doc.mime_type);
  const ext = path.extname(doc.file_url);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.label.replace(/[^\w .-]/g, '_')}${ext}"`);
  res.sendFile(localPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File missing from storage', code: 'NOT_FOUND' });
    }
  });
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
