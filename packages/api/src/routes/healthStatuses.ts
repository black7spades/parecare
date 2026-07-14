import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { resolveConditionCatalogueId } from './conditionCatalogue';
import { resolveSymptomCatalogueId } from './symptomCatalogue';

export const healthStatusesRouter = Router({ mergeParams: true });

const CATEGORIES = ['illness', 'injury', 'post_operative', 'recovery', 'mental_health', 'chronic_flare', 'acute_illness', 'other'] as const;
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

  const [symptoms, docLinks] = await Promise.all([
    statusIds.length > 0
      ? db('health_status_symptoms')
          .whereIn('health_status_id', statusIds)
          .orderBy('noted_at', 'desc')
      : [],
    statusIds.length > 0
      ? db('health_status_documents as hsd')
          .join('documents as d', 'hsd.document_id', 'd.id')
          .whereIn('hsd.health_status_id', statusIds)
          .select('hsd.health_status_id', 'd.id', 'd.category', 'd.label', 'd.file_size_bytes', 'd.mime_type', 'd.created_at')
      : [],
  ]);

  const symptomsByStatus = new Map<string, unknown[]>();
  for (const s of symptoms) {
    const arr = symptomsByStatus.get(s.health_status_id) ?? [];
    arr.push(s);
    symptomsByStatus.set(s.health_status_id, arr);
  }

  const docsByStatus = new Map<string, unknown[]>();
  for (const d of docLinks as Array<Record<string, unknown>>) {
    const arr = docsByStatus.get(d.health_status_id as string) ?? [];
    arr.push({ id: d.id, category: d.category, label: d.label, file_size_bytes: d.file_size_bytes, mime_type: d.mime_type, created_at: d.created_at });
    docsByStatus.set(d.health_status_id as string, arr);
  }

  res.json({
    health_statuses: statuses.map((s: Record<string, unknown>) =>
      serialize({
        ...s,
        symptoms: symptomsByStatus.get(s.id as string) ?? [],
        documents: docsByStatus.get(s.id as string) ?? [],
      })
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
  res.status(201).json({ health_status: serialize({ ...row, symptoms: [], documents: [] }) });
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

// --- Symptoms ---

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
  const catalogueId = await resolveSymptomCatalogueId(parsed.data.name, req.account!.id).catch(() => null);
  const [symptom] = await db('health_status_symptoms')
    .insert({ health_status_id: req.params['statusId'], ...parsed.data, symptom_catalogue_id: catalogueId })
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
  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.name) {
    const catalogueId = await resolveSymptomCatalogueId(parsed.data.name, req.account!.id).catch(() => null);
    if (catalogueId) updates.symptom_catalogue_id = catalogueId;
  }
  const [symptom] = await db('health_status_symptoms')
    .where({ id: req.params['symptomId'], health_status_id: req.params['statusId'] })
    .update(updates)
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

// --- Documents linked to a health status ---

healthStatusesRouter.post('/:statusId/documents', requireAuth, async (req, res) => {
  const parsed = z.object({ document_id: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const status = await db('health_statuses')
    .where({ id: req.params['statusId'], care_profile_id: req.params['id'] })
    .first();
  if (!status) {
    res.status(404).json({ error: 'Health status not found', code: 'NOT_FOUND' });
    return;
  }
  const doc = await db('documents')
    .where({ id: parsed.data.document_id, care_profile_id: req.params['id'] })
    .first();
  if (!doc) {
    res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
    return;
  }
  try {
    await db('health_status_documents').insert({
      health_status_id: req.params['statusId'],
      document_id: parsed.data.document_id,
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.json({ message: 'Already linked.' });
      return;
    }
    throw err;
  }
  res.status(201).json({ message: 'Document linked.' });
});

healthStatusesRouter.delete('/:statusId/documents/:docId', requireAuth, async (req, res) => {
  const deleted = await db('health_status_documents')
    .where({ health_status_id: req.params['statusId'], document_id: req.params['docId'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Link not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Document unlinked.' });
});

// --- Flagged ---

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

// --- Migrate to condition ---

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
