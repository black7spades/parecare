import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * Appointments are a first-class record: who is being seen, what for,
 * where and when. They feed the profile calendar (which feeds the
 * overview) rather than living inside it.
 */

export const appointmentsRouter = Router({ mergeParams: true });

export const APPOINTMENT_TYPES = [
  'consultation',
  'test',
  'procedure',
  'therapy',
  'review',
  'vaccination',
  'other',
] as const;
export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'missed'] as const;

const appointmentSchema = z.object({
  title: z.string().min(1).max(255),
  appointment_type: z.enum(APPOINTMENT_TYPES).default('consultation'),
  provider_id: z.string().uuid().optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().optional().nullable(),
  status: z.enum(APPOINTMENT_STATUSES).default('scheduled'),
  notes: z.string().max(4000).optional().nullable(),
});

const appointmentSelect = (profileId: string) =>
  db('appointments as a')
    .leftJoin('providers as p', 'a.provider_id', 'p.id')
    .where('a.care_profile_id', profileId)
    .select('a.*', 'p.name as provider_name', 'p.provider_type', 'p.organisation as provider_organisation');

appointmentsRouter.get('/', requireAuth, async (req, res) => {
  const query = appointmentSelect(String(req.params['id']));
  if (req.query['from']) query.where('a.starts_at', '>=', new Date(String(req.query['from'])));
  if (req.query['to']) query.where('a.starts_at', '<=', new Date(String(req.query['to'])));
  const appointments = await query.orderBy('a.starts_at', 'asc');
  res.json({ appointments });
});

appointmentsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const [appointment] = await db('appointments')
    .insert({
      care_profile_id: req.params['id'],
      ...parsed.data,
      created_by_account_id: req.account!.id,
    })
    .returning('*');
  res.status(201).json({ appointment });
});

appointmentsRouter.patch('/:appointmentId', requireAuth, async (req, res) => {
  const parsed = appointmentSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [appointment] = await db('appointments')
    .where({ id: req.params['appointmentId'], care_profile_id: req.params['id'] })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!appointment) {
    res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ appointment });
});

// Update several appointments at once, scoped to this profile.
const bulkSchema = z.object({
  action: z.enum(['complete', 'cancel', 'delete']),
  ids: z.array(z.string().uuid()).min(1).max(500),
});

appointmentsRouter.post('/bulk', requireAuth, async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const scope = db('appointments').where({ care_profile_id: req.params['id'] }).whereIn('id', parsed.data.ids);
  if (parsed.data.action === 'delete') {
    const deleted = await scope.del();
    res.json({ deleted });
    return;
  }
  const updated = await scope.update({
    status: parsed.data.action === 'complete' ? 'completed' : 'cancelled',
    updated_at: db.fn.now(),
  });
  res.json({ updated });
});

appointmentsRouter.delete('/:appointmentId', requireAuth, async (req, res) => {
  const deleted = await db('appointments')
    .where({ id: req.params['appointmentId'], care_profile_id: req.params['id'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Appointment deleted.' });
});
