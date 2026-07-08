import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db } from '../config/database';
import { getStorageConfig } from '../config/settings';
import { requireAuth } from '../middleware/auth';
import { uploadFile, getDownloadUrl } from '../services/storage';
import type { ChecklistItem } from '../types';

const notePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

export const checklistsRouter = Router({ mergeParams: true });

checklistsRouter.get('/', requireAuth, async (req, res) => {
  const query = db<ChecklistItem>('checklist_items').where({ care_profile_id: req.params['id'] });
  if (req.query['phase']) {
    query.where('phase', String(req.query['phase']));
  }
  if (req.query['journey_phase_id']) {
    query.where('care_journey_phase_id', String(req.query['journey_phase_id']));
  }
  const items = await query.orderBy('sort_order', 'asc');

  const counts = await db('checklist_item_notes')
    .join('checklist_items', 'checklist_item_notes.checklist_item_id', 'checklist_items.id')
    .where('checklist_items.care_profile_id', req.params['id'])
    .groupBy('checklist_item_notes.checklist_item_id')
    .select('checklist_item_notes.checklist_item_id')
    .count('checklist_item_notes.id as count');
  const countById = new Map(counts.map((c) => [String(c.checklist_item_id), Number(c.count)]));

  res.json({ items: items.map((i) => ({ ...i, note_count: countById.get(i.id) ?? 0 })) });
});

checklistsRouter.post('/', requireAuth, async (req, res) => {
  const schema = z.object({
    phase: z.string().min(1).optional(),
    care_journey_phase_id: z.string().uuid().optional(),
    title: z.string().min(1).max(255),
    description: z.string().optional().nullable(),
    is_milestone: z.boolean().optional(),
    sort_order: z.number().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || (!parsed.data.phase && !parsed.data.care_journey_phase_id)) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  let phase = parsed.data.phase ?? null;
  if (parsed.data.care_journey_phase_id) {
    // The journey phase must belong to a journey of this profile.
    const journeyPhase = await db('care_journey_phases')
      .join('care_journeys', 'care_journey_phases.care_journey_id', 'care_journeys.id')
      .where('care_journey_phases.id', parsed.data.care_journey_phase_id)
      .where('care_journeys.care_profile_id', req.params['id'])
      .select('care_journey_phases.*')
      .first();
    if (!journeyPhase) {
      res.status(404).json({ error: 'Journey phase not found', code: 'NOT_FOUND' });
      return;
    }
    phase = journeyPhase.legacy_phase;
  }

  const [item] = await db<ChecklistItem>('checklist_items')
    .insert({
      care_profile_id: req.params['id'],
      is_custom: true,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      is_milestone: parsed.data.is_milestone ?? false,
      sort_order: parsed.data.sort_order ?? 0,
      care_journey_phase_id: parsed.data.care_journey_phase_id ?? null,
      phase,
    } as Partial<ChecklistItem>)
    .returning('*');

  res.status(201).json({ item });
});

checklistsRouter.patch('/:itemId', requireAuth, async (req, res) => {
  const schema = z.object({
    completed: z.boolean().optional(),
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional().nullable(),
    // The day it really happened, distinct from when the box was ticked.
    achieved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    is_milestone: z.boolean().optional(),
    // Optional note captured in the same action as ticking the box
    note: z.string().max(5000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const { note, ...fields } = parsed.data;
  const updates: Partial<ChecklistItem> = { ...fields } as Partial<ChecklistItem>;
  if (parsed.data.completed === true) {
    updates.completed_at = new Date();
    if (!parsed.data.achieved_on) updates.achieved_on = new Date().toISOString().slice(0, 10);
    // Record who ticked the box, for the achievements record.
    const member = await db('care_circle_members')
      .where({ care_profile_id: req.params['id'], account_id: req.account!.id, invite_accepted: true })
      .first();
    if (member) updates.completed_by = member.id;
  } else if (parsed.data.completed === false) {
    updates.completed_at = null;
    updates.completed_by = null;
    updates.achieved_on = null;
  }

  const [item] = await db<ChecklistItem>('checklist_items')
    .where({ id: req.params['itemId'], care_profile_id: req.params['id'] })
    .update(updates)
    .returning('*');

  if (!item) {
    res.status(404).json({ error: 'Item not found', code: 'NOT_FOUND' });
    return;
  }

  if (note?.trim()) {
    await db('checklist_item_notes').insert({
      checklist_item_id: item.id,
      author_account_id: req.account!.id,
      body: note.trim(),
    });
  }
  res.json({ item });
});

// The note thread that turns a ticked box into a record: when it happened,
// who was there, and where the information lives now.
checklistsRouter.get('/:itemId/notes', requireAuth, async (req, res) => {
  const notes = await db('checklist_item_notes')
    .leftJoin('accounts', 'checklist_item_notes.author_account_id', 'accounts.id')
    .join('checklist_items', 'checklist_item_notes.checklist_item_id', 'checklist_items.id')
    .where({
      'checklist_item_notes.checklist_item_id': req.params['itemId'],
      'checklist_items.care_profile_id': req.params['id'],
    })
    .orderBy('checklist_item_notes.created_at', 'asc')
    .select(
      'checklist_item_notes.id',
      'checklist_item_notes.body',
      'checklist_item_notes.photo_url',
      'checklist_item_notes.created_at',
      'accounts.display_name as author_name'
    );
  res.json({ notes });
});

// A note can carry a photo: the memory attached to the achievement.
checklistsRouter.post('/:itemId/notes', requireAuth, notePhotoUpload.single('photo'), async (req, res) => {
  const parsed = z.object({ body: z.string().min(1).max(5000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const item = await db('checklist_items')
    .where({ id: req.params['itemId'], care_profile_id: req.params['id'] })
    .first();
  if (!item) {
    res.status(404).json({ error: 'Item not found', code: 'NOT_FOUND' });
    return;
  }
  let photo_url: string | null = null;
  if (req.file) {
    if (!req.file.mimetype.startsWith('image/')) {
      res.status(400).json({ error: 'Only images can be attached to notes', code: 'VALIDATION_ERROR' });
      return;
    }
    const ext = path.extname(req.file.originalname) || '.jpg';
    const key = `checklist-note/${req.params['id']}/${Date.now()}${ext}`;
    photo_url = await uploadFile(req.file.buffer, key, req.file.mimetype);
  }
  const [note] = await db('checklist_item_notes')
    .insert({ checklist_item_id: item.id, author_account_id: req.account!.id, body: parsed.data.body, photo_url })
    .returning(['id', 'body', 'photo_url', 'created_at']);
  res.status(201).json({ note: { ...note, author_name: req.account!.display_name } });
});

checklistsRouter.get('/:itemId/notes/:noteId/photo', requireAuth, async (req, res) => {
  const note = await db('checklist_item_notes')
    .join('checklist_items', 'checklist_item_notes.checklist_item_id', 'checklist_items.id')
    .where({
      'checklist_item_notes.id': req.params['noteId'],
      'checklist_item_notes.checklist_item_id': req.params['itemId'],
      'checklist_items.care_profile_id': req.params['id'],
    })
    .select('checklist_item_notes.photo_url')
    .first();
  if (!note?.photo_url) {
    res.status(404).json({ error: 'Photo not found', code: 'NOT_FOUND' });
    return;
  }
  if (!note.photo_url.startsWith('/uploads/')) {
    res.redirect(await getDownloadUrl(note.photo_url));
    return;
  }
  const localPath = path.join(getStorageConfig().localPath, note.photo_url.slice('/uploads/'.length));
  res.sendFile(localPath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Photo missing from storage', code: 'NOT_FOUND' });
  });
});

// A completed item is part of the person's history, not a to-do row:
// it must be un-completed before it can be deleted, and both actions
// land in the audit log.
checklistsRouter.delete('/:itemId', requireAuth, async (req, res) => {
  const item = await db('checklist_items')
    .where({ id: req.params['itemId'], care_profile_id: req.params['id'] })
    .first();
  if (!item) {
    res.status(404).json({ error: 'Item not found', code: 'NOT_FOUND' });
    return;
  }
  if (item.completed) {
    res.status(400).json({
      error: 'Completed items are part of the record. Un-complete it first if this is a correction.',
      code: 'ITEM_COMPLETED',
    });
    return;
  }
  if (!item.is_custom && !item.care_journey_phase_id) {
    res.status(400).json({ error: 'Only custom items can be deleted', code: 'FORBIDDEN' });
    return;
  }
  await db('checklist_items').where({ id: req.params['itemId'] }).delete();
  res.json({ message: 'Item deleted.' });
});
