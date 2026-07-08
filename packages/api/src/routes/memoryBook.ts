import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db } from '../config/database';
import { getStorageConfig } from '../config/settings';
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
    .leftJoin('checklist_items', 'memory_book_entries.checklist_item_id', 'checklist_items.id')
    .where({ 'memory_book_entries.care_profile_id': req.params['id'] })
    .orderBy('memory_book_entries.created_at', 'desc')
    .select(
      'memory_book_entries.id',
      'memory_book_entries.title',
      'memory_book_entries.body',
      'memory_book_entries.photo_url',
      'memory_book_entries.created_at',
      'memory_book_entries.author_account_id',
      'memory_book_entries.checklist_item_id',
      'checklist_items.title as achievement_title',
      'accounts.display_name as author_name'
    );
  res.json({ entries });
});

/**
 * The achievements database: every completed checklist item for this
 * person across every journey past and present. No copy table; this
 * reads the checklist and journey tables directly, so an achievement
 * can never drift from the item it is.
 */
memoryBookRouter.get('/achievements', requireAuth, async (req, res) => {
  const query = db('checklist_items')
    .leftJoin('care_journey_phases', 'checklist_items.care_journey_phase_id', 'care_journey_phases.id')
    .leftJoin('care_journeys', 'care_journey_phases.care_journey_id', 'care_journeys.id')
    .leftJoin('care_circle_members', 'checklist_items.completed_by', 'care_circle_members.id')
    .where('checklist_items.care_profile_id', req.params['id'])
    .where('checklist_items.completed', true);

  if (req.query['journey_id']) query.where('care_journeys.id', String(req.query['journey_id']));
  if (req.query['journey_phase_id']) query.where('care_journey_phases.id', String(req.query['journey_phase_id']));
  if (req.query['milestone'] === '1') query.where('checklist_items.is_milestone', true);
  if (req.query['q']) query.whereILike('checklist_items.title', `%${String(req.query['q'])}%`);
  if (req.query['from']) query.whereRaw('coalesce(checklist_items.achieved_on, checklist_items.completed_at::date) >= ?', [String(req.query['from'])]);
  if (req.query['to']) query.whereRaw('coalesce(checklist_items.achieved_on, checklist_items.completed_at::date) <= ?', [String(req.query['to'])]);

  const achievements = await query
    .select(
      'checklist_items.id',
      'checklist_items.title',
      'checklist_items.description',
      'checklist_items.achieved_on',
      'checklist_items.completed_at',
      'checklist_items.is_milestone',
      'care_journeys.id as journey_id',
      'care_journeys.name as journey_name',
      'care_journey_phases.id as journey_phase_id',
      'care_journey_phases.name as phase_name',
      'checklist_items.phase as legacy_phase',
      'care_circle_members.display_name as recorded_by_name',
      db.raw(
        '(select count(*) from checklist_item_notes n where n.checklist_item_id = checklist_items.id) as note_count'
      ),
      db.raw(
        '(select count(*) from checklist_item_notes n where n.checklist_item_id = checklist_items.id and n.photo_url is not null) as photo_count'
      ),
      db.raw(
        '(select e.id from memory_book_entries e where e.checklist_item_id = checklist_items.id limit 1) as story_entry_id'
      )
    )
    .orderByRaw('coalesce(checklist_items.achieved_on, checklist_items.completed_at::date) desc nulls last');

  res.json({
    achievements: achievements.map((a) => ({
      ...a,
      note_count: Number(a.note_count ?? 0),
      photo_count: Number(a.photo_count ?? 0),
    })),
  });
});

memoryBookRouter.post('/', requireAuth, upload.single('photo'), async (req, res) => {
  const schema = z.object({
    title: z.string().max(255).optional().nullable(),
    body: z.string().min(1),
    // Write the story: a full entry linked back to an achievement.
    checklist_item_id: z.string().uuid().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (parsed.data.checklist_item_id) {
    const item = await db('checklist_items')
      .where({ id: parsed.data.checklist_item_id, care_profile_id: req.params['id'] })
      .first();
    if (!item) {
      res.status(404).json({ error: 'Achievement not found', code: 'NOT_FOUND' });
      return;
    }
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
      checklist_item_id: parsed.data.checklist_item_id ?? null,
    })
    .returning(['id', 'title', 'body', 'photo_url', 'created_at', 'author_account_id', 'checklist_item_id']);

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
  const localPath = path.join(getStorageConfig().localPath, entry.photo_url.slice('/uploads/'.length));
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
