import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { resolveConditionCatalogueId } from './conditionCatalogue';

export const healthStatusesRouter = Router({ mergeParams: true });

const CATEGORIES = ['acute_illness', 'post_operative', 'recovery'] as const;
const STATUSES = ['active', 'monitoring', 'resolving', 'resolved'] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const healthStatusSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.enum(CATEGORIES),
  status: z.enum(STATUSES).optional(),
  onset_date: z.string().regex(datePattern),
  expected_resolution_date: z.string().regex(datePattern).optional().nullable(),
  actual_resolution_date: z.string().regex(datePattern).optional().nullable(),
  is_contagious: z.boolean().optional(),
  isolation_required: z.boolean().optional(),
  escalation_notes: z.string().max(5000).optional().nullable(),
  region: z.string().max(100).optional().nullable(),
});

const symptomSchema = z.object({
  name: z.string().min(1).max(255),
  severity: z.number().int().min(1).max(5).optional(),
  noted_at: z.string().datetime().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

const dateOrNull = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return datePattern.test(s) ? s.slice(0, 10) : s.slice(0, 10);
};

const serialize = <T extends Record<string, unknown>>(row: T): T => ({
  ...row,
  onset_date: dateOrNull(row['onset_date']),
  expected_resolution_date: dateOrNull(row['expected_resolution_date']),
  actual_resolution_date: dateOrNull(row['actual_resolution_date']),
});

healthStatusesRouter.get('/', requireAuth, async (req, res) => {
  const statuses = await db('health_statuses')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('onset_date', 'desc');

  const statusIds = statuses.map((s: { id: string }) => s.id);
  const symptoms = statusIds.length > 0
    ? await db('health_status_symptoms')
        .whereIn('health_status_id', statusIds)
        .orderBy('noted_at', 'desc')
    : [];

  const symptomsByStatus = new Map<string, unknown[]>();
  for (const s of symptoms) {
    const arr = symptomsByStatus.get(s.health_status_id) ?? [];
    arr.push(s);
    symptomsByStatus.set(s.health_status_id, arr);
  }

  res.json({
    health_statuses: statuses.map((s: Record<string, unknown>) =>
      serialize({ ...s, symptoms: symptomsByStatus.get(s.id as string) ?? [] })
    ),
  });
});

healthStatusesRouter.post('/', requireAuth, async (req, res) => {
  const parsed = healthStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const [row] = await db('health_statuses')
    .insert({ care_profile_id: req.params['id'], ...parsed.data })
    .returning('*');
  res.status(201).json({ health_status: serialize({ ...row, symptoms: [] }) });
});

healthStatusesRouter.patch('/:statusId', requireAuth, async (req, res) => {
  const parsed = healthStatusSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [row] = await db('health_statuses')
    .where({ id: req.params['statusId'], care_profile_id: req.params['id'] })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) {
    res.status(404).json({ error: 'Health status not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ health_status: serialize(row) });
});

healthStatusesRouter.delete('/:statusId', requireAuth, async (req, res) => {
  const deleted = await db('health_statuses')
    .where({ id: req.params['statusId'], care_profile_id: req.params['id'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Health status not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Health status removed.' });
});

healthStatusesRouter.post('/:statusId/symptoms', requireAuth, async (req, res) => {
  const parsed = symptomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const exists = await db('health_statuses')
    .where({ id: req.params['statusId'], care_profile_id: req.params['id'] })
    .first();
  if (!exists) {
    res.status(404).json({ error: 'Health status not found', code: 'NOT_FOUND' });
    return;
  }
  const [symptom] = await db('health_status_symptoms')
    .insert({ health_status_id: req.params['statusId'], ...parsed.data })
    .returning('*');
  res.status(201).json({ symptom });
});

healthStatusesRouter.patch('/:statusId/symptoms/:symptomId', requireAuth, async (req, res) => {
  const parsed = symptomSchema.partial().extend({
    resolved_at: z.string().datetime().optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [symptom] = await db('health_status_symptoms')
    .where({ id: req.params['symptomId'], health_status_id: req.params['statusId'] })
    .update(parsed.data)
    .returning('*');
  if (!symptom) {
    res.status(404).json({ error: 'Symptom not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ symptom });
});

healthStatusesRouter.delete('/:statusId/symptoms/:symptomId', requireAuth, async (req, res) => {
  const deleted = await db('health_status_symptoms')
    .where({ id: req.params['symptomId'], health_status_id: req.params['statusId'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Symptom not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Symptom removed.' });
});

healthStatusesRouter.get('/flagged', requireAuth, async (req, res) => {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - 21);
  const flagged = await db('health_statuses')
    .where({ care_profile_id: req.params['id'] })
    .whereIn('status', ['active', 'monitoring'])
    .where('onset_date', '<', threshold.toISOString().slice(0, 10))
    .orderBy('onset_date', 'asc');
  res.json({ flagged: flagged.map(serialize) });
});

healthStatusesRouter.post('/:statusId/migrate', requireAuth, async (req, res) => {
  const migrateSchema = z.object({
    condition_id: z.string().uuid().optional(),
    new_condition_name: z.string().min(1).max(255).optional(),
  }).refine((d) => d.condition_id || d.new_condition_name, { message: 'Provide condition_id or new_condition_name' });

  const parsed = migrateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const status = await db('health_statuses')
    .where({ id: req.params['statusId'], care_profile_id: req.params['id'] })
    .first();
  if (!status) {
    res.status(404).json({ error: 'Health status not found', code: 'NOT_FOUND' });
    return;
  }

  let conditionId = parsed.data.condition_id;
  if (!conditionId && parsed.data.new_condition_name) {
    const catalogueId = await resolveConditionCatalogueId(parsed.data.new_condition_name, req.account!.id);
    const [condition] = await db('medical_conditions')
      .insert({
        care_profile_id: req.params['id'],
        name: parsed.data.new_condition_name,
        condition_catalogue_id: catalogueId,
        is_temporary: false,
        status: 'active',
        started_on: status.onset_date,
      })
      .returning('*');
    conditionId = condition.id;
  }

  const [updated] = await db('health_statuses')
    .where({ id: req.params['statusId'] })
    .update({ linked_condition_id: conditionId, updated_at: db.fn.now() })
    .returning('*');

  res.json({ health_status: serialize(updated), condition_id: conditionId });
});
