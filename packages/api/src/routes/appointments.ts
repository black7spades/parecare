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
  // Cost is not stored on the appointment; it becomes a dated health-spend
  // entry. An estimate is given when booking; the actual is confirmed after.
  cost_estimate: z.coerce.number().min(0).max(1e9).optional().nullable(),
  cost_actual: z.coerce.number().min(0).max(1e9).optional().nullable(),
});

/**
 * Keep an appointment's single spend entry in step with its cost. A confirmed
 * actual wins; otherwise an estimate is kept as pending; clearing both removes
 * the entry. The entry is dated to the appointment day.
 */
async function syncAppointmentSpend(
  appointmentId: string,
  profileId: string,
  accountId: string,
  startsAt: string | Date,
  cost: { estimate?: number | null; actual?: number | null }
): Promise<void> {
  const spentOn = new Date(startsAt).toISOString().slice(0, 10);
  const hasActual = cost.actual != null;
  const hasEstimate = cost.estimate != null;
  if (!hasActual && !hasEstimate) {
    if (cost.actual === null || cost.estimate === null) {
      // An explicit clear removes the entry.
      await db('health_spend_entries').where({ appointment_id: appointmentId }).del();
    }
    return;
  }
  const amount = hasActual ? cost.actual! : cost.estimate!;
  const status = hasActual ? 'confirmed' : 'estimated';
  await db('health_spend_entries')
    .insert({
      care_profile_id: profileId,
      appointment_id: appointmentId,
      amount,
      spent_on: spentOn,
      category: 'appointment',
      status,
      created_by_account_id: accountId,
    })
    .onConflict('appointment_id')
    .merge({ amount, status, spent_on: spentOn, updated_at: db.fn.now() });
}

const appointmentSelect = (profileId: string) =>
  db('appointments as a')
    .leftJoin('providers as p', 'a.provider_id', 'p.id')
    .leftJoin('health_spend_entries as e', 'e.appointment_id', 'a.id')
    .where('a.care_profile_id', profileId)
    .select(
      'a.*', 'p.name as provider_name', 'p.provider_type', 'p.organisation as provider_organisation',
      'p.address as provider_address', 'p.directions_link as provider_directions_link',
      'e.amount as cost_amount', 'e.status as cost_status'
    );

// The cost lives as a ledger entry; expose it as the estimate or the confirmed
// actual so the form can show and edit it. A number arrives as a string.
const serializeAppointment = <T extends Record<string, unknown>>(a: T): T => {
  const amount = a['cost_amount'] == null ? null : Number(a['cost_amount']);
  const status = a['cost_status'] as string | null;
  return {
    ...a,
    cost_amount: amount,
    cost_estimate: status === 'estimated' ? amount : null,
    cost_actual: status === 'confirmed' ? amount : null,
  };
};

appointmentsRouter.get('/', requireAuth, async (req, res) => {
  const query = appointmentSelect(String(req.params['id']));
  if (req.query['from']) query.where('a.starts_at', '>=', new Date(String(req.query['from'])));
  if (req.query['to']) query.where('a.starts_at', '<=', new Date(String(req.query['to'])));
  const appointments = await query.orderBy('a.starts_at', 'asc');
  res.json({ appointments: appointments.map(serializeAppointment) });
});

appointmentsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const { cost_estimate, cost_actual, ...appointmentFields } = parsed.data;
  const [appointment] = await db('appointments')
    .insert({
      care_profile_id: req.params['id'],
      ...appointmentFields,
      created_by_account_id: req.account!.id,
    })
    .returning('*');
  const appointmentId = (appointment as { id: string }).id;
  await syncAppointmentSpend(
    appointmentId,
    String(req.params['id']),
    req.account!.id,
    parsed.data.starts_at,
    { estimate: cost_estimate, actual: cost_actual }
  );
  const enriched = await appointmentSelect(String(req.params['id'])).andWhere('a.id', appointmentId).first();
  res.status(201).json({ appointment: serializeAppointment(enriched) });
});

appointmentsRouter.patch('/:appointmentId', requireAuth, async (req, res) => {
  const parsed = appointmentSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const { cost_estimate, cost_actual, ...appointmentFields } = parsed.data;
  const [appointment] = await db('appointments')
    .where({ id: req.params['appointmentId'], care_profile_id: req.params['id'] })
    .update({ ...appointmentFields, updated_at: db.fn.now() })
    .returning('*');
  if (!appointment) {
    res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' });
    return;
  }
  // Update the spend entry when a cost was sent, dated to the appointment day.
  if (cost_estimate !== undefined || cost_actual !== undefined) {
    await syncAppointmentSpend(
      req.params['appointmentId']!,
      String(req.params['id']),
      req.account!.id,
      (appointment as { starts_at: string | Date }).starts_at,
      { estimate: cost_estimate, actual: cost_actual }
    );
  }
  const enriched = await appointmentSelect(String(req.params['id'])).andWhere('a.id', req.params['appointmentId']!).first();
  res.json({ appointment: serializeAppointment(enriched) });
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
