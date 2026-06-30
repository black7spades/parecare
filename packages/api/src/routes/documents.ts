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
  visible_to_roles: z.array(z.string()).optional(),
});

documentsRouter.get('/', requireAuth, async (req, res) => {
  const docs = await db<Document>('documents')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('created_at', 'desc');
  res.json({ documents: docs });
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
  if (!doc) {
    res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
    return;
  }

  const url = await getDownloadUrl(doc.file_url);
  res.json({ url });
});

documentsRouter.delete('/:docId', requireAuth, async (req, res) => {
  const doc = await db<Document>('documents')
    .where({ id: req.params['docId'], care_profile_id: req.params['id'] })
    .first();
  if (!doc) {
    res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
    return;
  }

  await deleteFile(doc.file_url).catch((err) => console.warn('File delete failed:', err));
  await db('documents').where({ id: doc.id }).delete();
  res.json({ message: 'Document deleted.' });
});
