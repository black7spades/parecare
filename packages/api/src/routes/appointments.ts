import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { accountIdForProfile } from '../services/documentCategories';
import { resolveNextStepTypeByName, stepBooks } from '../services/nextStepTypes';
import { isValidTimeZone, parseZonedTime } from '../lib/timezone';

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
  // The condition this appointment arose from, so an x-ray booked for a sore
  // ankle stays tied to the ankle in the record and on the calendar.
  medical_condition_id: z.string().uuid().optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().optional().nullable(),
  status: z.enum(APPOINTMENT_STATUSES).default('scheduled'),
  notes: z.string().max(4000).optional().nullable(),
  // Cost is not stored on the appointment; it becomes a dated health-spend
  // entry. An estimate is given when booking; the actual is confirmed after.
  cost_estimate: z.coerce.number().min(0).max(1e9).optional().nullable(),
  cost_actual: z.coerce.number().min(0).max(1e9).optional().nullable(),
  // The next step this appointment carries out, such as the specialist visit
  // a referral led to. Booking it ticks that next step off.
  from_reminder_id: z.string().uuid().optional().nullable(),
});

/**
 * Keep an appointment's single spend entry in step with its cost. A confirmed
 * actual wins; otherwise an estimate is kept as pending; clearing both removes
 * the entry. The entry is dated to the appointment day. Exported so the
 * assistant books appointments through exactly this cost rule.
 */
export async function syncAppointmentSpend(
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

/**
 * The next steps each appointment set off, with what each led to: the task
 * itself, its kind, and any appointment booked to carry it out.
 */
export async function nextStepsFor(appointmentIds: string[]) {
  if (appointmentIds.length === 0) return new Map<string, unknown[]>();
  const rows = await db('reminders as r')
    .leftJoin('next_step_types as t', 'r.next_step_type_id', 't.id')
    .whereIn('r.appointment_id', appointmentIds)
    .orderBy('r.created_at', 'asc')
    .select(
      'r.id', 'r.appointment_id', 'r.title', 'r.next_due_at', 'r.completed', 'r.completed_at',
      't.id as type_id', 't.name as type_name', 't.system_key as type_key'
    );
  const ledTo = rows.length
    ? await db('appointments')
        .whereIn('from_reminder_id', rows.map((r) => r.id))
        .select('id', 'from_reminder_id', 'title', 'starts_at', 'status')
    : [];
  const ledToByTask = new Map(ledTo.map((a) => [a.from_reminder_id as string, a]));
  const byAppointment = new Map<string, unknown[]>();
  for (const r of rows) {
    const list = byAppointment.get(r.appointment_id) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      next_due_at: r.next_due_at,
      completed: r.completed,
      completed_at: r.completed_at,
      type_id: r.type_id,
      type_name: r.type_name ?? 'Other',
      books: stepBooks(r.type_key),
      led_to: ledToByTask.get(r.id) ?? null,
    });
    byAppointment.set(r.appointment_id, list);
  }
  return byAppointment;
}

appointmentsRouter.get('/', requireAuth, async (req, res) => {
  const query = appointmentSelect(String(req.params['id']));
  if (req.query['from']) query.where('a.starts_at', '>=', new Date(String(req.query['from'])));
  if (req.query['to']) query.where('a.starts_at', '<=', new Date(String(req.query['to'])));
  const appointments = await query.orderBy('a.starts_at', 'asc');
  const steps = await nextStepsFor(appointments.map((a: { id: string }) => a.id));
  res.json({
    appointments: appointments.map((a: Record<string, unknown>) => ({
      ...serializeAppointment(a),
      next_steps: steps.get(a['id'] as string) ?? [],
    })),
  });
});

const outcomeSchema = z.object({
  outcome: z.string().max(4000).optional().nullable(),
  // New next steps to add. Each becomes a task tied to this appointment.
  next_steps: z
    .array(
      z.object({
        type: z.string().trim().max(100),
        details: z.string().trim().max(255).optional().nullable(),
        due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      })
    )
    .max(30)
    .default([]),
  tz: z.string().max(64).optional().nullable(),
});

/** A week from today, for a next step given no date. */
const inAWeek = (): string => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Add next steps to an appointment as tasks tied to it. Shared by the outcome
 * form and by Pare, so both file a next step the same way.
 */
export async function addNextSteps(
  trx: Knex.Transaction,
  opts: {
    profileId: string;
    appointmentId: string;
    actorId: string;
    timeZone: string | null;
    steps: Array<{ type: string; details?: string | null; due_on?: string | null }>;
    source?: 'person' | 'pare';
  }
): Promise<Array<{ id: string; title: string; type_name: string }>> {
  const accountId = (await accountIdForProfile(opts.profileId, trx))!;
  const out: Array<{ id: string; title: string; type_name: string }> = [];
  for (const step of opts.steps) {
    const typeId = await resolveNextStepTypeByName(accountId, step.type || 'Other', trx);
    const typeName = ((await trx('next_step_types').where({ id: typeId }).first('name')) as { name: string }).name;
    const dueOn = step.due_on || inAWeek();
    const due = parseZonedTime(`${dueOn}T09:00:00`, opts.timeZone) ?? new Date(`${dueOn}T09:00:00Z`);
    const title = step.details?.trim() || typeName;
    const [task] = await trx('reminders')
      .insert({
        care_profile_id: opts.profileId,
        title: title.slice(0, 255),
        reminder_type: 'once',
        next_due_at: due,
        appointment_id: opts.appointmentId,
        next_step_type_id: typeId,
      })
      .returning('id');
    const taskId = (task as { id: string }).id;
    out.push({ id: taskId, title, type_name: typeName });
    await trx('audit_log').insert({
      care_profile_id: opts.profileId,
      actor_account_id: opts.actorId,
      action: 'created',
      entity_type: 'reminders',
      entity_id: taskId,
      summary: title.slice(0, 255),
      source: opts.source ?? 'person',
    });
  }
  return out;
}

/**
 * Record how an appointment went: what happened, and the next steps it set
 * off. Each next step becomes a task, so it is tracked and nudged wherever
 * tasks are. Recording an outcome also marks a still-scheduled appointment
 * as attended.
 */
appointmentsRouter.put('/:appointmentId/outcome', requireAuth, async (req, res) => {
  const parsed = outcomeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const profileId = String(req.params['id']);
  const appointment = await db('appointments')
    .where({ id: req.params['appointmentId'], care_profile_id: profileId })
    .first();
  if (!appointment) {
    res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' });
    return;
  }
  const tzIn = parsed.data.tz ?? null;
  const tz = isValidTimeZone(tzIn) ? tzIn : (req.account as { timezone?: string | null } | undefined)?.timezone ?? null;

  const created = await db.transaction(async (trx) => {
    const fields: Record<string, unknown> = { updated_at: trx.fn.now() };
    if (parsed.data.outcome !== undefined) {
      const text = parsed.data.outcome?.trim() || null;
      fields['outcome'] = text;
      fields['outcome_recorded_at'] = text ? trx.fn.now() : null;
    }
    if (appointment.status === 'scheduled' && (parsed.data.outcome?.trim() || parsed.data.next_steps.length > 0)) {
      fields['status'] = 'completed';
    }
    await trx('appointments').where({ id: appointment.id }).update(fields);
    return addNextSteps(trx, {
      profileId,
      appointmentId: appointment.id,
      actorId: req.account!.id,
      timeZone: tz,
      steps: parsed.data.next_steps,
    });
  });

  const enriched = await appointmentSelect(profileId).andWhere('a.id', appointment.id).first();
  const steps = await nextStepsFor([appointment.id]);
  res.json({
    appointment: { ...serializeAppointment(enriched), next_steps: steps.get(appointment.id) ?? [] },
    created: created.map((c) => c.id),
  });
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
  // Booking the appointment a next step called for ticks that step off.
  if (parsed.data.from_reminder_id) {
    await db('reminders')
      .where({ id: parsed.data.from_reminder_id, care_profile_id: req.params['id'], completed: false })
      .update({ completed: true, completed_at: db.fn.now(), completed_by_account_id: req.account!.id });
  }
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
