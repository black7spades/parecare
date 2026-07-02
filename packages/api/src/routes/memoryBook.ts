import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db } from '../config/database';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { uploadFile, deleteFile, getDownloadUrl } from '../services/storage';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB — photos only
});

export const memoryBookRouter = Router({ mergeParams: true });

memoryBookRouter.get('/', requireAuth, async (req, res) => {
  const entries = await db('memory_book_entries')
    .leftJoin('accounts', 'memory_book_entries.author_account_id', 'accounts.id')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('memory_book_entries.created_at', 'desc')
    .select(
      'memory_book_entries.id',
      'memory_book_entries.title',
      'memory_book_entries.body',
      'memory_book_entries.photo_url',
      'memory_book_entries.created_at',
      'memory_book_entries.author_account_id',
      'accounts.display_name as author_name'
    );
  res.json({ entries });
});

memoryBookRouter.post('/', requireAuth, upload.single('photo'), async (req, res) => {
  const schema = z.object({
    title: z.string().max(255).optional().nullable(),
    body: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  let photo_url: string | null = null;
  if (req.file) {
    if (!req.file.mimetype.startsWith('image/')) {
      res.status(400).json({ error: 'Only images can be attached to memories', code: 'VALIDATION_ERROR' });
      return;
    }
    const ext = path.extname(req.file.originalname) || '.jpg';
    const key = `memory/${req.params['id']}/${Date.now()}${ext}`;
    photo_url = await uploadFile(req.file.buffer, key, req.file.mimetype);
  }

  const [entry] = await db('memory_book_entries')
    .insert({
      care_profile_id: req.params['id'],
      author_account_id: req.account!.id,
      title: parsed.data.title || null,
      body: parsed.data.body,
      photo_url,
    })
    .returning(['id', 'title', 'body', 'photo_url', 'created_at', 'author_account_id']);

  res.status(201).json({ entry: { ...entry, author_name: req.account!.display_name } });
});

memoryBookRouter.get('/:entryId/photo', requireAuth, async (req, res) => {
  const entry = await db('memory_book_entries')
    .where({ id: req.params['entryId'], care_profile_id: req.params['id'] })
    .first();
  if (!entry?.photo_url) {
    res.status(404).json({ error: 'Photo not found', code: 'NOT_FOUND' });
    return;
  }
  if (!entry.photo_url.startsWith('/uploads/')) {
    res.redirect(await getDownloadUrl(entry.photo_url));
    return;
  }
  const localPath = path.join(env.STORAGE_LOCAL_PATH, entry.photo_url.slice('/uploads/'.length));
  res.sendFile(localPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Photo missing from storage', code: 'NOT_FOUND' });
    }
  });
});

memoryBookRouter.delete('/:entryId', requireAuth, async (req, res) => {
  const entry = await db('memory_book_entries')
    .where({ id: req.params['entryId'], care_profile_id: req.params['id'] })
    .first();
  if (!entry) {
    res.status(404).json({ error: 'Entry not found', code: 'NOT_FOUND' });
    return;
  }
  const profile = await db('care_profiles').where({ id: req.params['id'] }).first();
  const isAuthor = entry.author_account_id === req.account!.id;
  const isOwner = profile?.account_id === req.account!.id;
  if (!isAuthor && !isOwner) {
    res.status(403).json({ error: 'Only the author or the profile owner can remove a memory', code: 'FORBIDDEN' });
    return;
  }
  if (entry.photo_url) await deleteFile(entry.photo_url).catch(() => {});
  await db('memory_book_entries').where({ id: entry.id }).delete();
  res.json({ message: 'Memory removed.' });
});
