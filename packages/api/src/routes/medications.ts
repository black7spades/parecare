import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

export const medicationsRouter = Router({ mergeParams: true });

const RIGHTS = ['right_patient', 'right_medication', 'right_dose', 'right_route', 'right_time', 'right_documentation'] as const;

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

medicationsRouter.get('/', requireAuth, async (req, res) => {
  const meds = await db('medications')
    .where({ care_profile_id: req.params['id'] })
    .orderBy([{ column: 'active', order: 'desc' }, { column: 'name', order: 'asc' }]);
  res.json({ medications: meds });
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
  status: z.enum(['given', 'refused', 'omitted', 'held', 'self_administered']).default('given'),
  dose_given: z.string().max(255).optional().nullable(),
  route_given: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
  right_patient: z.boolean().optional(),
  right_medication: z.boolean().optional(),
  right_dose: z.boolean().optional(),
  right_route: z.boolean().optional(),
  right_time: z.boolean().optional(),
  right_documentation: z.boolean().optional(),
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
  const rights = Object.fromEntries(RIGHTS.map((r) => [r, !!parsed.data[r]]));
  const [record] = await db('medication_administrations')
    .insert({
      medication_id: med.id,
      care_profile_id: req.params['id'],
      scheduled_for: parsed.data.scheduled_for ? new Date(parsed.data.scheduled_for) : null,
      administered_by_account_id: req.account!.id,
      administered_by_name: req.account!.display_name,
      status: parsed.data.status,
      dose_given: parsed.data.dose_given ?? med.dose ?? null,
      route_given: parsed.data.route_given ?? med.route ?? null,
      notes: parsed.data.notes ?? null,
      ...rights,
    })
    .returning('*');
  res.status(201).json({ administration: record });
});
