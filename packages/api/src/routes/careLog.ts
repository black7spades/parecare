import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { analyseCareLogSentiment } from '../services/careLogSentiment';
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
  // A person's own 1-to-6 rating (1 angry to 6 overjoyed). When given it is a
  // manual reading and the assistant never overwrites it; null clears it.
  sentiment: z.number().int().min(1).max(6).nullable().optional(),
});

careLogRouter.get('/', requireAuth, async (req, res) => {
  const page = Number(req.query['page'] ?? 1);
  const limit = Math.min(Number(req.query['limit'] ?? 20), 500);
  const offset = (page - 1) * limit;
  // Filters: entry types (comma-separated), free-text search over title and
  // body, and an occurred-at date range. Sort runs oldest or newest first.
  const types = String(req.query['types'] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const q = String(req.query['q'] ?? '').trim();
  const from = String(req.query['from'] ?? '').trim();
  const to = String(req.query['to'] ?? '').trim();
  const sort = req.query['sort'] === 'asc' ? 'asc' : 'desc';

  const filtered = () => {
    let query = db<CareLogEntry>('care_log_entries').where({ care_profile_id: req.params['id'] });
    if (types.length > 0) query = query.whereIn('entry_type', types);
    if (q) query = query.where((qb) => qb.whereILike('title', `%${q}%`).orWhereILike('body', `%${q}%`));
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.where('occurred_at', '>=', from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.where('occurred_at', '<', `${to}T23:59:59.999Z`);
    return query;
  };

  const [entries, countResult] = await Promise.all([
    filtered().orderBy('occurred_at', sort).limit(limit).offset(offset),
    filtered().count<{ count: string }[]>('id as count'),
  ]);

  res.json({ entries, total: Number(countResult[0]?.count ?? 0), page, limit });
});

careLogRouter.post('/', requireAuth, async (req, res) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const { sentiment, ...fields } = parsed.data;
  const manualSentiment = typeof sentiment === 'number';
  const [entry] = await db<CareLogEntry>('care_log_entries')
    .insert({
      care_profile_id: req.params['id'],
      ...fields,
      ...(manualSentiment ? { sentiment, sentiment_source: 'manual' } : {}),
    })
    .returning('*');

  // With no rating given, read the tone of the note in the background so the
  // entry saves immediately and never waits on the model. A hand-set rating is
  // left alone.
  if (!manualSentiment) {
    void analyseCareLogSentiment(entry.id, entry.entry_type, entry.title, entry.body);
  }

  res.status(201).json({ entry });
});

// Bulk edit: apply the same change (e.g. a new entry type) to many entries
// in one go. Only fields in the patch are touched.
careLogRouter.post('/bulk-update', requireAuth, async (req, res) => {
  const parsed = z
    .object({ ids: z.array(z.string().uuid()).min(1).max(500), patch: entrySchema.partial() })
    .safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data.patch).length === 0) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  // Sentiment is per-entry and set on its own, not bulk-applied.
  const { sentiment: _drop, ...patch } = parsed.data.patch;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const updated = await db('care_log_entries')
    .whereIn('id', parsed.data.ids)
    .where({ care_profile_id: req.params['id'] })
    .update(patch);
  res.json({ updated });
});

// Bulk delete: remove many entries in one go.
careLogRouter.post('/bulk-delete', requireAuth, async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const deleted = await db('care_log_entries')
    .whereIn('id', parsed.data.ids)
    .where({ care_profile_id: req.params['id'] })
    .delete();
  res.json({ deleted });
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

  // A rating set here is a person's own; record it as manual so a later
  // analysis leaves it alone. Setting it to null clears the reading entirely.
  const { sentiment, ...fields } = parsed.data;
  const update: Record<string, unknown> = { ...fields };
  if (sentiment !== undefined) {
    update['sentiment'] = sentiment;
    update['sentiment_source'] = sentiment === null ? null : 'manual';
  }

  const [updated] = await db<CareLogEntry>('care_log_entries')
    .where({ id: req.params['entryId'], care_profile_id: req.params['id'] })
    .update(update)
    .returning('*');

  if (!updated) {
    res.status(404).json({ error: 'Entry not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ entry: updated });
});

// Re-read the tone of an entry with the assistant, on demand. This overrides
// whatever is there, including a hand-set rating, since the person asked for it.
careLogRouter.post('/:entryId/analyse-sentiment', requireAuth, async (req, res) => {
  const entry = await db<CareLogEntry>('care_log_entries')
    .where({ id: req.params['entryId'], care_profile_id: req.params['id'] })
    .first();
  if (!entry) {
    res.status(404).json({ error: 'Entry not found', code: 'NOT_FOUND' });
    return;
  }
  // Clear the source so the analysis is allowed to write, then run it inline so
  // the caller gets the result back.
  await db('care_log_entries').where({ id: entry.id }).update({ sentiment_source: null });
  await analyseCareLogSentiment(entry.id, entry.entry_type, entry.title, entry.body);
  const updated = await db<CareLogEntry>('care_log_entries').where({ id: entry.id }).first();
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
