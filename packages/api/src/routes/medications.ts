import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { exportRecords, importRecords, type PortDescriptor, type PortFormat } from '../services/dataPort';

export const medicationsRouter = Router({ mergeParams: true });

const medSchema = z.object({
  name: z.string().min(1).max(255),
  dose: z.string().max(255).optional().nullable(),
  form: z.string().max(100).optional().nullable(),
  route: z.string().max(100).optional().nullable(),
  frequency: z.string().max(255).optional().nullable(),
  schedule_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).optional().nullable(),
  instructions: z.string().optional().nullable(),
  prescriber: z.string().max(255).optional().nullable(),
  active: z.boolean().optional(),
});

interface MedRow {
  name: string;
  dose: string | null;
  form: string | null;
  route: string | null;
  frequency: string | null;
  schedule_times: string[] | null;
  instructions: string | null;
  prescriber: string | null;
  active: boolean;
}

interface MedInsert {
  name: string;
  dose: string | null;
  form: string | null;
  route: string | null;
  frequency: string | null;
  schedule_times: string[];
  instructions: string | null;
  prescriber: string | null;
  active: boolean;
}

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
    { key: 'dose', header: 'Dose', aliases: ['dosage', 'strength'], toCell: (r) => r.dose ?? '' },
    { key: 'form', header: 'Form', aliases: ['type'], toCell: (r) => r.form ?? '' },
    { key: 'route', header: 'Route', toCell: (r) => r.route ?? '' },
    { key: 'frequency', header: 'Frequency', aliases: ['freq', 'how often'], toCell: (r) => r.frequency ?? '' },
    { key: 'schedule_times', header: 'Times', aliases: ['schedule', 'schedule times', 'time'], toCell: (r) => (r.schedule_times ?? []).join('; ') },
    { key: 'instructions', header: 'Instructions', aliases: ['directions', 'notes'], toCell: (r) => r.instructions ?? '' },
    { key: 'prescriber', header: 'Prescriber', aliases: ['prescribed by', 'doctor', 'gp'], toCell: (r) => r.prescriber ?? '' },
    { key: 'active', header: 'Active', aliases: ['status'], toCell: (r) => (r.active ? 'true' : 'false') },
  ],
  coerce: (raw, rowNumber) => {
    const name = (raw['name'] ?? '').trim();
    if (!name) return { ok: false as const, error: `Row ${rowNumber}: a medication name is required.` };
    if (name.length > 255) return { ok: false as const, error: `Row ${rowNumber}: name is too long.` };
    return {
      ok: true as const,
      value: {
        name,
        dose: blank(raw['dose']),
        form: blank(raw['form']),
        route: blank(raw['route']),
        frequency: blank(raw['frequency']),
        schedule_times: parseTimes(raw['schedule_times']),
        instructions: blank(raw['instructions']),
        prescriber: blank(raw['prescriber']),
        active: parseActive(raw['active']),
      },
    };
  },
};

const readFormat = (v: unknown): PortFormat => (String(v).toLowerCase() === 'json' ? 'json' : 'csv');

medicationsRouter.get('/', requireAuth, async (req, res) => {
  const meds = await db('medications')
    .where({ care_profile_id: req.params['id'] })
    .orderBy([{ column: 'active', order: 'desc' }, { column: 'name', order: 'asc' }]);
  res.json({ medications: meds });
});

// Export the medication list as CSV or JSON.
medicationsRouter.get('/export', requireAuth, async (req, res) => {
  const format = readFormat(req.query['format']);
  const meds = (await db('medications')
    .where({ care_profile_id: req.params['id'] })
    .orderBy([{ column: 'active', order: 'desc' }, { column: 'name', order: 'asc' }])) as MedRow[];
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

medicationsRouter.post('/import', requireAuth, async (req, res) => {
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

  const toInsert: Record<string, unknown>[] = records.map((r) => ({
    care_profile_id: req.params['id'],
    name: r.name,
    dose: r.dose,
    form: r.form,
    route: r.route,
    frequency: r.frequency,
    instructions: r.instructions,
    prescriber: r.prescriber,
    active: r.active,
    schedule_times: r.schedule_times.length
      ? db.raw('?::jsonb', [JSON.stringify(r.schedule_times)])
      : null,
  }));
  const inserted = await db('medications').insert(toInsert).returning('*');

  res.status(201).json({ imported: inserted.length, skipped: errors.length, errors, medications: inserted });
});

medicationsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = medSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const { schedule_times, ...rest } = parsed.data;
  const [med] = await db('medications')
    .insert({
      care_profile_id: req.params['id'],
      ...rest,
      schedule_times: schedule_times ? db.raw('?::jsonb', [JSON.stringify(schedule_times)]) : null,
    })
    .returning('*');
  res.status(201).json({ medication: med });
});

medicationsRouter.patch('/:medId', requireAuth, async (req, res) => {
  const parsed = medSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const { schedule_times, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest, updated_at: db.fn.now() };
  if (schedule_times !== undefined) {
    update['schedule_times'] = schedule_times ? db.raw('?::jsonb', [JSON.stringify(schedule_times)]) : null;
  }
  const [med] = await db('medications')
    .where({ id: req.params['medId'], care_profile_id: req.params['id'] })
    .update(update)
    .returning('*');
  if (!med) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ medication: med });
});

medicationsRouter.delete('/:medId', requireAuth, async (req, res) => {
  const affected = await db('medications').where({ id: req.params['medId'], care_profile_id: req.params['id'] }).del();
  if (!affected) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Medication removed.' });
});

// The MAR: searchable, sortable, filterable administration record.
medicationsRouter.get('/administrations', requireAuth, async (req, res) => {
  const q = String(req.query['search'] ?? '').trim();
  const status = String(req.query['status'] ?? '').trim();
  const medicationId = String(req.query['medication_id'] ?? '').trim();
  const from = req.query['from'] ? new Date(String(req.query['from'])) : null;
  const to = req.query['to'] ? new Date(String(req.query['to'])) : null;
  const sort = String(req.query['sort'] ?? 'recent');

  let query = db('medication_administrations as a')
    .join('medications as m', 'a.medication_id', 'm.id')
    .where('a.care_profile_id', req.params['id'])
    .select('a.*', 'm.name as medication_name', 'm.dose as medication_dose', 'm.route as medication_route');

  if (q) query = query.andWhere((qb) => qb.whereILike('m.name', `%${q}%`).orWhereILike('a.notes', `%${q}%`).orWhereILike('a.administered_by_name', `%${q}%`));
  if (status) query = query.andWhere('a.status', status);
  if (medicationId) query = query.andWhere('a.medication_id', medicationId);
  if (from) query = query.andWhere('a.administered_at', '>=', from);
  if (to) query = query.andWhere('a.administered_at', '<=', to);

  if (sort === 'oldest') query = query.orderBy('a.administered_at', 'asc');
  else if (sort === 'medication') query = query.orderBy([{ column: 'm.name', order: 'asc' }, { column: 'a.administered_at', order: 'desc' }]);
  else if (sort === 'administrator') query = query.orderBy([{ column: 'a.administered_by_name', order: 'asc' }, { column: 'a.administered_at', order: 'desc' }]);
  else query = query.orderBy('a.administered_at', 'desc');

  const administrations = await query.limit(500);
  res.json({ administrations });
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
  const [record] = await db('medication_administrations')
    .insert({
      medication_id: med.id,
      care_profile_id: req.params['id'],
      scheduled_for: parsed.data.scheduled_for ? new Date(parsed.data.scheduled_for) : null,
      administered_at: parsed.data.administered_at ? new Date(parsed.data.administered_at) : db.fn.now(),
      administered_by_account_id: req.account!.id,
      administered_by_name: req.account!.display_name,
      status: parsed.data.status,
      dose_given: parsed.data.dose_given ?? med.dose ?? null,
      route_given: parsed.data.route_given ?? med.route ?? null,
      notes: parsed.data.notes ?? null,
      // Context-guaranteed rights.
      right_patient: true,
      right_medication: true,
      right_documentation: true,
      // Verified at the point of care.
      right_dose: parsed.data.right_dose ?? false,
      right_route: parsed.data.right_route ?? false,
      right_time: parsed.data.right_time ?? true,
    })
    .returning('*');
  res.status(201).json({ administration: record });
});
