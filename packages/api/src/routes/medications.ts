import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { requireProfileOwner } from '../middleware/permissions';
import { exportRecords, importRecords, type PortDescriptor, type PortFormat } from '../services/dataPort';
import { resolveCatalogueId } from './medicationCatalogue';
import { getMarRetentionMonths } from '../config/settings';

export const medicationsRouter = Router({ mergeParams: true });

// Per-person medications carry only the variables; the drug name and form come
// from the shared catalogue via this join.
const medSelect = () =>
  db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .leftJoin('medical_conditions as mc', 'm.medical_condition_id', 'mc.id')
    .select('m.*', 'c.name as name', 'c.form as form', 'mc.name as condition_name');

const medWithName = (id: string) => medSelect().where('m.id', id).first();

const medSchema = z.object({
  name: z.string().min(1).max(255),
  dose: z.string().max(255).optional().nullable(),
  form: z.string().max(100).optional().nullable(),
  route: z.string().max(100).optional().nullable(),
  frequency: z.string().max(255).optional().nullable(),
  schedule_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).optional().nullable(),
  instructions: z.string().optional().nullable(),
  // Units per dose, e.g. 3 capsules each time. Supply counts these down.
  units_per_dose: z.coerce.number().min(0).max(1000).optional().nullable(),
  with_food: z.boolean().optional().nullable(),
  as_needed: z.boolean().optional(),
  medical_condition_id: z.string().uuid().optional().nullable(),
  supply: z.coerce.number().min(0).max(1e9).optional().nullable(),
  active: z.boolean().optional(),
});

interface MedRow {
  name: string;
  units_per_dose: number | null;
  dose: string | null;
  form: string | null;
  route: string | null;
  with_food: boolean | null;
  as_needed: boolean;
  frequency: string | null;
  schedule_times: string[] | null;
  instructions: string | null;
  supply: number | null;
  supply_remaining: number | null;
  active: boolean;
}

interface MedInsert {
  name: string;
  units_per_dose: number | null;
  dose: string | null;
  form: string | null;
  route: string | null;
  with_food: boolean | null;
  as_needed: boolean;
  frequency: string | null;
  schedule_times: string[];
  instructions: string | null;
  supply: number | null;
  active: boolean;
}

// Postgres returns decimal columns as strings; hand the client real numbers so
// supply/supply_remaining arrive as the numeric type the frontend expects.
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const serializeMed = <T extends Record<string, unknown>>(m: T): T =>
  ({
    ...m,
    supply: numOrNull(m['supply']),
    supply_remaining: numOrNull(m['supply_remaining']),
    units_per_dose: numOrNull(m['units_per_dose']),
  });

const blank = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

const parseActive = (v: string | undefined): boolean => {
  const t = (v ?? '').trim().toLowerCase();
  if (t === '') return true;
  return !['false', 'no', '0', 'inactive', 'off', 'stopped', 'n'].includes(t);
};

// Pull every HH:MM out of a cell regardless of separator ("08:00 20:00",
// "8:00; 20:00", "0800,2000") and normalise to two-digit hours.
const parseTimes = (v: string | undefined): string[] =>
  (v ?? '')
    .split(/[^0-9:]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const m = /^(\d{1,2}):?(\d{2})$/.exec(t);
      if (!m) return null;
      const hh = String(Math.min(23, Number(m[1]))).padStart(2, '0');
      return `${hh}:${m[2]}`;
    })
    .filter((t): t is string => t !== null);

// The medications import/export descriptor — the first consumer of the
// reusable dataPort toolkit. Other resources add their own descriptor.
const medPort: PortDescriptor<MedRow, MedInsert> = {
  resource: 'medications',
  columns: [
    { key: 'name', header: 'Name', aliases: ['medication', 'drug', 'medicine'], toCell: (r) => r.name },
    { key: 'units_per_dose', header: 'Units per dose', aliases: ['unit', 'units', 'quantity per dose'], toCell: (r) => (r.units_per_dose ?? '').toString() },
    { key: 'dose', header: 'Dose', aliases: ['dosage', 'strength'], toCell: (r) => r.dose ?? '' },
    { key: 'form', header: 'Type', aliases: ['form'], toCell: (r) => r.form ?? '' },
    { key: 'route', header: 'Route', toCell: (r) => r.route ?? '' },
    { key: 'with_food', header: 'With food', aliases: ['food'], toCell: (r) => (r.with_food === null ? '' : r.with_food ? 'true' : 'false') },
    { key: 'as_needed', header: 'As needed', aliases: ['prn'], toCell: (r) => (r.as_needed ? 'true' : 'false') },
    { key: 'frequency', header: 'Frequency', aliases: ['freq', 'how often'], toCell: (r) => r.frequency ?? '' },
    { key: 'schedule_times', header: 'Times', aliases: ['schedule', 'schedule times', 'time'], toCell: (r) => (r.schedule_times ?? []).join('; ') },
    { key: 'instructions', header: 'Instructions', aliases: ['directions', 'notes'], toCell: (r) => r.instructions ?? '' },
    { key: 'supply', header: 'Supply in units', aliases: ['supply', 'stock', 'quantity', 'on hand'], toCell: (r) => (r.supply ?? '').toString() },
    { key: 'supply_remaining', header: 'Units left', aliases: ['remaining', 'supply remaining'], toCell: (r) => (r.supply_remaining ?? '').toString() },
    { key: 'active', header: 'Active', aliases: ['status'], toCell: (r) => (r.active ? 'true' : 'false') },
  ],
  coerce: (raw, rowNumber) => {
    const name = (raw['name'] ?? '').trim();
    if (!name) return { ok: false as const, error: `Row ${rowNumber}: a medication name is required.` };
    if (name.length > 255) return { ok: false as const, error: `Row ${rowNumber}: name is too long.` };
    const supplyNum = parseFloat(String(raw['supply'] ?? '').replace(/[^0-9.]/g, ''));
    const unitsNum = parseFloat(String(raw['units_per_dose'] ?? '').replace(/[^0-9.]/g, ''));
    const foodCell = (raw['with_food'] ?? '').trim().toLowerCase();
    return {
      ok: true as const,
      value: {
        name,
        units_per_dose: Number.isFinite(unitsNum) && unitsNum > 0 ? unitsNum : null,
        dose: blank(raw['dose']),
        form: blank(raw['form']),
        route: blank(raw['route']),
        with_food: foodCell === '' ? null : !['false', 'no', '0', 'without', 'n'].includes(foodCell),
        as_needed: ['true', 'yes', '1', 'prn', 'as needed', 'y'].includes((raw['as_needed'] ?? '').trim().toLowerCase()),
        frequency: blank(raw['frequency']),
        schedule_times: parseTimes(raw['schedule_times']),
        instructions: blank(raw['instructions']),
        supply: Number.isFinite(supplyNum) ? supplyNum : null,
        active: parseActive(raw['active']),
      },
    };
  },
};

const readFormat = (v: unknown): PortFormat => (String(v).toLowerCase() === 'json' ? 'json' : 'csv');

medicationsRouter.get('/', requireAuth, async (req, res) => {
  const meds = await medSelect()
    .where('m.care_profile_id', req.params['id'])
    .orderBy([{ column: 'm.active', order: 'desc' }, { column: 'c.name', order: 'asc' }]);
  res.json({ medications: meds.map(serializeMed) });
});

// Export the medication list as CSV or JSON.
medicationsRouter.get('/export', requireAuth, requireAccountRight('can_export_data'), async (req, res) => {
  const format = readFormat(req.query['format']);
  const meds = (await medSelect()
    .where('m.care_profile_id', req.params['id'])
    .orderBy([{ column: 'm.active', order: 'desc' }, { column: 'c.name', order: 'asc' }])) as MedRow[];
  const { body, contentType, filename } = exportRecords(medPort, meds, format);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
});

// Import medications from CSV or JSON. Accepts either a raw text body
// (Content-Type text/csv or application/json) or {format, data} JSON.
const importSchema = z.object({
  format: z.enum(['csv', 'json']).optional(),
  data: z.string().min(1),
});

medicationsRouter.post('/import', requireAuth, requireProfileOwner, async (req, res) => {
  let text: string;
  let format: PortFormat;
  if (typeof req.body === 'string') {
    text = req.body;
    format = readFormat(req.query['format'] ?? (req.is('application/json') ? 'json' : 'csv'));
  } else {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide the file contents in a "data" field.', code: 'VALIDATION_ERROR' });
      return;
    }
    text = parsed.data.data;
    format = parsed.data.format ?? readFormat(req.query['format']);
  }

  const { records, errors, total } = importRecords(medPort, text, format);
  if (records.length === 0) {
    res.status(400).json({ error: 'No valid medications found to import.', code: 'IMPORT_EMPTY', imported: 0, skipped: total, errors });
    return;
  }

  const toInsert: Record<string, unknown>[] = [];
  for (const r of records) {
    const catalogueId = await resolveCatalogueId(r.name, r.form, req.account!.id);
    toInsert.push({
      care_profile_id: req.params['id'],
      medication_catalogue_id: catalogueId,
      units_per_dose: r.units_per_dose,
      dose: r.dose,
      route: r.route,
      with_food: r.with_food,
      as_needed: r.as_needed,
      frequency: r.frequency,
      instructions: r.instructions,
      supply: r.supply,
      supply_remaining: r.supply,
      active: r.active,
      schedule_times: r.schedule_times.length
        ? db.raw('?::jsonb', [JSON.stringify(r.schedule_times)])
        : null,
    });
  }
  const inserted = await db('medications').insert(toInsert).returning('id');

  res.status(201).json({ imported: inserted.length, skipped: errors.length, errors });
});

// A medication can only be tied to one of this person's own conditions.
async function conditionBelongsToProfile(conditionId: string | null | undefined, profileId: string): Promise<boolean> {
  if (!conditionId) return true;
  const row = await db('medical_conditions').where({ id: conditionId, care_profile_id: profileId }).first();
  return !!row;
}

medicationsRouter.post('/', requireAuth, requireProfileOwner, async (req, res) => {
  const parsed = medSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!(await conditionBelongsToProfile(parsed.data.medical_condition_id, req.params['id']!))) {
    res.status(400).json({ error: 'Condition not found', code: 'VALIDATION_ERROR' });
    return;
  }
  const { schedule_times, name, form, ...rest } = parsed.data;
  const catalogueId = await resolveCatalogueId(name, form ?? null, req.account!.id);
  const [med] = await db('medications')
    .insert({
      care_profile_id: req.params['id'],
      medication_catalogue_id: catalogueId,
      ...rest,
      // A fresh supply starts fully remaining.
      supply_remaining: rest.supply ?? null,
      schedule_times: schedule_times ? db.raw('?::jsonb', [JSON.stringify(schedule_times)]) : null,
    })
    .returning('id');
  res.status(201).json({ medication: serializeMed(await medWithName((med as { id: string }).id)) });
});

medicationsRouter.patch('/:medId', requireAuth, requireProfileOwner, async (req, res) => {
  const parsed = medSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!(await conditionBelongsToProfile(parsed.data.medical_condition_id, req.params['id']!))) {
    res.status(400).json({ error: 'Condition not found', code: 'VALIDATION_ERROR' });
    return;
  }
  const { schedule_times, name, form, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest, updated_at: db.fn.now() };
  if (schedule_times !== undefined) {
    update['schedule_times'] = schedule_times ? db.raw('?::jsonb', [JSON.stringify(schedule_times)]) : null;
  }
  // Editing the supply refills it, so the remaining count resets to the total.
  if (rest.supply !== undefined) {
    update['supply_remaining'] = rest.supply;
  }
  // Changing the drug identity re-points the medication at a catalogue entry.
  if (name !== undefined) {
    update['medication_catalogue_id'] = await resolveCatalogueId(name, form ?? null, req.account!.id);
  }
  const [med] = await db('medications')
    .where({ id: req.params['medId'], care_profile_id: req.params['id'] })
    .update(update)
    .returning('id');
  if (!med) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ medication: serializeMed(await medWithName((med as { id: string }).id)) });
});

// Bulk actions on the list. Delete is limited to the profile owner and
// platform admins/super admins (requireProfileOwner); contributors and
// viewers can sort/filter but never bulk-delete. Scoped to this profile, so
// an admin only ever deletes medications for a person in their care.
const bulkSchema = z.object({
  action: z.enum(['delete', 'activate', 'deactivate']),
  ids: z.array(z.string().uuid()).min(1).max(500),
});

medicationsRouter.post('/bulk', requireAuth, requireProfileOwner, async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const scope = db('medications').where({ care_profile_id: req.params['id'] }).whereIn('id', parsed.data.ids);
  if (parsed.data.action === 'delete') {
    const deleted = await scope.del();
    res.json({ deleted });
    return;
  }
  const updated = await scope.update({ active: parsed.data.action === 'activate', updated_at: db.fn.now() });
  res.json({ updated });
});

medicationsRouter.delete('/:medId', requireAuth, requireProfileOwner, async (req, res) => {
  const affected = await db('medications').where({ id: req.params['medId'], care_profile_id: req.params['id'] }).del();
  if (!affected) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Medication removed.' });
});

// Chart view: the active regimen plus every administration touching the
// window (matched to a scheduled slot by scheduled_for, or ad-hoc). The
// frontend composes the schedule grid from this.
medicationsRouter.get('/chart', requireAuth, async (req, res) => {
  const from = req.query['from'] ? new Date(String(req.query['from'])) : new Date(Date.now() - 24 * 3600 * 1000);
  const to = req.query['to'] ? new Date(String(req.query['to'])) : new Date(Date.now() + 24 * 3600 * 1000);
  const medications = await medSelect().where('m.care_profile_id', req.params['id']).andWhere('m.active', true);
  const administrations = await db('medication_administrations')
    .where('care_profile_id', req.params['id'])
    .andWhere((qb) =>
      qb.whereBetween('administered_at', [from, to]).orWhereBetween('scheduled_for', [from, to])
    )
    .orderBy('administered_at', 'asc');
  res.json({ medications: medications.map(serializeMed), administrations });
});

// A window's adherence summary — expected slots vs recorded outcomes.
medicationsRouter.get('/summary', requireAuth, async (req, res) => {
  const from = req.query['from'] ? new Date(String(req.query['from'])) : new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const to = req.query['to'] ? new Date(String(req.query['to'])) : new Date();
  const byStatus = (await db('medication_administrations')
    .where('care_profile_id', req.params['id'])
    .whereBetween('administered_at', [from, to])
    .select('status')
    .count({ n: '*' })
    .groupBy('status')) as unknown as Array<{ status: string; n: string | number }>;
  const counts: Record<string, number> = {};
  for (const r of byStatus) counts[r.status] = Number(r.n);
  res.json({ counts });
});

// The MAR log: chronological, filterable, cursor-paginated so it scales to
// years of records. Optionally folds in the archive (older than retention).
medicationsRouter.get('/administrations', requireAuth, async (req, res) => {
  const profileId = String(req.params['id']);
  const q = String(req.query['search'] ?? '').trim();
  const status = String(req.query['status'] ?? '').trim();
  const medicationId = String(req.query['medication_id'] ?? '').trim();
  const from = req.query['from'] ? new Date(String(req.query['from'])) : null;
  const to = req.query['to'] ? new Date(String(req.query['to'])) : null;
  const includeArchived = String(req.query['include_archived'] ?? '') === 'true';
  const order = String(req.query['sort'] ?? 'recent') === 'oldest' ? 'asc' : 'desc';
  const limit = Math.min(200, Math.max(1, Number(req.query['limit']) || 50));
  const cursor = req.query['cursor'] ? new Date(String(req.query['cursor'])) : null;

  const hot = db('medication_administrations as a')
    .join('medications as m', 'a.medication_id', 'm.id')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where('a.care_profile_id', profileId)
    .select(
      'a.id', 'a.medication_id', 'a.care_profile_id', 'c.name as medication_name',
      'a.administered_at', 'a.scheduled_for', 'a.administered_by_name', 'a.status',
      'a.dose_given', 'a.route_given', 'a.notes',
      'a.right_patient', 'a.right_medication', 'a.right_dose', 'a.right_route', 'a.right_time', 'a.right_documentation',
      db.raw('false as archived')
    );

  let base = db.from(hot.as('x'));
  if (includeArchived) {
    const archived = db('medication_administration_archive as a')
      .where('a.care_profile_id', profileId)
      .select(
        'a.id', 'a.medication_id', 'a.care_profile_id', 'a.medication_name',
        'a.administered_at', 'a.scheduled_for', 'a.administered_by_name', 'a.status',
        'a.dose_given', 'a.route_given', 'a.notes',
        'a.right_patient', 'a.right_medication', 'a.right_dose', 'a.right_route', 'a.right_time', 'a.right_documentation',
        db.raw('true as archived')
      );
    base = db.from(hot.unionAll([archived]).as('x'));
  }

  base = base.modify((qb) => {
    if (q) qb.where((w) => w.whereILike('medication_name', `%${q}%`).orWhereILike('notes', `%${q}%`).orWhereILike('administered_by_name', `%${q}%`));
    if (status) qb.where('status', status);
    if (medicationId) qb.where('medication_id', medicationId);
    if (from) qb.where('administered_at', '>=', from);
    if (to) qb.where('administered_at', '<=', to);
    if (cursor) qb.where('administered_at', order === 'asc' ? '>' : '<', cursor);
  });

  const administrations = await base.orderBy('administered_at', order).limit(limit);
  const nextCursor = administrations.length === limit ? administrations[administrations.length - 1].administered_at : null;
  res.json({ administrations, nextCursor, retentionMonths: getMarRetentionMonths() });
});

const adminSchema = z.object({
  scheduled_for: z.string().optional().nullable(),
  administered_at: z.string().optional().nullable(),
  status: z.enum(['given', 'refused', 'omitted', 'held', 'self_administered']).default('given'),
  dose_given: z.string().max(255).optional().nullable(),
  route_given: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
  // Only the dose, route and time rights are verified at the point of care.
  // Patient, medication and documentation are guaranteed by the context
  // (you are on this person's record, you picked this medication, and the
  // act of recording is the documentation) and are set server-side.
  right_dose: z.boolean().optional(),
  right_route: z.boolean().optional(),
  right_time: z.boolean().optional(),
});

const NOTE_OPTIONAL = new Set(['given', 'self_administered']);
const GIVEN = new Set(['given', 'self_administered']);
const FUTURE_SKEW_MS = 60 * 1000;
const isFutureTime = (s?: string | null): boolean => !!s && new Date(s).getTime() > Date.now() + FUTURE_SKEW_MS;

// A given dose draws down the remaining supply by the units taken, never
// below zero. Supply is counted in units: 3 tablets, not 60 mg.
async function drawDownSupply(medId: string, doses: number, unitsPerDose: number | null): Promise<void> {
  const amount = doses * (Number(unitsPerDose) > 0 ? Number(unitsPerDose) : 1);
  if (amount <= 0) return;
  await db('medications')
    .where({ id: medId })
    .whereNotNull('supply_remaining')
    .update({ supply_remaining: db.raw('GREATEST(0, supply_remaining - ?)', [amount]) });
}

// Build the insert row for one administration, deriving the context rights.
function buildAdminRow(
  data: z.infer<typeof adminSchema>,
  med: { id: string; dose: string | null; route: string | null },
  profileId: string,
  account: { id: string; display_name: string }
): Record<string, unknown> {
  return {
    medication_id: med.id,
    care_profile_id: profileId,
    scheduled_for: data.scheduled_for ? new Date(data.scheduled_for) : null,
    administered_at: data.administered_at ? new Date(data.administered_at) : db.fn.now(),
    administered_by_account_id: account.id,
    administered_by_name: account.display_name,
    status: data.status,
    dose_given: data.dose_given ?? med.dose ?? null,
    route_given: data.route_given ?? med.route ?? null,
    notes: data.notes ?? null,
    right_patient: true,
    right_medication: true,
    right_documentation: true,
    right_dose: data.right_dose ?? false,
    right_route: data.right_route ?? false,
    right_time: data.right_time ?? true,
  };
}

medicationsRouter.post('/:medId/administrations', requireAuth, async (req, res) => {
  const med = await db('medications').where({ id: req.params['medId'], care_profile_id: req.params['id'] }).first();
  if (!med) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  const parsed = adminSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!NOTE_OPTIONAL.has(parsed.data.status) && !parsed.data.notes?.trim()) {
    res.status(400).json({ error: 'A note is required when the outcome is not "given" or "self-administered".', code: 'NOTE_REQUIRED' });
    return;
  }
  if (isFutureTime(parsed.data.administered_at)) {
    res.status(400).json({ error: 'You cannot log a dose in the future.', code: 'FUTURE_TIME' });
    return;
  }
  const [record] = await db('medication_administrations').insert(buildAdminRow(parsed.data, med, req.params['id']!, req.account!)).returning('*');
  if (GIVEN.has(parsed.data.status)) await drawDownSupply(med.id, 1, med.units_per_dose);
  res.status(201).json({ administration: record });
});

// Record a whole medication round (or several taps) in one request.
const batchSchema = z.object({
  entries: z.array(adminSchema.extend({ medication_id: z.string().uuid() })).min(1).max(100),
});

medicationsRouter.post('/administrations/batch', requireAuth, async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const medIds = [...new Set(parsed.data.entries.map((e) => e.medication_id))];
  const meds = await db('medications').where('care_profile_id', req.params['id']).whereIn('id', medIds);
  const byId = new Map(meds.map((m) => [m.id, m]));
  for (const e of parsed.data.entries) {
    if (!byId.has(e.medication_id)) {
      res.status(400).json({ error: 'Unknown medication in batch.', code: 'VALIDATION_ERROR' });
      return;
    }
    if (!NOTE_OPTIONAL.has(e.status) && !e.notes?.trim()) {
      res.status(400).json({ error: 'A note is required for any dose not given or self-administered.', code: 'NOTE_REQUIRED' });
      return;
    }
    if (isFutureTime(e.administered_at)) {
      res.status(400).json({ error: 'You cannot log a dose in the future.', code: 'FUTURE_TIME' });
      return;
    }
  }
  const rows = parsed.data.entries.map((e) => buildAdminRow(e, byId.get(e.medication_id)!, req.params['id']!, req.account!));
  const inserted = await db('medication_administrations').insert(rows).returning('id');
  // Draw down supply for each given dose, aggregated per medication.
  const drawdowns = new Map<string, number>();
  for (const e of parsed.data.entries) {
    if (!GIVEN.has(e.status)) continue;
    drawdowns.set(e.medication_id, (drawdowns.get(e.medication_id) ?? 0) + 1);
  }
  for (const [medId, doses] of drawdowns) {
    await drawDownSupply(medId, doses, byId.get(medId)!.units_per_dose);
  }
  res.status(201).json({ recorded: inserted.length });
});
