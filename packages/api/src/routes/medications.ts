import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { requireProfileOwner } from '../middleware/permissions';
import { exportRecords, importRecords, type PortDescriptor, type PortFormat } from '../services/dataPort';
import { resolveCatalogueId } from './medicationCatalogue';
import { getMarRetentionMonths } from '../config/settings';
import { drawDownOnHand, perDoseDrawdown } from '../services/medicationSupply';

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
  // Dose amount and measure are two data points; `dose` is composed from
  // them for display. A combined `dose` string is still accepted.
  dose: z.string().max(255).optional().nullable(),
  dose_amount: z.string().max(50).optional().nullable(),
  dose_unit: z.string().max(30).optional().nullable(),
  form: z.string().max(100).optional().nullable(),
  route: z.string().max(100).optional().nullable(),
  frequency: z.string().max(255).optional().nullable(),
  schedule_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).optional().nullable(),
  instructions: z.string().optional().nullable(),
  // Units per dose, e.g. 3 capsules each time. Supply counts these down.
  units_per_dose: z.coerce.number().min(0).max(1000).optional().nullable(),
  // Recorded only when true; unchecked simply means false.
  with_food: z.boolean().optional(),
  as_needed: z.boolean().optional(),
  medical_condition_id: z.string().uuid().optional().nullable(),
  // Free-typed condition, resolved to an existing one or created.
  medical_condition_name: z.string().max(255).optional().nullable(),
  // A full new pack provides this many units.
  supply: z.coerce.number().min(0).max(1e9).optional().nullable(),
  // How many units are on hand now. Independently editable.
  supply_remaining: z.coerce.number().min(0).max(1e9).optional().nullable(),
  // Unopened full packs on hand, on top of the loose units above.
  packs_on_hand: z.coerce.number().min(0).max(1e6).optional().nullable(),
  repeats_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  // Dangerous to miss (stopping suddenly is harmful): overdue and
  // out-of-stock alerts for this medication are urgent.
  critical: z.boolean().optional(),
  active: z.boolean().optional(),
});

// Compose the display dose from its parts, e.g. "20" + "mg" -> "20mg".
function composeDose(amount: string | null | undefined, unit: string | null | undefined): string | null {
  const a = (amount ?? '').trim();
  const u = (unit ?? '').trim();
  return `${a}${u}`.trim() || null;
}

// Split a combined dose string into amount and measure ("500 mg" -> 500, mg).
function splitDose(dose: string | null | undefined): { dose_amount: string | null; dose_unit: string | null } {
  const raw = (dose ?? '').trim();
  if (!raw) return { dose_amount: null, dose_unit: null };
  const m = /^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/.exec(raw);
  return m ? { dose_amount: m[1], dose_unit: m[2].trim() || null } : { dose_amount: null, dose_unit: raw };
}

// Resolve a free-typed condition name to an existing condition on this
// profile, creating one if it is new. Empty clears the tie. Shared with
// treatments, which tie to conditions the same way.
export async function resolveConditionId(name: string | null | undefined, profileId: string): Promise<string | null> {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;
  const existing = await db('medical_conditions')
    .where({ care_profile_id: profileId })
    .whereRaw('lower(name) = lower(?)', [trimmed])
    .first();
  if (existing) return existing.id;
  const [created] = await db('medical_conditions').insert({ care_profile_id: profileId, name: trimmed }).returning('id');
  return (created as { id: string }).id;
}

interface MedRow {
  name: string;
  units_per_dose: number | null;
  dose_amount: string | null;
  dose_unit: string | null;
  form: string | null;
  route: string | null;
  with_food: boolean;
  as_needed: boolean;
  frequency: string | null;
  schedule_times: string[] | null;
  supply: number | null;
  supply_remaining: number | null;
  packs_on_hand: number | null;
  repeats_due: string | null;
  active: boolean;
}

interface MedInsert {
  name: string;
  units_per_dose: number | null;
  dose_amount: string | null;
  dose_unit: string | null;
  form: string | null;
  route: string | null;
  with_food: boolean;
  as_needed: boolean;
  frequency: string | null;
  schedule_times: string[];
  supply: number | null;
  packs_on_hand: number | null;
  repeats_due: string | null;
  active: boolean;
}

// Postgres returns decimal columns as strings; hand the client real numbers so
// supply/supply_remaining arrive as the numeric type the frontend expects.
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// A plain date as YYYY-MM-DD, from a Date or an already-string value,
// without a timezone shift.
const dateOrNull = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const serializeMed = <T extends Record<string, unknown>>(m: T): T =>
  ({
    ...m,
    supply: numOrNull(m['supply']),
    supply_remaining: numOrNull(m['supply_remaining']),
    packs_on_hand: numOrNull(m['packs_on_hand']),
    units_per_dose: numOrNull(m['units_per_dose']),
    repeats_due: dateOrNull(m['repeats_due']),
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
    { key: 'dose_amount', header: 'Dose amount', aliases: ['dose', 'dosage', 'strength'], toCell: (r) => r.dose_amount ?? '' },
    { key: 'dose_unit', header: 'Dose measure', aliases: ['measure', 'dose unit'], toCell: (r) => r.dose_unit ?? '' },
    { key: 'form', header: 'Type', aliases: ['form'], toCell: (r) => r.form ?? '' },
    { key: 'route', header: 'Route', toCell: (r) => r.route ?? '' },
    { key: 'with_food', header: 'With food', aliases: ['food'], toCell: (r) => (r.with_food ? 'true' : 'false') },
    { key: 'as_needed', header: 'As needed', aliases: ['prn'], toCell: (r) => (r.as_needed ? 'true' : 'false') },
    { key: 'schedule_times', header: 'Times', aliases: ['schedule', 'schedule times', 'time'], toCell: (r) => (r.schedule_times ?? []).join('; ') },
    { key: 'supply', header: 'A full pack provides', aliases: ['supply', 'stock', 'quantity', 'on hand', 'supply in units', 'pack size'], toCell: (r) => (r.supply ?? '').toString() },
    { key: 'supply_remaining', header: 'Units left', aliases: ['remaining', 'supply remaining'], toCell: (r) => (r.supply_remaining ?? '').toString() },
    { key: 'packs_on_hand', header: 'Packs on hand', aliases: ['packs', 'packs left', 'unopened packs'], toCell: (r) => (r.packs_on_hand ?? '').toString() },
    { key: 'repeats_due', header: 'Repeats due', aliases: ['repeat', 'repeat due'], toCell: (r) => r.repeats_due ?? '' },
    { key: 'active', header: 'Active', aliases: ['status'], toCell: (r) => (r.active ? 'true' : 'false') },
  ],
  coerce: (raw, rowNumber) => {
    const name = (raw['name'] ?? '').trim();
    if (!name) return { ok: false as const, error: `Row ${rowNumber}: a medication name is required.` };
    if (name.length > 255) return { ok: false as const, error: `Row ${rowNumber}: name is too long.` };
    const supplyNum = parseFloat(String(raw['supply'] ?? '').replace(/[^0-9.]/g, ''));
    const unitsNum = parseFloat(String(raw['units_per_dose'] ?? '').replace(/[^0-9.]/g, ''));
    const foodCell = (raw['with_food'] ?? '').trim().toLowerCase();
    // Accept split amount/measure, or a combined "Dose" cell to split.
    const amountRaw = blank(raw['dose_amount']);
    const unitRaw = blank(raw['dose_unit']);
    let dose_amount = amountRaw;
    let dose_unit = unitRaw;
    if (amountRaw && !unitRaw) {
      const split = splitDose(amountRaw);
      dose_amount = split.dose_amount ?? amountRaw;
      dose_unit = split.dose_unit;
    }
    const repeats = blank(raw['repeats_due']);
    return {
      ok: true as const,
      value: {
        name,
        units_per_dose: Number.isFinite(unitsNum) && unitsNum > 0 ? unitsNum : null,
        dose_amount,
        dose_unit,
        form: blank(raw['form']),
        route: blank(raw['route']),
        with_food: ['true', 'yes', '1', 'with', 'with food', 'y'].includes(foodCell),
        as_needed: ['true', 'yes', '1', 'prn', 'as needed', 'y'].includes((raw['as_needed'] ?? '').trim().toLowerCase()),
        frequency: blank(raw['frequency']),
        schedule_times: parseTimes(raw['schedule_times']),
        supply: Number.isFinite(supplyNum) ? supplyNum : null,
        packs_on_hand: (() => {
          const packsNum = parseFloat(String(raw['packs_on_hand'] ?? '').replace(/[^0-9.]/g, ''));
          return Number.isFinite(packsNum) ? packsNum : null;
        })(),
        repeats_due: repeats && /^\d{4}-\d{2}-\d{2}$/.test(repeats) ? repeats : null,
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
      dose_amount: r.dose_amount,
      dose_unit: r.dose_unit,
      dose: composeDose(r.dose_amount, r.dose_unit),
      route: r.route,
      with_food: r.with_food,
      as_needed: r.as_needed,
      frequency: r.frequency,
      supply: r.supply,
      supply_remaining: r.supply,
      packs_on_hand: r.packs_on_hand,
      repeats_due: r.repeats_due,
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

// Resolve the condition tie from either an id or a free-typed name, and
// compose the dose columns, shared by create and edit.
async function medFieldsFrom(data: z.infer<typeof medSchema> | Partial<z.infer<typeof medSchema>>, profileId: string) {
  const fields: Record<string, unknown> = {};
  if ('units_per_dose' in data) fields['units_per_dose'] = data.units_per_dose ?? null;
  if ('route' in data) fields['route'] = data.route ?? null;
  if ('with_food' in data) fields['with_food'] = data.with_food ?? false;
  if ('as_needed' in data) fields['as_needed'] = data.as_needed ?? false;
  if ('frequency' in data) fields['frequency'] = data.frequency ?? null;
  if ('repeats_due' in data) fields['repeats_due'] = data.repeats_due ?? null;
  if ('critical' in data) fields['critical'] = data.critical ?? false;
  if ('active' in data) fields['active'] = data.active ?? true;

  // Dose amount and measure are the source of truth; dose is composed.
  if ('dose_amount' in data || 'dose_unit' in data) {
    fields['dose_amount'] = data.dose_amount ?? null;
    fields['dose_unit'] = data.dose_unit ?? null;
    fields['dose'] = composeDose(data.dose_amount, data.dose_unit);
  } else if ('dose' in data) {
    const split = splitDose(data.dose);
    fields['dose_amount'] = split.dose_amount;
    fields['dose_unit'] = split.dose_unit;
    fields['dose'] = data.dose ?? null;
  }

  // A free-typed condition resolves to an existing one or creates it.
  if ('medical_condition_name' in data) {
    fields['medical_condition_id'] = await resolveConditionId(data.medical_condition_name, profileId);
  } else if ('medical_condition_id' in data) {
    fields['medical_condition_id'] = data.medical_condition_id ?? null;
  }
  return fields;
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
  const catalogueId = await resolveCatalogueId(parsed.data.name, parsed.data.form ?? null, req.account!.id);
  const fields = await medFieldsFrom(parsed.data, req.params['id']!);
  const [med] = await db('medications')
    .insert({
      care_profile_id: req.params['id'],
      medication_catalogue_id: catalogueId,
      ...fields,
      supply: parsed.data.supply ?? null,
      // A pack only becomes "open" once a dose is taken from it, so unopened
      // packs must not silently start a pack open as well (that double-counted
      // the supply). Use the open-pack amount if given; otherwise start with
      // no open pack when unopened packs are on hand, or a single loose pack
      // when only a pack size was entered.
      supply_remaining:
        parsed.data.supply_remaining ??
        (parsed.data.packs_on_hand != null ? 0 : parsed.data.supply) ??
        null,
      packs_on_hand: parsed.data.packs_on_hand ?? null,
      schedule_times: parsed.data.schedule_times ? db.raw('?::jsonb', [JSON.stringify(parsed.data.schedule_times)]) : null,
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
  const update: Record<string, unknown> = { ...(await medFieldsFrom(parsed.data, req.params['id']!)), updated_at: db.fn.now() };
  if (parsed.data.schedule_times !== undefined) {
    update['schedule_times'] = parsed.data.schedule_times ? db.raw('?::jsonb', [JSON.stringify(parsed.data.schedule_times)]) : null;
  }
  // Pack size, units-on-hand and packs-on-hand are edited independently.
  if (parsed.data.supply !== undefined) update['supply'] = parsed.data.supply;
  if (parsed.data.supply_remaining !== undefined) update['supply_remaining'] = parsed.data.supply_remaining;
  if (parsed.data.packs_on_hand !== undefined) update['packs_on_hand'] = parsed.data.packs_on_hand;
  // Changing the drug identity re-points the medication at a catalogue entry.
  if (parsed.data.name !== undefined) {
    update['medication_catalogue_id'] = await resolveCatalogueId(parsed.data.name, parsed.data.form ?? null, req.account!.id);
  }
  const [med] = await db('medications')
    .where({ id: req.params['medId'], care_profile_id: req.params['id'] })
    .update(update)
    .returning('id');
  if (!med) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  // Restocking clears any "out of stock" acknowledgement, so the urgent alert
  // recurs if this medication runs out again later.
  if (
    (parsed.data.supply_remaining != null && parsed.data.supply_remaining > 0) ||
    (parsed.data.packs_on_hand != null && parsed.data.packs_on_hand > 0)
  ) {
    await db('attention_dismissals').where({ item_key: `out_of_stock:${req.params['medId']}` }).delete();
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

// A given dose draws down what is on hand, opening the next unopened pack
// automatically when the open one runs out. Shared logic in medicationSupply.
async function drawDownSupply(
  medId: string,
  doses: number,
  med: { form: string | null; units_per_dose: unknown; dose_amount: unknown }
): Promise<void> {
  await drawDownOnHand(medId, doses * perDoseDrawdown(med));
}

// Deleting a recorded dose gives its supply back, capped at a full pack.
async function restoreSupply(
  med: { id: string; form: string | null; units_per_dose: unknown; dose_amount: unknown },
  doses: number
): Promise<void> {
  const amount = doses * perDoseDrawdown(med);
  if (amount <= 0) return;
  await db('medications')
    .where({ id: med.id })
    .whereNotNull('supply_remaining')
    .update({ supply_remaining: db.raw('LEAST(COALESCE(supply, supply_remaining + ?), supply_remaining + ?)', [amount, amount]) });
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
  // medSelect joins the catalogue so `form` (which lives there) is set,
  // and supply draws down in the right unit for the form.
  const med = await medSelect().where('m.id', req.params['medId']).andWhere('m.care_profile_id', req.params['id']).first();
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
  if (GIVEN.has(parsed.data.status)) await drawDownSupply(med.id, 1, med);
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
  const meds = await medSelect().where('m.care_profile_id', req.params['id']).whereIn('m.id', medIds);
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
    await drawDownSupply(medId, doses, byId.get(medId)!);
  }
  res.status(201).json({ recorded: inserted.length });
});

// Delete a recorded dose (e.g. logged twice by mistake). Any non-viewer
// may correct the record; the change is audited by the mounted middleware.
// A given dose gives its supply back. Archived history stays immutable.
medicationsRouter.delete('/administrations/:adminId', requireAuth, async (req, res) => {
  const admin = await db('medication_administrations')
    .where({ id: req.params['adminId'], care_profile_id: req.params['id'] })
    .first();
  if (!admin) {
    res.status(404).json({ error: 'That dose record was not found, or has been archived and cannot be changed.', code: 'NOT_FOUND' });
    return;
  }
  if (GIVEN.has(admin.status)) {
    const med = await medSelect().where('m.id', admin.medication_id).first();
    if (med) await restoreSupply(med, 1);
  }
  await db('medication_administrations').where({ id: admin.id }).delete();
  res.json({ message: 'Dose record removed.' });
});

// One administration in the same shape the log returns, for edit responses.
function adminLogRow(profileId: string, adminId: string) {
  return db('medication_administrations as a')
    .join('medications as m', 'a.medication_id', 'm.id')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where({ 'a.id': adminId, 'a.care_profile_id': profileId })
    .select(
      'a.id', 'a.medication_id', 'a.care_profile_id', 'c.name as medication_name',
      'a.administered_at', 'a.scheduled_for', 'a.administered_by_name', 'a.status',
      'a.dose_given', 'a.route_given', 'a.notes',
      'a.right_patient', 'a.right_medication', 'a.right_dose', 'a.right_route', 'a.right_time', 'a.right_documentation',
      db.raw('false as archived')
    )
    .first();
}

// Moving a dose between a given and a not-given outcome moves its supply too:
// a dose that is no longer given is handed back, a dose that becomes given is
// counted down, so the units-on-hand stay honest after a correction.
async function reconcileSupplyForStatus(oldStatus: string, newStatus: string, medicationId: string): Promise<void> {
  const wasGiven = GIVEN.has(oldStatus);
  const nowGiven = GIVEN.has(newStatus);
  if (wasGiven === nowGiven) return;
  const med = await medSelect().where('m.id', medicationId).first();
  if (!med) return;
  if (wasGiven && !nowGiven) await restoreSupply(med, 1);
  else await drawDownSupply(med.id, 1, med);
}

// Fields the record can be corrected on: when it happened, the outcome, and
// the note. Each is its own data point, edited on its own.
const adminEditSchema = z.object({
  administered_at: z.string().optional(),
  status: z.enum(['given', 'refused', 'omitted', 'held', 'self_administered']).optional(),
  notes: z.string().optional().nullable(),
});

// Build the update patch (and validate the note rule) for one administration
// against its current row. Returns the column changes, or an error code.
function buildAdminEdit(
  data: z.infer<typeof adminEditSchema>,
  current: { status: string; notes: string | null }
): { ok: true; update: Record<string, unknown> } | { ok: false; code: 'FUTURE_TIME' | 'NOTE_REQUIRED' } {
  if (isFutureTime(data.administered_at)) return { ok: false, code: 'FUTURE_TIME' };
  const update: Record<string, unknown> = {};
  if (data.administered_at !== undefined) update['administered_at'] = new Date(data.administered_at);
  if (data.notes !== undefined) update['notes'] = data.notes?.trim() ? data.notes.trim() : null;
  if (data.status !== undefined) {
    update['status'] = data.status;
    // A not-given outcome still needs its reason; use the new note if one was
    // supplied, otherwise the note already on the record.
    if (!NOTE_OPTIONAL.has(data.status)) {
      const note = data.notes !== undefined ? data.notes : current.notes;
      if (!note?.trim()) return { ok: false, code: 'NOTE_REQUIRED' };
    }
  }
  return { ok: true, update };
}

const NOTE_REQUIRED_MSG = 'A note is required when the outcome is not "given" or "self-administered".';

// Correct a single dose record: its time, outcome or note. A change of outcome
// reconciles supply, and archived history stays immutable.
medicationsRouter.patch('/administrations/:adminId', requireAuth, async (req, res) => {
  const admin = await db('medication_administrations')
    .where({ id: req.params['adminId'], care_profile_id: req.params['id'] })
    .first();
  if (!admin) {
    res.status(404).json({ error: 'That dose record was not found, or has been archived and cannot be changed.', code: 'NOT_FOUND' });
    return;
  }
  const parsed = adminEditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const built = buildAdminEdit(parsed.data, admin);
  if (!built.ok) {
    if (built.code === 'FUTURE_TIME') res.status(400).json({ error: 'You cannot log a dose in the future.', code: 'FUTURE_TIME' });
    else res.status(400).json({ error: NOTE_REQUIRED_MSG, code: 'NOTE_REQUIRED' });
    return;
  }
  if (Object.keys(built.update).length > 0) {
    await db('medication_administrations').where({ id: admin.id }).update(built.update);
  }
  if (parsed.data.status !== undefined) await reconcileSupplyForStatus(admin.status, parsed.data.status, admin.medication_id);
  res.json({ administration: await adminLogRow(req.params['id']!, admin.id) });
});

// Bulk correction or removal across selected records. Update applies the same
// time and/or outcome to every selected dose; delete removes them and hands
// back the supply of any that were given. Archived rows are never touched.
const adminBulkSchema = z
  .object({
    action: z.enum(['update', 'delete']),
    ids: z.array(z.string().uuid()).min(1).max(500),
    administered_at: z.string().optional(),
    status: z.enum(['given', 'refused', 'omitted', 'held', 'self_administered']).optional(),
    notes: z.string().optional().nullable(),
  })
  .refine(
    (v) => v.action !== 'update' || v.administered_at !== undefined || v.status !== undefined || v.notes !== undefined,
    { message: 'Choose at least one field to change.' }
  );

medicationsRouter.post('/administrations/bulk', requireAuth, async (req, res) => {
  const parsed = adminBulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const records = await db('medication_administrations')
    .where('care_profile_id', req.params['id'])
    .whereIn('id', parsed.data.ids);

  if (parsed.data.action === 'delete') {
    for (const admin of records) {
      if (GIVEN.has(admin.status)) {
        const med = await medSelect().where('m.id', admin.medication_id).first();
        if (med) await restoreSupply(med, 1);
      }
    }
    const deleted = await db('medication_administrations')
      .where('care_profile_id', req.params['id'])
      .whereIn('id', records.map((r) => r.id))
      .delete();
    res.json({ deleted });
    return;
  }

  // Update: validate the note rule against each record before touching any.
  const edits: { id: string; oldStatus: string; medicationId: string; update: Record<string, unknown> }[] = [];
  for (const admin of records) {
    const built = buildAdminEdit(parsed.data, admin);
    if (!built.ok) {
      if (built.code === 'FUTURE_TIME') res.status(400).json({ error: 'You cannot log a dose in the future.', code: 'FUTURE_TIME' });
      else res.status(400).json({ error: NOTE_REQUIRED_MSG, code: 'NOTE_REQUIRED' });
      return;
    }
    edits.push({ id: admin.id, oldStatus: admin.status, medicationId: admin.medication_id, update: built.update });
  }
  for (const e of edits) {
    if (Object.keys(e.update).length > 0) await db('medication_administrations').where({ id: e.id }).update(e.update);
    if (parsed.data.status !== undefined) await reconcileSupplyForStatus(e.oldStatus, parsed.data.status, e.medicationId);
  }
  res.json({ updated: edits.length });
});
