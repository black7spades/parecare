import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import type { ChecklistItem, CarePhase } from '../types';

export const checklistsRouter = Router({ mergeParams: true });

checklistsRouter.get('/', requireAuth, async (req, res) => {
  const query = db<ChecklistItem>('checklist_items').where({ care_profile_id: req.params['id'] });
  if (req.query['phase']) {
    query.where('phase', String(req.query['phase']));
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
    phase: z.string().min(1),
    title: z.string().min(1).max(255),
    description: z.string().optional().nullable(),
    sort_order: z.number().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [item] = await db<ChecklistItem>('checklist_items')
    .insert({ care_profile_id: req.params['id'], is_custom: true, ...parsed.data, phase: parsed.data.phase as CarePhase })
    .returning('*');

  res.status(201).json({ item });
});

checklistsRouter.patch('/:itemId', requireAuth, async (req, res) => {
  const schema = z.object({
    completed: z.boolean().optional(),
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional().nullable(),
    // Optional note captured in the same action as ticking the box
    note: z.string().max(5000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const { note, ...fields } = parsed.data;
  const updates: Partial<ChecklistItem> = { ...fields };
  if (parsed.data.completed === true) {
    updates.completed_at = new Date();
  } else if (parsed.data.completed === false) {
    updates.completed_at = null;
    updates.completed_by = null;
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
      'checklist_item_notes.created_at',
      'accounts.display_name as author_name'
    );
  res.json({ notes });
});

checklistsRouter.post('/:itemId/notes', requireAuth, async (req, res) => {
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
  const [note] = await db('checklist_item_notes')
    .insert({ checklist_item_id: item.id, author_account_id: req.account!.id, body: parsed.data.body })
    .returning(['id', 'body', 'created_at']);
  res.status(201).json({ note: { ...note, author_name: req.account!.display_name } });
});

checklistsRouter.delete('/:itemId', requireAuth, async (req, res) => {
  const item = await db('checklist_items')
    .where({ id: req.params['itemId'], care_profile_id: req.params['id'] })
    .first();
  if (!item) {
    res.status(404).json({ error: 'Item not found', code: 'NOT_FOUND' });
    return;
  }
  if (!item.is_custom) {
    res.status(400).json({ error: 'Only custom items can be deleted', code: 'FORBIDDEN' });
    return;
  }
  await db('checklist_items').where({ id: req.params['itemId'] }).delete();
  res.json({ message: 'Item deleted.' });
});
