import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { requireProfileOwner, type AuditEntry } from '../middleware/permissions';
import { DOSE_AUDIT_ENTITY, DOSE_STATUSES, GIVEN_STATUSES, doseSummary } from '../lib/doseOutcome';
import { limitsFromText } from '../lib/asNeeded';
import { DoseProblem, doseHistory, noteOptional, recordDoses } from '../services/doses';
import { exportRecords, importRecords, type PortDescriptor, type PortFormat } from '../services/dataPort';
import { resolveCatalogueId } from './medicationCatalogue';
import { getMarRetentionMonths } from '../config/settings';
import { drawDownOnHand, perDoseDrawdown } from '../services/medicationSupply';
import { ownerOnlyMessage } from '../middleware/permissions';
import { contactSummaries, linkSupplierToContact, mainContact, resolveContactInput, supplierContacts } from '../services/professionals';
import { STOP_REASONS, STOP_REASON_LABELS, changesFor, recordMedicationChange, restartMedication, stopMedication, stopReasonFrom, type ChangeSource, type StopReason } from '../services/medicationChanges';
import { COURSE_RUNNING_SQL } from '../lib/course';

export const medicationsRouter = Router({ mergeParams: true });

// Per-person medications carry only the variables; the drug name and form come
// from the shared catalogue via this join.
const medSelect = () =>
  db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .leftJoin('medical_conditions as mc', 'm.medical_condition_id', 'mc.id')
    .leftJoin('suppliers as sup', 'm.supplier_id', 'sup.id')
    .leftJoin('providers as pres', 'm.prescriber_provider_id', 'pres.id')
    .leftJoin('appointments as src', 'm.source_appointment_id', 'src.id')
    .select(
      'm.*', 'c.name as name', 'c.form as form', 'mc.name as condition_name', 'sup.address_suburb as supplier_suburb',
      'pres.name as prescriber_name', 'src.title as source_appointment_title', 'src.starts_at as source_appointment_starts_at'
    );

type MedOut = Record<string, unknown> & { id: string; prescriber_provider_id: string | null; supplier_id: string | null };

/**
 * Who to call about each medicine, in the shape every screen shows: who
 * prescribes it, where it is reordered from, and the visit it started at.
 */
async function withContacts<T extends Record<string, unknown>>(meds: T[], profileId: string): Promise<Array<T & Record<string, unknown>>> {
  const rows = meds as unknown as MedOut[];
  const [prescribers, suppliers, history] = await Promise.all([
    contactSummaries(db, rows.map((m) => m.prescriber_provider_id), profileId),
    supplierContacts(db, rows.map((m) => m.supplier_id), profileId),
    doseHistory(db, rows.filter(limitedOrAsNeeded).map((m) => m.id)),
  ]);
  return meds.map((m) => {
    const r = m as unknown as MedOut;
    return {
      ...m,
      // Last given, with who and how many in 24 hours, for as-needed and
      // limited medicines.
      dose_history: history.get(r.id) ?? null,
      prescriber: (r.prescriber_provider_id && prescribers.get(r.prescriber_provider_id)) || null,
      supplier_contact: (r.supplier_id && suppliers.get(r.supplier_id)) || null,
      source_appointment: r['source_appointment_id']
        ? { id: r['source_appointment_id'], title: r['source_appointment_title'], starts_at: r['source_appointment_starts_at'] }
        : null,
    };
  });
}

/** As-needed, or with a gap or daily most: the screens say when it was last given. */
const limitedOrAsNeeded = (m: Record<string, unknown>): boolean => !!m['as_needed'];

/** One medicine as every screen reads it. */
async function medOut(id: string, profileId: string) {
  const row = await medWithName(id);
  if (!row) return row;
  const [out] = await withContacts([serializeMed(row)], profileId);
  return out;
}

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
  // As-needed limits: what it is for, the least hours between doses and the
  // most in 24 hours. Each its own field; read from the instructions when
  // nobody typed them.
  as_needed_for: z.string().trim().max(255).optional().nullable(),
  min_hours_between_doses: z.coerce.number().min(0).max(168).optional().nullable(),
  max_doses_per_day: z.coerce.number().int().min(0).max(50).optional().nullable(),
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
  // Where this medication is reordered from, and a link to reorder it.
  // Name and link are separate data points, kept in separate columns.
  // supplier_id links to the account's shared supplier; the name and link
  // are then derived from it. A bare name still works and resolves to one.
  supplier_id: z.string().uuid().optional().nullable(),
  supplier: z.string().max(255).optional().nullable(),
  supplier_order_url: z.string().url().max(2000).optional().nullable().or(z.literal('')),
  // Who writes the script: a contact picked by id, or a new name filed in
  // Contacts with what they do. And the visit it started at.
  prescriber_provider_id: z.string().uuid().optional().nullable(),
  prescriber_name: z.string().trim().max(255).optional().nullable(),
  prescriber_type: z.string().trim().max(100).optional().nullable(),
  prescriber_phone: z.string().trim().max(50).optional().nullable(),
  source_appointment_id: z.string().uuid().optional().nullable(),
  // The last day of a course, such as antibiotics, and the repeats left on
  // the script. Two data points, two fields.
  course_ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  repeats_left: z.coerce.number().int().min(0).max(99).optional().nullable(),
  // Why the dose or times changed and where the change came from: a visit or
  // a letter on file. Kept in the medicine's history, not on the medicine.
  change_reason: z.string().trim().max(2000).optional().nullable(),
  change_source_appointment_id: z.string().uuid().optional().nullable(),
  change_source_document_id: z.string().uuid().optional().nullable(),
  // Who said so: a contact, when a carer records a change a doctor asked for.
  change_source_provider_id: z.string().uuid().optional().nullable(),
  change_source_provider_name: z.string().trim().max(255).optional().nullable(),
  change_source_provider_type: z.string().trim().max(100).optional().nullable(),
  change_source_provider_phone: z.string().trim().max(50).optional().nullable(),
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

// Default a bare domain to https so a pasted reorder link works.
function normaliseOrderUrl(url: string | null | undefined): string | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

// Resolve a free-typed supplier name to one of the account's shared suppliers,
// creating one if it is new. Used by import and the AI actions, where only a
// name (not a chosen supplier id) is available. The editor sends a supplier_id
// instead, which is authoritative. Empty clears the tie.
export async function resolveSupplierId(
  name: string | null | undefined,
  orderUrl: string | null | undefined,
  accountId: string
): Promise<string | null> {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;
  const existing = await db('suppliers')
    .where({ account_id: accountId })
    .whereRaw('lower(name) = lower(?)', [trimmed])
    .orderBy('created_at', 'asc')
    .first();
  if (existing) return existing.id;
  const [created] = await db('suppliers')
    .insert({ account_id: accountId, name: trimmed, order_url: normaliseOrderUrl(orderUrl) })
    .returning('id');
  await linkSupplierToContact(db, (created as { id: string }).id);
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
  supplier: string | null;
  supplier_order_url: string | null;
  prescriber_name?: string | null;
  prescriber_phone?: string | null;
  critical?: boolean;
  condition_name?: string | null;
  repeats_left?: number | null;
  course_ends_on?: string | null;
  stopped_on?: string | null;
  stop_reason?: string | null;
  instructions?: string | null;
  as_needed_for?: string | null;
  min_hours_between_doses?: unknown;
  max_doses_per_day?: unknown;
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
  supply_remaining: number | null;
  packs_on_hand: number | null;
  repeats_due: string | null;
  supplier: string | null;
  supplier_order_url: string | null;
  prescriber_name: string | null;
  prescriber_phone: string | null;
  critical: boolean;
  condition_name: string | null;
  repeats_left: number | null;
  course_ends_on: string | null;
  stopped_on: string | null;
  stop_reason: string | null;
  instructions: string | null;
  as_needed_for: string | null;
  min_hours_between_doses: number | null;
  max_doses_per_day: number | null;
  active: boolean;
}

/** A date cell as YYYY-MM-DD, or nothing. */
const dayCell = (v: unknown): string | null => {
  const s = String(v ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

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
    min_hours_between_doses: numOrNull(m['min_hours_between_doses']),
    max_doses_per_day: numOrNull(m['max_doses_per_day']),
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
    { key: 'with_food', header: 'With food', aliases: ['food'], toCell: (r) => (r.with_food ? 'Yes' : 'No') },
    { key: 'as_needed', header: 'As needed', aliases: ['prn'], toCell: (r) => (r.as_needed ? 'Yes' : 'No') },
    { key: 'schedule_times', header: 'Times', aliases: ['schedule', 'schedule times', 'time'], toCell: (r) => (r.schedule_times ?? []).join('; ') },
    { key: 'frequency', header: 'How often', aliases: ['frequency'], toCell: (r) => r.frequency ?? '' },
    { key: 'instructions', header: 'Instructions', aliases: ['directions', 'how to take'], toCell: (r) => r.instructions ?? '' },
    // Missing a dose of a critical medicine is dangerous; alerts go sooner.
    { key: 'critical', header: 'Critical', aliases: ['critical medicine', 'high risk'], toCell: (r) => (r.critical ? 'Yes' : 'No') },
    { key: 'condition_name', header: 'Condition', aliases: ['for condition', 'treats', 'linked condition'], toCell: (r) => r.condition_name ?? '' },
    { key: 'as_needed_for', header: 'As needed for', aliases: ['prn for', 'what it is for'], toCell: (r) => r.as_needed_for ?? '' },
    { key: 'min_hours_between_doses', header: 'Hours between doses', aliases: ['minimum hours', 'gap', 'hours apart', 'at least hours apart'], toCell: (r) => (r.min_hours_between_doses == null ? '' : String(Number(r.min_hours_between_doses))) },
    { key: 'max_doses_per_day', header: 'Most in 24 hours', aliases: ['max per day', 'maximum per day', 'most per day', 'no more than per day'], toCell: (r) => (r.max_doses_per_day == null ? '' : String(r.max_doses_per_day)) },
    { key: 'supply', header: 'A full pack provides', aliases: ['supply', 'stock', 'quantity', 'on hand', 'supply in units', 'pack size'], toCell: (r) => (r.supply ?? '').toString() },
    { key: 'supply_remaining', header: 'Units left', aliases: ['remaining', 'supply remaining'], toCell: (r) => (r.supply_remaining ?? '').toString() },
    { key: 'packs_on_hand', header: 'Packs on hand', aliases: ['packs', 'packs left', 'unopened packs'], toCell: (r) => (r.packs_on_hand ?? '').toString() },
    { key: 'repeats_due', header: 'Repeats due', aliases: ['repeat', 'repeat due'], toCell: (r) => dayCell(r.repeats_due) ?? '' },
    { key: 'supplier', header: 'Supplier', aliases: ['pharmacy', 'supplied by'], toCell: (r) => r.supplier ?? '' },
    { key: 'supplier_order_url', header: 'Order link', aliases: ['order url', 'reorder link', 'order'], toCell: (r) => r.supplier_order_url ?? '' },
    { key: 'prescriber_name', header: 'Prescribed by', aliases: ['prescriber', 'prescribed by', 'doctor'], toCell: (r) => r.prescriber_name ?? '' },
    { key: 'prescriber_phone', header: 'Prescriber phone', aliases: ['doctor phone', 'prescriber number'], toCell: (r) => r.prescriber_phone ?? '' },
    { key: 'repeats_left', header: 'Repeats left', aliases: ['repeats left on the script', 'repeats'], toCell: (r) => (r.repeats_left ?? '').toString() },
    { key: 'course_ends_on', header: 'Last day of the course', aliases: ['course ends', 'course end'], toCell: (r) => dayCell(r.course_ends_on) ?? '' },
    { key: 'active', header: 'Active', aliases: ['status'], toCell: (r) => (r.active ? 'Yes' : 'No') },
    { key: 'stopped_on', header: 'Last day taken', aliases: ['stopped on', 'stopped'], toCell: (r) => dayCell(r.stopped_on) ?? '' },
    // The reason as the screen names it; a file read back in may carry either.
    { key: 'stop_reason', header: 'Why it stopped', aliases: ['stop reason'], toCell: (r) => (r.stop_reason ? STOP_REASON_LABELS[r.stop_reason as StopReason] ?? r.stop_reason : '') },
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
        instructions: blank(raw['instructions']),
        as_needed_for: blank(raw['as_needed_for']),
        min_hours_between_doses: (() => {
          const n = parseFloat(String(raw['min_hours_between_doses'] ?? '').replace(/[^0-9.]/g, ''));
          return Number.isFinite(n) && n > 0 && n <= 168 ? Math.round(n * 10) / 10 : null;
        })(),
        max_doses_per_day: (() => {
          const n = parseInt(String(raw['max_doses_per_day'] ?? '').replace(/[^0-9]/g, ''), 10);
          return Number.isFinite(n) && n > 0 && n <= 50 ? n : null;
        })(),
        supply: Number.isFinite(supplyNum) ? supplyNum : null,
        supply_remaining: (() => {
          const left = parseFloat(String(raw['supply_remaining'] ?? '').replace(/[^0-9.]/g, ''));
          return Number.isFinite(left) ? left : null;
        })(),
        packs_on_hand: (() => {
          const packsNum = parseFloat(String(raw['packs_on_hand'] ?? '').replace(/[^0-9.]/g, ''));
          return Number.isFinite(packsNum) ? packsNum : null;
        })(),
        repeats_due: repeats && /^\d{4}-\d{2}-\d{2}$/.test(repeats) ? repeats : null,
        supplier: blank(raw['supplier']),
        supplier_order_url: (() => {
          const u = blank(raw['supplier_order_url']);
          return u && /^https?:\/\//i.test(u) ? u : null;
        })(),
        prescriber_name: blank(raw['prescriber_name']),
        prescriber_phone: blank(raw['prescriber_phone']),
        critical: ['true', 'yes', '1', 'y', 'critical'].includes((raw['critical'] ?? '').trim().toLowerCase()),
        condition_name: blank(raw['condition_name']),
        repeats_left: (() => {
          const n = parseInt(String(raw['repeats_left'] ?? '').replace(/[^0-9]/g, ''), 10);
          return Number.isFinite(n) && n <= 99 ? n : null;
        })(),
        course_ends_on: dayCell(raw['course_ends_on']),
        stopped_on: dayCell(raw['stopped_on']),
        stop_reason: stopReasonFrom(blank(raw['stop_reason'])),
        active: parseActive(raw['active']),
      },
    };
  },
};

const readFormat = (v: unknown): PortFormat => (String(v).toLowerCase() === 'json' ? 'json' : 'csv');

medicationsRouter.get('/', requireAuth, async (req, res) => {
  const profileId = req.params['id'] as string;
  const meds = await medSelect()
    .where('m.care_profile_id', profileId)
    .orderBy([{ column: 'm.active', order: 'desc' }, { column: 'c.name', order: 'asc' }]);
  // Their main pharmacy and GP stand in where a medicine names no supplier
  // or prescriber, so there is always someone to call.
  const [main_pharmacy, main_gp, changes] = await Promise.all([mainContact(db, profileId, 'pharmacy'), mainContact(db, profileId, 'gp'), changesFor(db, profileId)]);
  const withPeople = await withContacts(meds.map(serializeMed), profileId);
  res.json({
    medications: withPeople.map((m) => ({ ...m, changes: changes.get(String(m['id'])) ?? [] })),
    main_pharmacy,
    main_gp,
  });
});

// Export the medication list as CSV or JSON.
medicationsRouter.get('/export', requireAuth, requireAccountRight('can_export_data'), async (req, res) => {
  const format = readFormat(req.query['format']);
  const meds = (await medSelect()
    .where('m.care_profile_id', req.params['id'])
    .orderBy([{ column: 'm.active', order: 'desc' }, { column: 'c.name', order: 'asc' }])) as Array<MedRow & { prescriber_provider_id: string | null }>;
  const prescribers = await contactSummaries(db, meds.map((m) => m.prescriber_provider_id), req.params['id'] as string);
  const withPhones = meds.map((m) => ({ ...m, prescriber_phone: m.prescriber_provider_id ? prescribers.get(m.prescriber_provider_id)?.phone ?? null : null }));
  const { body, contentType, filename } = exportRecords(medPort, withPhones, format);
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

medicationsRouter.post('/import', requireAuth, requireProfileOwner('import medications'), async (req, res) => {
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
    // Link each imported supplier name to the account's shared supplier list,
    // creating one where the name is new, so imports track the same model.
    const supplierId = await resolveSupplierId(r.supplier, r.supplier_order_url, req.account!.id);
    // Who prescribes it, found in Contacts or filed there.
    const prescriber = r.prescriber_name ? await resolveContactInput(db, req.params['id'] as string, { name: r.prescriber_name, phone: r.prescriber_phone }, 'gp') : null;
    const conditionId = r.condition_name ? await resolveConditionId(r.condition_name, req.params['id'] as string) : null;
    toInsert.push({
      prescriber_provider_id: prescriber && !('error' in prescriber) ? prescriber.id : null,
      medical_condition_id: conditionId,
      critical: r.critical,
      care_profile_id: req.params['id'],
      medication_catalogue_id: catalogueId,
      units_per_dose: r.units_per_dose,
      dose_amount: r.dose_amount,
      dose_unit: r.dose_unit,
      dose: composeDose(r.dose_amount, r.dose_unit),
      route: r.route,
      with_food: r.with_food,
      as_needed: r.as_needed,
      instructions: r.instructions,
      as_needed_for: r.as_needed_for,
      // Typed limits win; otherwise they are read from the instructions.
      min_hours_between_doses: r.as_needed ? r.min_hours_between_doses ?? limitsFromText(r.instructions, r.units_per_dose).min_hours_between_doses : null,
      max_doses_per_day: r.as_needed ? r.max_doses_per_day ?? limitsFromText(r.instructions, r.units_per_dose).max_doses_per_day : null,
      frequency: r.frequency,
      supply: r.supply,
      supply_remaining: r.supply_remaining ?? r.supply,
      packs_on_hand: r.packs_on_hand,
      repeats_due: r.repeats_due,
      repeats_left: r.repeats_left,
      course_ends_on: r.course_ends_on,
      stopped_on: r.active ? null : r.stopped_on,
      stop_reason: r.active ? null : r.stop_reason,
      supplier_id: supplierId,
      supplier: r.supplier,
      supplier_order_url: r.supplier_order_url,
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

/** A write that names something that cannot be used, said plainly. */
class MedInputError extends Error {}

// Resolve the condition tie from either an id or a free-typed name, and
// compose the dose columns, shared by create and edit.
async function medFieldsFrom(data: z.infer<typeof medSchema> | Partial<z.infer<typeof medSchema>>, profileId: string, accountId: string) {
  const fields: Record<string, unknown> = {};
  if ('units_per_dose' in data) fields['units_per_dose'] = data.units_per_dose ?? null;
  if ('route' in data) fields['route'] = data.route ?? null;
  if ('with_food' in data) fields['with_food'] = data.with_food ?? false;
  if ('as_needed' in data) fields['as_needed'] = data.as_needed ?? false;
  if ('as_needed_for' in data) fields['as_needed_for'] = data.as_needed_for || null;
  if ('min_hours_between_doses' in data) fields['min_hours_between_doses'] = data.min_hours_between_doses || null;
  if ('max_doses_per_day' in data) fields['max_doses_per_day'] = data.max_doses_per_day || null;
  if ('instructions' in data) fields['instructions'] = data.instructions ?? null;
  if ('frequency' in data) fields['frequency'] = data.frequency ?? null;
  if ('repeats_due' in data) fields['repeats_due'] = data.repeats_due ?? null;
  if ('course_ends_on' in data) fields['course_ends_on'] = data.course_ends_on ?? null;
  if ('repeats_left' in data) fields['repeats_left'] = data.repeats_left ?? null;
  // Supplier: an explicit link from the editor is authoritative and its name
  // and order link are derived from the supplier record; a bare name (import,
  // assistant) resolves to a shared supplier, created if new; clearing removes
  // the tie but keeps any free-typed name and link the caller sent.
  if ('supplier_id' in data && data.supplier_id) {
    const sup = await db('suppliers').where({ id: data.supplier_id, account_id: accountId }).first();
    if (sup) {
      fields['supplier_id'] = sup.id;
      fields['supplier'] = sup.name;
      fields['supplier_order_url'] = sup.order_url ?? null;
    } else {
      fields['supplier_id'] = null;
    }
  } else if ('supplier' in data && (data.supplier ?? '').trim()) {
    const name = (data.supplier ?? '').trim();
    fields['supplier_id'] = await resolveSupplierId(name, data.supplier_order_url, accountId);
    fields['supplier'] = name;
    if ('supplier_order_url' in data) fields['supplier_order_url'] = normaliseOrderUrl(data.supplier_order_url);
  } else if ('supplier_id' in data || 'supplier' in data) {
    // Supplier explicitly cleared.
    fields['supplier_id'] = null;
    if ('supplier' in data) fields['supplier'] = null;
    if ('supplier_order_url' in data) fields['supplier_order_url'] = normaliseOrderUrl(data.supplier_order_url);
  } else if ('supplier_order_url' in data) {
    fields['supplier_order_url'] = normaliseOrderUrl(data.supplier_order_url);
  }
  if ('critical' in data) fields['critical'] = data.critical ?? false;
  if ('active' in data) fields['active'] = data.active ?? true;

  // Who prescribes it: picked, or named and filed in Contacts.
  if ('prescriber_provider_id' in data || 'prescriber_name' in data) {
    const who = await resolveContactInput(
      db,
      profileId,
      { id: data.prescriber_provider_id, name: data.prescriber_name, type: data.prescriber_type, phone: data.prescriber_phone },
      'gp'
    );
    if ('error' in who) throw new MedInputError(who.error);
    fields['prescriber_provider_id'] = who.id;
  }
  if ('source_appointment_id' in data) {
    if (data.source_appointment_id) {
      const appt = await db('appointments').where({ id: data.source_appointment_id, care_profile_id: profileId }).first('id');
      if (!appt) throw new MedInputError('That appointment is not one of this person\'s.');
    }
    fields['source_appointment_id'] = data.source_appointment_id ?? null;
  }

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

/**
 * Limits read from the instructions, for the ones nobody typed. A limit that
 * was itself worked out from the old instructions follows the new ones; a
 * limit someone typed stays.
 */
function workedOutLimits(
  data: Partial<z.infer<typeof medSchema>>,
  current: { instructions: string | null; min_hours_between_doses: unknown; max_doses_per_day: unknown; as_needed?: boolean; units_per_dose?: unknown } | null
): Record<string, unknown> {
  // Only an as-needed medicine has limits: a scheduled one runs to its times.
  const asNeeded = 'as_needed' in data ? !!data.as_needed : !!current?.as_needed;
  if (!asNeeded) {
    return 'as_needed' in data ? { min_hours_between_doses: null, max_doses_per_day: null } : {};
  }
  if (!('instructions' in data)) return {};
  const per = 'units_per_dose' in data ? data.units_per_dose : current?.units_per_dose == null ? null : Number(current.units_per_dose);
  const next = limitsFromText(data.instructions, per);
  const before = limitsFromText(current?.instructions ?? null, per);
  const out: Record<string, unknown> = {};
  const follows = (now: unknown, was: number | null) => now == null || (was != null && Number(now) === was);
  if (!('min_hours_between_doses' in data) && follows(current?.min_hours_between_doses, before.min_hours_between_doses)) {
    out['min_hours_between_doses'] = next.min_hours_between_doses;
  }
  if (!('max_doses_per_day' in data) && follows(current?.max_doses_per_day, before.max_doses_per_day)) {
    out['max_doses_per_day'] = next.max_doses_per_day;
  }
  return out;
}

/**
 * What a contributor may change on a medicine: the dose, times,
 * instructions, units per dose and with food, through the change flow with
 * a reason. Adding, deleting, importing and changing several at once stay
 * with the owner.
 */
const CONTRIBUTOR_FIELDS = new Set([
  'dose', 'dose_amount', 'dose_unit', 'schedule_times', 'instructions', 'units_per_dose', 'with_food',
  'change_reason', 'change_source_appointment_id', 'change_source_document_id', 'change_source_provider_id',
  'change_source_provider_name', 'change_source_provider_type', 'change_source_provider_phone',
]);

medicationsRouter.post('/', requireAuth, requireProfileOwner('add a medication'), async (req, res) => {
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
  let fields: Record<string, unknown>;
  try {
    fields = await medFieldsFrom(parsed.data, req.params['id']!, req.account!.id);
  } catch (err) {
    if (err instanceof MedInputError) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
  Object.assign(fields, workedOutLimits(parsed.data, null));
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
  const medId = (med as { id: string }).id;
  // Its history starts here, with the visit or letter it came from.
  await recordMedicationChange(db, {
    medicationId: medId,
    profileId: req.params['id']!,
    actorId: req.account!.id,
    kind: 'started',
    source: {
      reason: parsed.data.change_reason,
      source_appointment_id: parsed.data.change_source_appointment_id ?? parsed.data.source_appointment_id,
      source_document_id: parsed.data.change_source_document_id,
    },
  });
  res.status(201).json({ medication: await medOut(medId, req.params['id']!) });
});

medicationsRouter.patch('/:medId', requireAuth, async (req, res) => {
  const parsed = medSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  // A contributor records a change the doctor or pharmacist asked for: the
  // dose, times, instructions, units per dose or with food, with why.
  const level = req.careAccess?.level;
  const contributor = level === 'contributor';
  if (level !== 'owner' && level !== 'admin') {
    const outside = Object.keys(parsed.data).filter((k) => !CONTRIBUTOR_FIELDS.has(k));
    if (!contributor || outside.length > 0) {
      res.status(403).json({
        error: await ownerOnlyMessage(req.params['id'], "add or delete medicines, or change a medicine's name, supplier or supply"),
        code: 'OWNER_ONLY',
      });
      return;
    }
    if (!parsed.data.change_reason?.trim()) {
      res.status(400).json({ error: 'Say why it changed, then save the change again.', code: 'REASON_REQUIRED', field: 'change_reason' });
      return;
    }
  }
  if (!(await conditionBelongsToProfile(parsed.data.medical_condition_id, req.params['id']!))) {
    res.status(400).json({ error: 'Condition not found', code: 'VALIDATION_ERROR' });
    return;
  }
  let fields: Record<string, unknown>;
  try {
    fields = await medFieldsFrom(parsed.data, req.params['id']!, req.account!.id);
  } catch (err) {
    if (err instanceof MedInputError) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
  // Active or not is a stop or a start, kept in its history, never a bare flag.
  const { active: activeChange, ...rest } = fields;
  const update: Record<string, unknown> = { ...rest, updated_at: db.fn.now() };
  if (parsed.data.schedule_times !== undefined) {
    update['schedule_times'] = parsed.data.schedule_times ? db.raw('?::jsonb', [JSON.stringify(parsed.data.schedule_times)]) : null;
  }
  // Pack size, units-on-hand and packs-on-hand are edited independently.
  if (parsed.data.supply !== undefined) update['supply'] = parsed.data.supply;
  if (parsed.data.supply_remaining !== undefined) update['supply_remaining'] = parsed.data.supply_remaining;
  if (parsed.data.packs_on_hand !== undefined) update['packs_on_hand'] = parsed.data.packs_on_hand;
  // Topping up stock by hand completes the reorder workflow: an outstanding
  // order has arrived, so clear the "ordered" mark.
  if (
    (parsed.data.supply_remaining != null && parsed.data.supply_remaining > 0) ||
    (parsed.data.packs_on_hand != null && parsed.data.packs_on_hand > 0)
  ) {
    update['reorder_ordered_at'] = null;
    // Restocked: a dose found not in stock no longer says it has run out.
    update['not_in_stock_admin_id'] = null;
  }
  // Changing the drug identity re-points the medication at a catalogue entry.
  if (parsed.data.name !== undefined) {
    update['medication_catalogue_id'] = await resolveCatalogueId(parsed.data.name, parsed.data.form ?? null, req.account!.id);
  }
  const med = (await db('medications').where({ id: req.params['medId'], care_profile_id: req.params['id'] }).first('id', 'instructions', 'min_hours_between_doses', 'max_doses_per_day', 'units_per_dose', 'with_food', 'as_needed')) as
    | { id: string; instructions: string | null; min_hours_between_doses: unknown; max_doses_per_day: unknown; units_per_dose: unknown; with_food: boolean; as_needed: boolean }
    | undefined;
  if (!med) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  Object.assign(update, workedOutLimits(parsed.data, med));
  // A change from a contributor is always kept, even when it is only the
  // instructions, units per dose or with food.
  const otherMoved =
    contributor &&
    (('instructions' in parsed.data && (parsed.data.instructions ?? null) !== med.instructions) ||
      ('units_per_dose' in parsed.data && Number(parsed.data.units_per_dose ?? 0) !== Number(med.units_per_dose ?? 0)) ||
      ('with_food' in parsed.data && !!parsed.data.with_food !== !!med.with_food));
  // Who said so: picked from Contacts, or a new name filed there.
  let saidBy = parsed.data.change_source_provider_id ?? null;
  if (saidBy && parsed.data.change_source_provider_phone) {
    // A number typed for a picked contact with none fills their empty phone.
    const who = await resolveContactInput(db, req.params['id']!, { id: saidBy, phone: parsed.data.change_source_provider_phone }, 'gp');
    if ('error' in who) {
      res.status(400).json({ error: who.error, code: 'VALIDATION_ERROR' });
      return;
    }
  }
  if (!saidBy && parsed.data.change_source_provider_name) {
    const who = await resolveContactInput(
      db,
      req.params['id']!,
      { name: parsed.data.change_source_provider_name, type: parsed.data.change_source_provider_type, phone: parsed.data.change_source_provider_phone },
      'gp'
    );
    if ('error' in who) {
      res.status(400).json({ error: who.error, code: 'VALIDATION_ERROR' });
      return;
    }
    saidBy = who.id;
  }
  // A new dose or new times go in its history with why and where from.
  await db.transaction(async (trx) => {
    const source = {
      reason: parsed.data.change_reason,
      source_appointment_id: parsed.data.change_source_appointment_id,
      source_document_id: parsed.data.change_source_document_id,
      source_provider_id: saidBy,
    };
    const kept = await recordMedicationChange(trx, { medicationId: med.id, profileId: req.params['id']!, actorId: req.account!.id, patch: update, source });
    if (!kept.change_id && otherMoved) {
      await recordMedicationChange(trx, { medicationId: med.id, profileId: req.params['id']!, actorId: req.account!.id, kind: 'other', source });
    }
  });
  if (typeof activeChange === 'boolean') {
    // Stopped or started from a letter or a visit: the stop or start cites it.
    await setActive(db, req.params['id']!, req.account!.id, [med.id], activeChange, {
      reason: parsed.data.change_reason,
      source_appointment_id: parsed.data.change_source_appointment_id,
      source_document_id: parsed.data.change_source_document_id,
    });
  }
  // Restocking clears any "out of stock" acknowledgement, so the urgent alert
  // recurs if this medication runs out again later.
  if (
    (parsed.data.supply_remaining != null && parsed.data.supply_remaining > 0) ||
    (parsed.data.packs_on_hand != null && parsed.data.packs_on_hand > 0)
  ) {
    await db('attention_dismissals').where({ item_key: `out_of_stock:${req.params['medId']}` }).delete();
  }
  res.json({ medication: await medOut((med as { id: string }).id, req.params['id']!) });
});

// Bulk actions on the list. Delete is limited to the profile owner and
// platform admins/super admins (requireProfileOwner); contributors and
// viewers can sort/filter but never bulk-delete. Scoped to this profile, so
// an admin only ever deletes medications for a person in their care.
const bulkSchema = z.object({
  action: z.enum(['delete', 'activate', 'deactivate', 'update']),
  ids: z.array(z.string().uuid()).min(1).max(500),
  // For 'update': the fields to apply to every selected medication. Only the
  // keys present are changed (e.g. supplier, route, with food, dangerous to
  // miss, active). Per-medication facts like name, schedule and supply counts
  // are not bulk-editable, as they differ from one medication to the next.
  fields: medSchema.partial().optional(),
});

medicationsRouter.post('/bulk', requireAuth, requireProfileOwner('change several medications at once'), async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const scope = db('medications').where({ care_profile_id: req.params['id'] }).whereIn('id', parsed.data.ids);
  if (parsed.data.action === 'delete') {
    const gone = (await scope.clone().pluck('id')) as string[];
    const deleted = await scope.del();
    // Letters no longer list a medicine that is gone.
    if (gone.length) await db('document_links').where({ entity_type: 'medications' }).whereIn('entity_id', gone).delete();
    res.json({ deleted });
    return;
  }
  if (parsed.data.action === 'update') {
    // Resolve the same way a single edit does (supplier link, composed dose,
    // condition tie), but only for the fields supplied; then apply to all.
    let fields: Record<string, unknown>;
    try {
      fields = await medFieldsFrom(parsed.data.fields ?? {}, req.params['id']!, req.account!.id);
    } catch (err) {
      if (err instanceof MedInputError) {
        res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
        return;
      }
      throw err;
    }
    if (Object.keys(fields).length === 0) {
      res.status(400).json({ error: 'Choose at least one field to change.', code: 'VALIDATION_ERROR' });
      return;
    }
    const { active: activeChange, ...rest } = fields;
    const updated = Object.keys(rest).length ? await scope.clone().update({ ...rest, updated_at: db.fn.now() }) : parsed.data.ids.length;
    if (typeof activeChange === 'boolean') await setActive(db, req.params['id']!, req.account!.id, parsed.data.ids, activeChange);
    res.json({ updated });
    return;
  }
  // Marked inactive is stopped today; marked active is started again. Each
  // goes in that medicine's history.
  const updated = await setActive(db, req.params['id']!, req.account!.id, parsed.data.ids, parsed.data.action === 'activate');
  res.json({ updated });
});

/**
 * Stop or start medicines again, each kept in its history. Ones already in
 * the asked-for state are left alone.
 */
async function setActive(conn: typeof db, profileId: string, actorId: string, ids: string[], active: boolean, source?: ChangeSource): Promise<number> {
  const rows = (await conn('medications').where({ care_profile_id: profileId }).whereIn('id', ids).select('id', 'active')) as Array<{ id: string; active: boolean }>;
  let n = 0;
  await conn.transaction(async (trx) => {
    for (const r of rows) {
      if (!active && r.active) {
        await stopMedication(trx, { medicationId: r.id, profileId, actorId, source });
        n += 1;
      } else if (active && !r.active) {
        await restartMedication(trx, { medicationId: r.id, profileId, actorId, source });
        n += 1;
      }
    }
  });
  return n;
}

const stopSchema = z.object({
  stopped_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  stop_reason: z.enum(STOP_REASONS).optional().nullable(),
  stop_notes: z.string().trim().max(2000).optional().nullable(),
  source_appointment_id: z.string().uuid().optional().nullable(),
  source_document_id: z.string().uuid().optional().nullable(),
});

// Stop a medicine: it comes off the active list with the last day taken,
// why it stopped and their words, and the stop goes in its history.
medicationsRouter.post('/:medId/stop', requireAuth, requireProfileOwner('stop a medication'), async (req, res) => {
  const parsed = stopSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Pick the last day it was taken and why it stopped, then try again.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = req.params['id']!;
  const result = await db.transaction((trx) =>
    stopMedication(trx, {
      medicationId: String(req.params['medId']),
      profileId,
      actorId: req.account!.id,
      stopped_on: parsed.data.stopped_on,
      stop_reason: parsed.data.stop_reason,
      stop_notes: parsed.data.stop_notes,
      source: { source_appointment_id: parsed.data.source_appointment_id, source_document_id: parsed.data.source_document_id },
    })
  );
  if (!result.change_id) {
    res.status(404).json({ error: 'That medication could not be found. It may have been deleted.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ medication: await medOut(String(req.params['medId']), profileId), change_id: result.change_id });
});

// Start a stopped medicine again. Undo straight after a stop takes the stop
// back out of the history.
medicationsRouter.post('/:medId/restart', requireAuth, requireProfileOwner('start a medication again'), async (req, res) => {
  const undo = z.object({ undo_change_id: z.string().uuid().optional().nullable() }).safeParse(req.body ?? {});
  const profileId = req.params['id']!;
  const ok = await db.transaction((trx) =>
    restartMedication(trx, { medicationId: String(req.params['medId']), profileId, actorId: req.account!.id, undoChangeId: undo.success ? undo.data.undo_change_id : null })
  );
  if (!ok) {
    res.status(404).json({ error: 'That medication could not be found. It may have been deleted.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ medication: await medOut(String(req.params['medId']), profileId) });
});

medicationsRouter.delete('/:medId', requireAuth, requireProfileOwner('delete a medication'), async (req, res) => {
  const affected = await db('medications').where({ id: req.params['medId'], care_profile_id: req.params['id'] }).del();
  // Letters no longer list a medicine that is gone.
  if (affected) await db('document_links').where({ entity_type: 'medications', entity_id: String(req.params['medId']) }).delete();
  if (!affected) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Medication removed.' });
});

// The reorder workflow for a medication running low: mark it ordered when a
// repeat is requested, and replenished when it arrives. Replenishing clears
// the order and optionally records the new stock, so the person's supply and
// the "not replenished" alert stay honest.
const reorderSchema = z.object({
  action: z.enum(['ordered', 'replenished']),
  packs_on_hand: z.coerce.number().min(0).max(1e6).optional(),
  supply_remaining: z.coerce.number().min(0).max(1e9).optional(),
  // What the repeat cost. Recorded as a dated health-spend entry when the
  // packs arrive, since that is the moment the money is spent.
  amount_paid: z.coerce.number().min(0).max(1e9).optional().nullable(),
});

// Anyone helping with care, not only the owner, marks a repeat as ordered or
// arrived: whoever is on shift is the one who rings the pharmacy.
medicationsRouter.post('/:medId/reorder', requireAuth, async (req, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const update: Record<string, unknown> = { updated_at: db.fn.now() };
  if (parsed.data.action === 'ordered') {
    update['reorder_ordered_at'] = db.fn.now();
  } else {
    // Replenished: the order has arrived. Clear it and record what came in.
    update['reorder_ordered_at'] = null;
    update['not_in_stock_admin_id'] = null;
    if (parsed.data.packs_on_hand !== undefined) update['packs_on_hand'] = parsed.data.packs_on_hand;
    if (parsed.data.supply_remaining !== undefined) update['supply_remaining'] = parsed.data.supply_remaining;
  }
  const [med] = await db('medications')
    .where({ id: req.params['medId'], care_profile_id: req.params['id'] })
    .update(update)
    .returning('id');
  if (!med) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  // A restock clears any out-of-stock acknowledgement, so the alert recurs if
  // it runs out again later.
  if (parsed.data.action === 'replenished') {
    await db('attention_dismissals').where({ item_key: `out_of_stock:${req.params['medId']}` }).delete();
    // Log what the repeat cost, dated to today, as a confirmed spend entry.
    if (parsed.data.amount_paid != null && parsed.data.amount_paid > 0) {
      await db('health_spend_entries').insert({
        care_profile_id: req.params['id'],
        amount: parsed.data.amount_paid,
        spent_on: new Date().toISOString().slice(0, 10),
        category: 'medication',
        status: 'confirmed',
        medication_id: req.params['medId'],
        created_by_account_id: req.account!.id,
      });
    }
  }
  res.json({ medication: await medOut((med as { id: string }).id, req.params['id']!) });
});

// Chart view: the active regimen plus every administration touching the
// window (matched to a scheduled slot by scheduled_for, or ad-hoc). The
// frontend composes the schedule grid from this.
medicationsRouter.get('/chart', requireAuth, async (req, res) => {
  const from = req.query['from'] ? new Date(String(req.query['from'])) : new Date(Date.now() - 24 * 3600 * 1000);
  const to = req.query['to'] ? new Date(String(req.query['to'])) : new Date(Date.now() + 24 * 3600 * 1000);
  // A finished course has no doses due; it asks whether to stop it instead.
  const medications = await medSelect().where('m.care_profile_id', req.params['id']).andWhere('m.active', true).whereRaw(COURSE_RUNNING_SQL);
  const administrations = await db('medication_administrations')
    .where('care_profile_id', req.params['id'])
    .andWhere((qb) =>
      qb.whereBetween('administered_at', [from, to]).orWhereBetween('scheduled_for', [from, to])
    )
    .orderBy('administered_at', 'asc');
  // Last given and the count in 24 hours, for the as-needed line on each row.
  const history = await doseHistory(db, medications.filter(limitedOrAsNeeded).map((m) => m.id as string));
  res.json({
    medications: medications.map((m) => ({ ...serializeMed(m), dose_history: history.get(m.id as string) ?? null })),
    administrations,
  });
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
      'a.dose_given', 'a.route_given', 'a.notes', 'a.reason', 'a.outside_limits', 'a.outside_limits_reason',
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
        'a.dose_given', 'a.route_given', 'a.notes', 'a.reason', 'a.outside_limits', 'a.outside_limits_reason',
        'a.right_patient', 'a.right_medication', 'a.right_dose', 'a.right_route', 'a.right_time', 'a.right_documentation',
        db.raw('true as archived')
      );
    base = db.from(hot.unionAll([archived]).as('x'));
  }

  base = base.modify((qb) => {
    if (q) qb.where((w) => w.whereILike('medication_name', `%${q}%`).orWhereILike('notes', `%${q}%`).orWhereILike('reason', `%${q}%`).orWhereILike('administered_by_name', `%${q}%`));
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
  status: z.enum(DOSE_STATUSES).default('given'),
  dose_given: z.string().max(255).optional().nullable(),
  route_given: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
  // Why an as-needed dose was needed now.
  reason: z.string().max(2000).optional().nullable(),
  // Why it had to be given inside the gap or over the most in 24 hours.
  outside_limits_reason: z.string().max(2000).optional().nullable(),
  // Only the dose, route and time rights are verified at the point of care.
  // Patient, medication and documentation are guaranteed by the context
  // (you are on this person's record, you picked this medication, and the
  // act of recording is the documentation) and are set server-side.
  right_dose: z.boolean().optional(),
  right_route: z.boolean().optional(),
  right_time: z.boolean().optional(),
});

const GIVEN = GIVEN_STATUSES;

// One activity line per dose, saying the outcome: "Metoprolol as refused".
const doseAudit = (
  action: AuditEntry['action'],
  entityId: string | null,
  medicationName: string,
  status: string
): AuditEntry => ({ action, entity_type: DOSE_AUDIT_ENTITY, entity_id: entityId, summary: doseSummary(medicationName, status) });
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

/** A dose that could not be recorded, said plainly with what to fix. */
function sendDoseProblem(res: import('express').Response, err: unknown): boolean {
  if (!(err instanceof DoseProblem)) return false;
  const status = err.code === 'OUTSIDE_LIMITS' ? 409 : err.code === 'UNKNOWN_MEDICATION' ? 404 : 400;
  res.status(status).json({ error: err.message, code: err.code, limits: err.limits ?? null });
  return true;
}

medicationsRouter.post('/:medId/administrations', requireAuth, async (req, res) => {
  const parsed = adminSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  let result;
  try {
    result = await db.transaction((trx) =>
      recordDoses(trx, { profileId: req.params['id']!, account: req.account!, entries: [{ ...parsed.data, medication_id: String(req.params['medId']) }] })
    );
  } catch (err) {
    if (sendDoseProblem(res, err)) return;
    throw err;
  }
  const dose = result.doses[0]!;
  const med = result.meds.get(dose.medication_id)!;
  const record = await db('medication_administrations').where({ id: dose.id }).first();
  res.locals['auditEntries'] = [doseAudit('created', dose.id, med.name, dose.status)];
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
  let result;
  try {
    result = await db.transaction((trx) => recordDoses(trx, { profileId: req.params['id']!, account: req.account!, entries: parsed.data.entries }));
  } catch (err) {
    if (sendDoseProblem(res, err)) return;
    throw err;
  }
  res.locals['auditEntries'] = result.doses.map((r) => doseAudit('created', r.id, result.meds.get(r.medication_id)!.name, r.status));
  res.status(201).json({ recorded: result.doses.length });
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
  const med = await medSelect().where('m.id', admin.medication_id).first();
  if (GIVEN.has(admin.status) && med) await restoreSupply(med, 1);
  await db('medication_administrations').where({ id: admin.id }).delete();
  res.locals['auditEntries'] = [doseAudit('deleted', admin.id, med?.name ?? 'A medication', admin.status)];
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
      'a.dose_given', 'a.route_given', 'a.notes', 'a.reason', 'a.outside_limits', 'a.outside_limits_reason',
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

/**
 * A dose corrected to Not in stock raises the out-of-stock alert; one
 * corrected away from it takes the alert back, without touching the stock.
 */
async function syncNotInStock(adminId: string, medicationId: string, status: string): Promise<void> {
  if (status === 'not_in_stock') {
    await db('medications').where({ id: medicationId }).update({ not_in_stock_admin_id: adminId });
    await db('attention_dismissals').where({ item_key: `out_of_stock:${medicationId}` }).delete();
  } else {
    await db('medications').where({ id: medicationId, not_in_stock_admin_id: adminId }).update({ not_in_stock_admin_id: null });
  }
}

// Fields the record can be corrected on: when it happened, the outcome, and
// the note. Each is its own data point, edited on its own.
const adminEditSchema = z.object({
  administered_at: z.string().optional(),
  status: z.enum(DOSE_STATUSES).optional(),
  notes: z.string().optional().nullable(),
  reason: z.string().max(2000).optional().nullable(),
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
  if (data.reason !== undefined) update['reason'] = data.reason?.trim() ? data.reason.trim() : null;
  if (data.status !== undefined) {
    update['status'] = data.status;
    // A not-given outcome still needs its reason; use the new note if one was
    // supplied, otherwise the note already on the record.
    if (!noteOptional(data.status)) {
      const note = data.notes !== undefined ? data.notes : current.notes;
      if (!note?.trim()) return { ok: false, code: 'NOTE_REQUIRED' };
    }
  }
  return { ok: true, update };
}

const NOTE_REQUIRED_MSG = 'A note is required when the outcome is refused, omitted or held.';

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
  if (parsed.data.status !== undefined) {
    await reconcileSupplyForStatus(admin.status, parsed.data.status, admin.medication_id);
    await syncNotInStock(admin.id, admin.medication_id, parsed.data.status);
  }
  const row = await adminLogRow(req.params['id']!, admin.id);
  res.locals['auditEntries'] = [doseAudit('updated', admin.id, row?.medication_name ?? 'A medication', row?.status ?? admin.status)];
  res.json({ administration: row });
});

// Bulk correction or removal across selected records. Update applies the same
// time and/or outcome to every selected dose; delete removes them and hands
// back the supply of any that were given. Archived rows are never touched.
const adminBulkSchema = z
  .object({
    action: z.enum(['update', 'delete']),
    ids: z.array(z.string().uuid()).min(1).max(500),
    administered_at: z.string().optional(),
    status: z.enum(DOSE_STATUSES).optional(),
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
  // The medicine names, for one activity line per dose changed.
  const nameRows = (await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .whereIn('m.id', [...new Set(records.map((r) => r.medication_id as string))])
    .select('m.id', 'c.name')) as Array<{ id: string; name: string }>;
  const nameOf = new Map(nameRows.map((r) => [r.id, r.name]));
  const medName = (id: string) => nameOf.get(id) ?? 'A medication';

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
    res.locals['auditEntries'] = records.map((r) => doseAudit('deleted', r.id, medName(r.medication_id), r.status));
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
    if (parsed.data.status !== undefined) {
      await reconcileSupplyForStatus(e.oldStatus, parsed.data.status, e.medicationId);
      await syncNotInStock(e.id, e.medicationId, parsed.data.status);
    }
  }
  res.locals['auditEntries'] = edits.map((e) => doseAudit('updated', e.id, medName(e.medicationId), parsed.data.status ?? e.oldStatus));
  res.json({ updated: edits.length });
});
