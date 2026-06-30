import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import type { ChecklistItem } from '../types';

export const checklistsRouter = Router({ mergeParams: true });

checklistsRouter.get('/', requireAuth, async (req, res) => {
  const query = db<ChecklistItem>('checklist_items').where({ care_profile_id: req.params['id'] });
  if (req.query['phase']) {
    query.where({ phase: req.query['phase'] });
  }
  const items = await query.orderBy('sort_order', 'asc');
  res.json({ items });
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
    .insert({ care_profile_id: req.params['id'], is_custom: true, ...parsed.data })
    .returning('*');

  res.status(201).json({ item });
});

checklistsRouter.patch('/:itemId', requireAuth, async (req, res) => {
  const schema = z.object({
    completed: z.boolean().optional(),
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const updates: Partial<ChecklistItem> = { ...parsed.data };
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
  res.json({ item });
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
