import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import type { CareLogEntry } from '../types';

export const careLogRouter = Router({ mergeParams: true });

const entrySchema = z.object({
  entry_type: z.enum([
    'visit',
    'medication',
    'medical_appointment',
    'phone_call',
    'decision_made',
    'concern_raised',
    'observation',
    'handover',
  ]),
  title: z.string().max(255).optional().nullable(),
  body: z.string().min(1),
  occurred_at: z.string().datetime().optional(),
});

careLogRouter.get('/', requireAuth, async (req, res) => {
  const page = Number(req.query['page'] ?? 1);
  const limit = Math.min(Number(req.query['limit'] ?? 20), 100);
  const offset = (page - 1) * limit;

  const [entries, countResult] = await Promise.all([
    db<CareLogEntry>('care_log_entries')
      .where({ care_profile_id: req.params['id'] })
      .orderBy('occurred_at', 'desc')
      .limit(limit)
      .offset(offset),
    db('care_log_entries')
      .where({ care_profile_id: req.params['id'] })
      .count('id as count')
      .first(),
  ]);

  res.json({ entries, total: Number(countResult?.count ?? 0), page, limit });
});

careLogRouter.post('/', requireAuth, async (req, res) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const [entry] = await db<CareLogEntry>('care_log_entries')
    .insert({ care_profile_id: req.params['id'], ...parsed.data })
    .returning('*');

  res.status(201).json({ entry });
});

careLogRouter.get('/:entryId', requireAuth, async (req, res) => {
  const entry = await db<CareLogEntry>('care_log_entries')
    .where({ id: req.params['entryId'], care_profile_id: req.params['id'] })
    .first();
  if (!entry) {
    res.status(404).json({ error: 'Entry not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ entry });
});

careLogRouter.patch('/:entryId', requireAuth, async (req, res) => {
  const parsed = entrySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [updated] = await db<CareLogEntry>('care_log_entries')
    .where({ id: req.params['entryId'], care_profile_id: req.params['id'] })
    .update(parsed.data)
    .returning('*');

  if (!updated) {
    res.status(404).json({ error: 'Entry not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ entry: updated });
});

careLogRouter.delete('/:entryId', requireAuth, async (req, res) => {
  const affected = await db('care_log_entries')
    .where({ id: req.params['entryId'], care_profile_id: req.params['id'] })
    .delete();
  if (!affected) {
    res.status(404).json({ error: 'Entry not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Entry deleted.' });
});
