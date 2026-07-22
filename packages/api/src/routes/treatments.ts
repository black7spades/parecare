import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireProfileOwner } from '../middleware/permissions';
import { resolveConditionId } from './medications';

/**
 * Treatments are the umbrella for everything done to manage a condition
 * beyond medications: device therapies (CPAP, oxygen), physiotherapy,
 * wound care, exercise programs and so on. Each treatment defines its own
 * measures — what one session records, in the unit the device or therapy
 * actually reports — and every session is logged as an observation whose
 * readings sit one per row.
 */

export const treatmentsRouter = Router({ mergeParams: true });

export const TREATMENT_CATEGORIES = [
  'device',
  'therapy',
  'exercise',
  'wound_care',
  'diet',
  'surgery',
  'lifestyle',
  'assistive_device',
  'other',
] as const;
export const TREATMENT_STATUSES = ['active', 'completed', 'discontinued'] as const;
export const METRIC_VALUE_TYPES = ['number', 'text', 'yes_no'] as const;
export const OBSERVATION_STATUSES = ['completed', 'partial', 'skipped', 'refused'] as const;

const metricSchema = z.object({
  name: z.string().min(1).max(255),
  unit: z.string().max(50).optional().nullable(),
  value_type: z.enum(METRIC_VALUE_TYPES).default('number'),
  sort_order: z.number().int().optional(),
});

const treatmentSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.enum(TREATMENT_CATEGORIES).default('other'),
  medical_condition_id: z.string().uuid().optional().nullable(),
  // Free-typed condition, resolved to an existing one or created.
  medical_condition_name: z.string().max(255).optional().nullable(),
  instructions: z.string().max(4000).optional().nullable(),
  frequency: z.string().max(255).optional().nullable(),
  schedule_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).optional().nullable(),
  as_needed: z.boolean().optional(),
  active: z.boolean().optional(),
  // Where the treatment stands in its lifecycle, and when the plan was
  // last reviewed. current_status supersedes the bare active flag; the two
  // are kept in sync for existing callers.
  current_status: z.enum(TREATMENT_STATUSES).optional(),
  last_review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  // Accepted on create so a treatment and its measures are set up in one go.
  metrics: z.array(metricSchema).max(20).optional(),
});

async function metricsFor(treatmentIds: string[]): Promise<Map<string, unknown[]>> {
  if (treatmentIds.length === 0) return new Map();
  const rows = await db('treatment_metrics')
    .whereIn('treatment_id', treatmentIds)
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'created_at', order: 'asc' }]);
  const byTreatment = new Map<string, unknown[]>();
  for (const r of rows) {
    const arr = byTreatment.get(r.treatment_id) ?? [];
    arr.push(r);
    byTreatment.set(r.treatment_id, arr);
  }
  return byTreatment;
}

const treatmentSelect = () =>
  db('treatments as t')
    .leftJoin('medical_conditions as mc', 't.medical_condition_id', 'mc.id')
    .select('t.*', 'mc.name as condition_name');

async function treatmentWithMetrics(id: string): Promise<Record<string, unknown> | null> {
  const treatment = await treatmentSelect().where('t.id', id).first();
  if (!treatment) return null;
  const metrics = await metricsFor([id]);
  return { ...treatment, metrics: metrics.get(id) ?? [] };
}

// Shared field mapping for create and edit, resolving the condition tie
// from either an id or a free-typed name.
async function treatmentFieldsFrom(
  data: Partial<z.infer<typeof treatmentSchema>>,
  profileId: string
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  if ('name' in data) fields['name'] = data.name;
  if ('category' in data) fields['category'] = data.category;
  if ('instructions' in data) fields['instructions'] = data.instructions ?? null;
  if ('frequency' in data) fields['frequency'] = data.frequency ?? null;
  if ('as_needed' in data) fields['as_needed'] = data.as_needed ?? false;
  // current_status is the source of truth; active mirrors it. A bare
  // active toggle from an older caller updates both.
  if (data.current_status !== undefined) {
    fields['current_status'] = data.current_status;
    fields['active'] = data.current_status === 'active';
  } else if ('active' in data) {
    fields['active'] = data.active ?? true;
    fields['current_status'] = data.active === false ? 'discontinued' : 'active';
  }
  if ('last_review_date' in data) fields['last_review_date'] = data.last_review_date ?? null;
  if (data.schedule_times !== undefined) {
    fields['schedule_times'] = data.schedule_times ? db.raw('?::jsonb', [JSON.stringify(data.schedule_times)]) : null;
  }
  if ('medical_condition_name' in data) {
    fields['medical_condition_id'] = await resolveConditionId(data.medical_condition_name, profileId);
  } else if ('medical_condition_id' in data) {
    fields['medical_condition_id'] = data.medical_condition_id ?? null;
  }
  return fields;
}

treatmentsRouter.get('/', requireAuth, async (req, res) => {
  const treatments = await treatmentSelect()
    .where('t.care_profile_id', req.params['id'])
    .orderBy([{ column: 't.active', order: 'desc' }, { column: 't.name', order: 'asc' }]);
  const ids = treatments.map((t) => t.id);
  const metrics = await metricsFor(ids);
  // The most recent session per treatment, so the list shows freshness.
  const lastObserved: Array<{ treatment_id: string; last_observed_at: Date }> = ids.length
    ? ((await db('observations')
        .whereIn('treatment_id', ids)
        .select('treatment_id')
        .max({ last_observed_at: 'observed_at' })
        .groupBy('treatment_id')) as unknown as Array<{ treatment_id: string; last_observed_at: Date }>)
    : [];
  const lastByTreatment = new Map(lastObserved.map((r) => [r.treatment_id, r.last_observed_at]));
  res.json({
    treatments: treatments.map((t) => ({
      ...t,
      metrics: metrics.get(t.id) ?? [],
      last_observed_at: lastByTreatment.get(t.id) ?? null,
    })),
  });
});

// A condition tie must stay within this person's own conditions.
async function conditionBelongsToProfile(conditionId: string | null | undefined, profileId: string): Promise<boolean> {
  if (!conditionId) return true;
  const row = await db('medical_conditions').where({ id: conditionId, care_profile_id: profileId }).first();
  return !!row;
}

treatmentsRouter.post('/', requireAuth, requireProfileOwner, async (req, res) => {
  const parsed = treatmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!(await conditionBelongsToProfile(parsed.data.medical_condition_id, req.params['id']!))) {
    res.status(400).json({ error: 'Condition not found', code: 'VALIDATION_ERROR' });
    return;
  }
  const fields = await treatmentFieldsFrom(parsed.data, req.params['id']!);
  const [created] = await db('treatments')
    .insert({ care_profile_id: req.params['id'], ...fields })
    .returning('id');
  const treatmentId = (created as { id: string }).id;
  if (parsed.data.metrics && parsed.data.metrics.length > 0) {
    await db('treatment_metrics').insert(
      parsed.data.metrics.map((m, i) => ({
        treatment_id: treatmentId,
        name: m.name,
        unit: m.unit ?? null,
        value_type: m.value_type,
        sort_order: m.sort_order ?? i,
      }))
    );
  }
  res.status(201).json({ treatment: await treatmentWithMetrics(treatmentId) });
});

treatmentsRouter.patch('/:treatmentId', requireAuth, requireProfileOwner, async (req, res) => {
  const parsed = treatmentSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!(await conditionBelongsToProfile(parsed.data.medical_condition_id, req.params['id']!))) {
    res.status(400).json({ error: 'Condition not found', code: 'VALIDATION_ERROR' });
    return;
  }
  const fields = await treatmentFieldsFrom(parsed.data, req.params['id']!);
  const [updated] = await db('treatments')
    .where({ id: req.params['treatmentId'], care_profile_id: req.params['id'] })
    .update({ ...fields, updated_at: db.fn.now() })
    .returning('id');
  if (!updated) {
    res.status(404).json({ error: 'Treatment not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ treatment: await treatmentWithMetrics((updated as { id: string }).id) });
});

treatmentsRouter.delete('/:treatmentId', requireAuth, requireProfileOwner, async (req, res) => {
  const deleted = await db('treatments')
    .where({ id: req.params['treatmentId'], care_profile_id: req.params['id'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Treatment not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Treatment removed.' });
});

// Look up a treatment scoped to this profile, shared by the sub-resources.
async function findTreatment(treatmentId: string | undefined, profileId: string | undefined) {
  return db('treatments').where({ id: treatmentId, care_profile_id: profileId }).first();
}

// ---- Measures -------------------------------------------------------------

treatmentsRouter.post('/:treatmentId/metrics', requireAuth, requireProfileOwner, async (req, res) => {
  const treatment = await findTreatment(req.params['treatmentId'], req.params['id']);
  if (!treatment) {
    res.status(404).json({ error: 'Treatment not found', code: 'NOT_FOUND' });
    return;
  }
  const parsed = metricSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [metric] = await db('treatment_metrics')
    .insert({
      treatment_id: treatment.id,
      name: parsed.data.name,
      unit: parsed.data.unit ?? null,
      value_type: parsed.data.value_type,
      sort_order: parsed.data.sort_order ?? 0,
    })
    .returning('*');
  res.status(201).json({ metric });
});

treatmentsRouter.patch('/:treatmentId/metrics/:metricId', requireAuth, requireProfileOwner, async (req, res) => {
  const treatment = await findTreatment(req.params['treatmentId'], req.params['id']);
  if (!treatment) {
    res.status(404).json({ error: 'Treatment not found', code: 'NOT_FOUND' });
    return;
  }
  const parsed = metricSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [metric] = await db('treatment_metrics')
    .where({ id: req.params['metricId'], treatment_id: treatment.id })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!metric) {
    res.status(404).json({ error: 'Measure not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ metric });
});

treatmentsRouter.delete('/:treatmentId/metrics/:metricId', requireAuth, requireProfileOwner, async (req, res) => {
  const treatment = await findTreatment(req.params['treatmentId'], req.params['id']);
  if (!treatment) {
    res.status(404).json({ error: 'Treatment not found', code: 'NOT_FOUND' });
    return;
  }
  const deleted = await db('treatment_metrics').where({ id: req.params['metricId'], treatment_id: treatment.id }).delete();
  if (!deleted) {
    res.status(404).json({ error: 'Measure not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Measure removed. Past readings against it are removed too.' });
});

// ---- Observations ----------------------------------------------------------

// A reading arrives as the metric it belongs to plus one value in the field
// matching the metric's type.
const readingSchema = z.object({
  treatment_metric_id: z.string().uuid(),
  value_number: z.number().finite().optional().nullable(),
  value_text: z.string().max(2000).optional().nullable(),
  value_boolean: z.boolean().optional().nullable(),
});

const observationSchema = z.object({
  observed_at: z.string().optional().nullable(),
  status: z.enum(OBSERVATION_STATUSES).default('completed'),
  notes: z.string().max(4000).optional().nullable(),
  values: z.array(readingSchema).max(50).optional(),
});

// Statuses other than completed need their reason recorded.
const OBS_NOTE_OPTIONAL = new Set(['completed']);
const FUTURE_SKEW_MS = 60 * 1000;
const isFutureTime = (s?: string | null): boolean => !!s && new Date(s).getTime() > Date.now() + FUTURE_SKEW_MS;

// Attach each observation's readings (with the measure's name and unit) so
// one query serves the whole page.
async function valuesFor(observationIds: string[]): Promise<Map<string, unknown[]>> {
  if (observationIds.length === 0) return new Map();
  const rows = await db('observation_values as v')
    .join('treatment_metrics as m', 'v.treatment_metric_id', 'm.id')
    .whereIn('v.observation_id', observationIds)
    .select(
      'v.id', 'v.observation_id', 'v.treatment_metric_id',
      'v.value_number', 'v.value_text', 'v.value_boolean',
      'm.name as metric_name', 'm.unit as metric_unit', 'm.value_type as metric_value_type', 'm.sort_order as metric_sort_order'
    )
    .orderBy('m.sort_order', 'asc');
  const byObservation = new Map<string, unknown[]>();
  for (const r of rows) {
    const arr = byObservation.get(r.observation_id) ?? [];
    arr.push({ ...r, value_number: r.value_number === null ? null : Number(r.value_number) });
    byObservation.set(r.observation_id, arr);
  }
  return byObservation;
}

// The observation log: chronological, filterable by treatment, outcome,
// source and time window, cursor-paginated like the MAR log.
treatmentsRouter.get('/observations', requireAuth, async (req, res) => {
  const profileId = String(req.params['id']);
  const treatmentId = String(req.query['treatment_id'] ?? '').trim();
  const status = String(req.query['status'] ?? '').trim();
  const source = String(req.query['source'] ?? '').trim();
  const from = req.query['from'] ? new Date(String(req.query['from'])) : null;
  const to = req.query['to'] ? new Date(String(req.query['to'])) : null;
  const order = String(req.query['sort'] ?? 'recent') === 'oldest' ? 'asc' : 'desc';
  const limit = Math.min(200, Math.max(1, Number(req.query['limit']) || 50));
  const cursor = req.query['cursor'] ? new Date(String(req.query['cursor'])) : null;

  const observations: Array<Record<string, unknown> & { id: string; observed_at: Date }> = await db('observations as o')
    .join('treatments as t', 'o.treatment_id', 't.id')
    .where('o.care_profile_id', profileId)
    .modify((qb) => {
      if (treatmentId) qb.where('o.treatment_id', treatmentId);
      if (status) qb.where('o.status', status);
      if (source) qb.where('o.source', source);
      if (from) qb.where('o.observed_at', '>=', from);
      if (to) qb.where('o.observed_at', '<=', to);
      if (cursor) qb.where('o.observed_at', order === 'asc' ? '>' : '<', cursor);
    })
    .select('o.*', 't.name as treatment_name', 't.category as treatment_category')
    .orderBy('o.observed_at', order)
    .limit(limit);

  const values = await valuesFor(observations.map((o) => o.id));
  const nextCursor = observations.length === limit ? observations[observations.length - 1].observed_at : null;
  res.json({
    observations: observations.map((o) => ({ ...o, values: values.get(o.id) ?? [] })),
    nextCursor,
  });
});

// Validate readings against the treatment's own measures and shape the rows.
async function buildValueRows(
  values: z.infer<typeof readingSchema>[] | undefined,
  treatmentId: string
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string }> {
  if (!values || values.length === 0) return { ok: true, rows: [] };
  const metrics = await db('treatment_metrics').where({ treatment_id: treatmentId });
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const rows: Record<string, unknown>[] = [];
  for (const v of values) {
    const metric = byId.get(v.treatment_metric_id);
    if (!metric) return { ok: false, error: 'A reading points at a measure that does not belong to this treatment.' };
    rows.push({
      treatment_metric_id: v.treatment_metric_id,
      value_number: metric.value_type === 'number' ? v.value_number ?? null : null,
      value_text: metric.value_type === 'text' ? v.value_text ?? null : null,
      value_boolean: metric.value_type === 'yes_no' ? v.value_boolean ?? null : null,
    });
  }
  return { ok: true, rows };
}

treatmentsRouter.post('/:treatmentId/observations', requireAuth, async (req, res) => {
  const treatment = await findTreatment(req.params['treatmentId'], req.params['id']);
  if (!treatment) {
    res.status(404).json({ error: 'Treatment not found', code: 'NOT_FOUND' });
    return;
  }
  const parsed = observationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!OBS_NOTE_OPTIONAL.has(parsed.data.status) && !parsed.data.notes?.trim()) {
    res.status(400).json({ error: 'A note is required when the session was not completed.', code: 'NOTE_REQUIRED' });
    return;
  }
  if (isFutureTime(parsed.data.observed_at)) {
    res.status(400).json({ error: 'You cannot log a session in the future.', code: 'FUTURE_TIME' });
    return;
  }
  const built = await buildValueRows(parsed.data.values, treatment.id);
  if (!built.ok) {
    res.status(400).json({ error: built.error, code: 'VALIDATION_ERROR' });
    return;
  }
  const [observation] = await db('observations')
    .insert({
      care_profile_id: req.params['id'],
      treatment_id: treatment.id,
      observed_at: parsed.data.observed_at ? new Date(parsed.data.observed_at) : db.fn.now(),
      recorded_by_account_id: req.account!.id,
      recorded_by_name: req.account!.display_name,
      source: 'manual',
      status: parsed.data.status,
      notes: parsed.data.notes ?? null,
    })
    .returning('*');
  if (built.rows.length > 0) {
    await db('observation_values').insert(built.rows.map((r) => ({ ...r, observation_id: observation.id })));
  }
  const values = await valuesFor([observation.id]);
  res.status(201).json({ observation: { ...observation, values: values.get(observation.id) ?? [] } });
});

const observationEditSchema = z.object({
  observed_at: z.string().optional(),
  status: z.enum(OBSERVATION_STATUSES).optional(),
  notes: z.string().max(4000).optional().nullable(),
  // Replaces the recorded readings when present.
  values: z.array(readingSchema).max(50).optional(),
});

// Correct a logged session: when it happened, how it went, the note, or the
// readings themselves.
treatmentsRouter.patch('/observations/:observationId', requireAuth, async (req, res) => {
  const observation = await db('observations')
    .where({ id: req.params['observationId'], care_profile_id: req.params['id'] })
    .first();
  if (!observation) {
    res.status(404).json({ error: 'Observation not found', code: 'NOT_FOUND' });
    return;
  }
  const parsed = observationEditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (isFutureTime(parsed.data.observed_at)) {
    res.status(400).json({ error: 'You cannot log a session in the future.', code: 'FUTURE_TIME' });
    return;
  }
  const update: Record<string, unknown> = {};
  if (parsed.data.observed_at !== undefined) update['observed_at'] = new Date(parsed.data.observed_at);
  if (parsed.data.notes !== undefined) update['notes'] = parsed.data.notes?.trim() ? parsed.data.notes.trim() : null;
  if (parsed.data.status !== undefined) {
    update['status'] = parsed.data.status;
    if (!OBS_NOTE_OPTIONAL.has(parsed.data.status)) {
      const note = parsed.data.notes !== undefined ? parsed.data.notes : observation.notes;
      if (!note?.trim()) {
        res.status(400).json({ error: 'A note is required when the session was not completed.', code: 'NOTE_REQUIRED' });
        return;
      }
    }
  }
  if (parsed.data.values !== undefined) {
    const built = await buildValueRows(parsed.data.values, observation.treatment_id);
    if (!built.ok) {
      res.status(400).json({ error: built.error, code: 'VALIDATION_ERROR' });
      return;
    }
    await db('observation_values').where({ observation_id: observation.id }).delete();
    if (built.rows.length > 0) {
      await db('observation_values').insert(built.rows.map((r) => ({ ...r, observation_id: observation.id })));
    }
  }
  if (Object.keys(update).length > 0) {
    await db('observations').where({ id: observation.id }).update(update);
  }
  const fresh = await db('observations').where({ id: observation.id }).first();
  const values = await valuesFor([observation.id]);
  res.json({ observation: { ...fresh, values: values.get(observation.id) ?? [] } });
});

treatmentsRouter.delete('/observations/:observationId', requireAuth, async (req, res) => {
  const deleted = await db('observations')
    .where({ id: req.params['observationId'], care_profile_id: req.params['id'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Observation not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Observation removed.' });
});

// ---- Device keys ------------------------------------------------------------

export const hashDeviceToken = (token: string): string => createHash('sha256').update(token).digest('hex');

// Everything about a key except its secret, for listings and responses.
const deviceKeyView = (k: Record<string, unknown>) => ({
  id: k['id'],
  treatment_id: k['treatment_id'],
  name: k['name'],
  token_prefix: k['token_prefix'],
  active: k['active'],
  last_used_at: k['last_used_at'],
  created_at: k['created_at'],
});

treatmentsRouter.get('/:treatmentId/device-keys', requireAuth, requireProfileOwner, async (req, res) => {
  const treatment = await findTreatment(req.params['treatmentId'], req.params['id']);
  if (!treatment) {
    res.status(404).json({ error: 'Treatment not found', code: 'NOT_FOUND' });
    return;
  }
  const keys = await db('device_keys').where({ treatment_id: treatment.id }).orderBy('created_at', 'asc');
  res.json({ device_keys: keys.map(deviceKeyView) });
});

const deviceKeySchema = z.object({ name: z.string().min(1).max(255) });

treatmentsRouter.post('/:treatmentId/device-keys', requireAuth, requireProfileOwner, async (req, res) => {
  const treatment = await findTreatment(req.params['treatmentId'], req.params['id']);
  if (!treatment) {
    res.status(404).json({ error: 'Treatment not found', code: 'NOT_FOUND' });
    return;
  }
  const parsed = deviceKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  // The plain token is shown once and stored only as a hash.
  const token = `pcd_${randomBytes(24).toString('hex')}`;
  const [key] = await db('device_keys')
    .insert({
      care_profile_id: req.params['id'],
      treatment_id: treatment.id,
      name: parsed.data.name,
      token_hash: hashDeviceToken(token),
      token_prefix: token.slice(0, 10),
      created_by_account_id: req.account!.id,
    })
    .returning('*');
  res.status(201).json({ device_key: deviceKeyView(key), token });
});

const deviceKeyEditSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  active: z.boolean().optional(),
});

treatmentsRouter.patch('/:treatmentId/device-keys/:keyId', requireAuth, requireProfileOwner, async (req, res) => {
  const parsed = deviceKeyEditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [key] = await db('device_keys')
    .where({ id: req.params['keyId'], treatment_id: req.params['treatmentId'], care_profile_id: req.params['id'] })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!key) {
    res.status(404).json({ error: 'Device key not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ device_key: deviceKeyView(key) });
});

treatmentsRouter.delete('/:treatmentId/device-keys/:keyId', requireAuth, requireProfileOwner, async (req, res) => {
  const deleted = await db('device_keys')
    .where({ id: req.params['keyId'], treatment_id: req.params['treatmentId'], care_profile_id: req.params['id'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Device key not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Device key removed. The device can no longer push readings.' });
});
