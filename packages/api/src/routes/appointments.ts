import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { accountIdForProfile } from '../services/documentCategories';
import { resolveNextStepTypeByName, stepBooks } from '../services/nextStepTypes';
import { isValidTimeZone, parseZonedTime } from '../lib/timezone';
import { createForwards, deliverForwards, forwardItemSchema, forwardsSentFor, takeBackForward } from '../services/noteForwards';
import { appointmentPlaceColumns, ensureProfessional, fillProfessionalGaps, type KnownPlace } from '../services/professionals';
import { APPOINTMENT_FIELD_LABELS, OUTCOME_FIELD_LABELS, plainValidationError } from '../lib/plainValidation';

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
// to_book: everything is known except the date; it waits on a to-do.
export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'missed', 'to_book'] as const;

const appointmentSchema = z.object({
  title: z.string().min(1).max(255),
  appointment_type: z.enum(APPOINTMENT_TYPES).default('consultation'),
  provider_id: z.string().uuid().optional().nullable(),
  // The condition this appointment arose from, so an x-ray booked for a sore
  // ankle stays tied to the ankle in the record and on the calendar.
  medical_condition_id: z.string().uuid().optional().nullable(),
  // Where it is: the same segmented address as everywhere else, its own map
  // link, and (from older callers) one line of text, which is split for them.
  location: z.string().max(255).optional().nullable(),
  address_line1: z.string().max(255).optional().nullable(),
  address_line2: z.string().max(255).optional().nullable(),
  address_suburb: z.string().max(120).optional().nullable(),
  address_state: z.string().max(120).optional().nullable(),
  address_postcode: z.string().max(20).optional().nullable(),
  address_country: z.string().max(120).optional().nullable(),
  directions_link: z.string().max(2000).optional().nullable(),
  // A new name typed for who it is with: filed in Contacts automatically.
  provider_name: z.string().max(255).optional().nullable(),
  provider_type: z.string().max(100).optional().nullable(),
  // Left out when it is not booked yet: the appointment waits as to_book.
  starts_at: z.string().datetime().optional().nullable(),
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
  startsAt: string | Date | null,
  cost: { estimate?: number | null; actual?: number | null }
): Promise<void> {
  // Not booked yet: dated today until the appointment has its own date.
  const spentOn = new Date(startsAt ?? Date.now()).toISOString().slice(0, 10);
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

/**
 * The to-do that keeps an appointment that is not booked yet in view. It is
 * ticked off when the appointment is given its date.
 */
export async function addBookingTodo(profileId: string, title: string, actorId: string, conn: Knex | Knex.Transaction = db): Promise<string> {
  const [task] = await conn('reminders')
    .insert({
      care_profile_id: profileId,
      title: `Book ${title}`.slice(0, 255),
      reminder_type: 'once',
      next_due_at: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    })
    .returning('id');
  const taskId = (task as { id: string }).id;
  await conn('audit_log').insert({
    care_profile_id: profileId,
    actor_account_id: actorId,
    action: 'created',
    entity_type: 'reminders',
    entity_id: taskId,
    summary: `Book ${title}`.slice(0, 255),
    source: 'person',
  });
  return taskId;
}

const PLACE_KEYS = ['location', 'address_line1', 'address_line2', 'address_suburb', 'address_state', 'address_postcode', 'address_country', 'directions_link'] as const;

/**
 * The columns an appointment write stores: the place split into its parts
 * with the one-line location kept in step, and a new name for who it is with
 * filed in Contacts and linked.
 */
async function appointmentColumns(
  profileId: string,
  data: Record<string, unknown> & { provider_id?: string | null; provider_name?: string | null; provider_type?: string | null },
  /** Collects anyone newly filed in Contacts, so the screen can say so. */
  filed: Array<{ id: string; name: string }> = []
): Promise<Record<string, unknown>> {
  const { provider_name, provider_type, ...fields } = data;
  const place: Record<string, string | null | undefined> = {};
  for (const k of PLACE_KEYS) {
    if (k in fields) {
      place[k] = fields[k] as string | null | undefined;
      delete fields[k];
    }
  }
  const placeCols = Object.keys(place).length ? appointmentPlaceColumns(place) : {};
  const out: Record<string, unknown> = { ...fields, ...placeCols };
  // The address typed for the appointment is where they are: Contacts gets it
  // too, wherever Contacts does not already know.
  const known: KnownPlace | null = Object.keys(placeCols).length ? (placeCols as KnownPlace) : null;
  if (!data.provider_id && provider_name?.trim()) {
    const pro = await ensureProfessional(db, { profileId, name: provider_name, providerType: provider_type, place: known });
    if (pro) {
      out['provider_id'] = pro.id;
      if (pro.created) filed.push({ id: pro.id, name: pro.name });
    }
  } else if (data.provider_id && known) {
    await fillProfessionalGaps(db, data.provider_id, known);
  }
  return out;
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
    .leftJoin('providers as p', 'r.provider_id', 'p.id')
    .select(
      'r.id', 'r.appointment_id', 'r.title', 'r.next_due_at', 'r.completed', 'r.completed_at',
      't.id as type_id', 't.name as type_name', 't.system_key as type_key',
      'r.provider_id', 'p.name as provider_name', 'p.provider_type as provider_type'
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
      type_key: r.type_key ?? null,
      books: stepBooks(r.type_key),
      provider_id: r.provider_id ?? null,
      provider_name: r.provider_name ?? null,
      provider_type: r.provider_type ?? null,
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
  const ids = appointments.map((a: { id: string }) => a.id);
  const [steps, forwarded] = await Promise.all([nextStepsFor(ids), forwardsSentFor(ids)]);
  res.json({
    appointments: appointments.map((a: Record<string, unknown>) => ({
      ...serializeAppointment(a),
      next_steps: steps.get(a['id'] as string) ?? [],
      forwarded: forwarded.get(a['id'] as string) ?? [],
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
        // Who the step is with, such as who a referral is to: someone in
        // Contacts, or a new name, filed there automatically.
        provider_id: z.string().uuid().optional().nullable(),
        provider_name: z.string().trim().max(255).optional().nullable(),
        provider_type: z.string().trim().max(100).optional().nullable(),
        // Pieces of this visit to send with the step, such as what happened
        // for the specialist a referral is to. They land when it is booked.
        forward: z.array(forwardItemSchema).max(50).default([]),
      })
    )
    .max(30)
    .default([]),
  tz: z.string().max(64).optional().nullable(),
});

/** A stored provider type in words: built-in codes read as plain names. */
const BUILT_IN_TYPE_WORDS: Record<string, string> = {
  gp: 'GP', specialist: 'specialist', psychologist: 'psychologist', allied_health: 'allied health',
  social_worker: 'social worker', legal: 'lawyer', financial: 'financial adviser',
};
const providerTypeWords = (t: string) => BUILT_IN_TYPE_WORDS[t] ?? t.toLowerCase();

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
    steps: Array<{
      type: string;
      details?: string | null;
      due_on?: string | null;
      provider_id?: string | null;
      provider_name?: string | null;
      provider_type?: string | null;
    }>;
    source?: 'person' | 'pare';
  }
): Promise<Array<{ id: string; title: string; type_name: string; provider_id: string | null; filed: { id: string; name: string } | null }>> {
  const accountId = (await accountIdForProfile(opts.profileId, trx))!;
  const out: Array<{ id: string; title: string; type_name: string; provider_id: string | null; filed: { id: string; name: string } | null }> = [];
  for (const step of opts.steps) {
    const typeId = await resolveNextStepTypeByName(accountId, step.type || 'Other', trx);
    const typeName = ((await trx('next_step_types').where({ id: typeId }).first('name')) as { name: string }).name;
    const dueOn = step.due_on || inAWeek();
    const due = parseZonedTime(`${dueOn}T09:00:00`, opts.timeZone) ?? new Date(`${dueOn}T09:00:00Z`);
    // Who it is with goes into Contacts, linked to this person, so the
    // referral's specialist is there to pick when it is booked.
    let provider: { id: string; name: string } | null = null;
    let filedNew: { id: string; name: string } | null = null;
    if (step.provider_id) {
      const linked = await trx('providers').where({ id: step.provider_id, account_id: accountId }).first('id', 'name');
      if (linked) {
        provider = linked as { id: string; name: string };
        await trx('care_profile_providers')
          .insert({ care_profile_id: opts.profileId, provider_id: provider.id })
          .onConflict(['care_profile_id', 'provider_id'])
          .ignore();
      }
    } else if (step.provider_name?.trim()) {
      const pro = await ensureProfessional(trx, { profileId: opts.profileId, name: step.provider_name, providerType: step.provider_type });
      provider = pro;
      if (pro?.created) filedNew = { id: pro.id, name: pro.name };
    }
    const providerType = provider
      ? ((await trx('providers').where({ id: provider.id }).first('provider_type')) as { provider_type: string | null } | undefined)?.provider_type
      : null;
    const who = provider ? `${provider.name}${providerType && providerType !== 'other' ? `, ${providerTypeWords(providerType)}` : ''}` : '';
    const title = step.details?.trim() || (who ? `See ${who}` : typeName);
    const [task] = await trx('reminders')
      .insert({
        care_profile_id: opts.profileId,
        title: title.slice(0, 255),
        reminder_type: 'once',
        next_due_at: due,
        appointment_id: opts.appointmentId,
        next_step_type_id: typeId,
        provider_id: provider?.id ?? null,
      })
      .returning('id');
    const taskId = (task as { id: string }).id;
    out.push({ id: taskId, title, type_name: typeName, provider_id: provider?.id ?? null, filed: filedNew });
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
    res.status(400).json({ error: plainValidationError(parsed.error, OUTCOME_FIELD_LABELS, 'How it went did not save. Check each box and try again.'), code: 'VALIDATION_ERROR' });
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
    const added = await addNextSteps(trx, {
      profileId,
      appointmentId: appointment.id,
      actorId: req.account!.id,
      timeZone: tz,
      steps: parsed.data.next_steps,
    });
    for (let i = 0; i < added.length; i++) {
      const items = parsed.data.next_steps[i]?.forward ?? [];
      if (items.length === 0) continue;
      const result = await createForwards(trx, {
        profileId,
        sourceAppointmentId: appointment.id,
        actorId: req.account!.id,
        items,
        to: { reminder_id: added[i]!.id },
      });
      if ('error' in result) throw Object.assign(new Error(result.error), { status: 400 });
    }
    return added;
  }).catch((err: Error & { status?: number }) => {
    if (err.status === 400) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return null;
    }
    throw err;
  });
  if (!created) return;

  const enriched = await appointmentSelect(profileId).andWhere('a.id', appointment.id).first();
  const [steps, forwarded] = await Promise.all([nextStepsFor([appointment.id]), forwardsSentFor([appointment.id])]);
  res.json({
    appointment: {
      ...serializeAppointment(enriched),
      next_steps: steps.get(appointment.id) ?? [],
      forwarded: forwarded.get(appointment.id) ?? [],
    },
    created: created.map((c) => c.id),
    // Who each new step is with, so a booking made straight away starts there.
    created_steps: created.map((c) => ({ id: c.id, provider_id: c.provider_id })),
    // Anyone newly added to Contacts, so the screen can say so.
    filed: created.map((c) => c.filed).filter((f): f is { id: string; name: string } => !!f),
  });
});

appointmentsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: plainValidationError(parsed.error, APPOINTMENT_FIELD_LABELS, 'The appointment did not save. Check each box and try again.'), code: 'VALIDATION_ERROR' });
    return;
  }
  const { cost_estimate, cost_actual, ...rest } = parsed.data;
  const profileId = String(req.params['id']);
  const filed: Array<{ id: string; name: string }> = [];
  const appointmentFields = await appointmentColumns(profileId, rest, filed);
  const dated = !!parsed.data.starts_at;
  if (!dated) {
    appointmentFields['starts_at'] = null;
    appointmentFields['status'] = 'to_book';
    // Not booked yet and not from a next step: a to-do keeps it in view.
    if (!parsed.data.from_reminder_id) {
      appointmentFields['from_reminder_id'] = await addBookingTodo(profileId, parsed.data.title, req.account!.id);
    }
  }
  const [appointment] = await db('appointments')
    .insert({
      care_profile_id: req.params['id'],
      ...appointmentFields,
      created_by_account_id: req.account!.id,
    })
    .returning('*');
  const appointmentId = (appointment as { id: string }).id;
  // Booking the appointment a next step called for ticks that step off once
  // it has a date. Anything forwarded to the step lands on it straight away,
  // so the notes travel with the details even before it is booked.
  if (parsed.data.from_reminder_id) {
    if (dated) {
      await db('reminders')
        .where({ id: parsed.data.from_reminder_id, care_profile_id: req.params['id'], completed: false })
        .update({ completed: true, completed_at: db.fn.now(), completed_by_account_id: req.account!.id });
    }
    await deliverForwards(db, {
      profileId,
      reminderId: parsed.data.from_reminder_id,
      appointmentId,
    });
  }
  await syncAppointmentSpend(
    appointmentId,
    String(req.params['id']),
    req.account!.id,
    parsed.data.starts_at ?? null,
    { estimate: cost_estimate, actual: cost_actual }
  );
  const enriched = await appointmentSelect(String(req.params['id'])).andWhere('a.id', appointmentId).first();
  res.status(201).json({ appointment: serializeAppointment(enriched), filed });
});

appointmentsRouter.patch('/:appointmentId', requireAuth, async (req, res) => {
  const parsed = appointmentSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: plainValidationError(parsed.error, APPOINTMENT_FIELD_LABELS, 'The appointment did not save. Check each box and try again.'), code: 'VALIDATION_ERROR' });
    return;
  }
  const { cost_estimate, cost_actual, ...rest } = parsed.data;
  const before = (await db('appointments')
    .where({ id: req.params['appointmentId'], care_profile_id: req.params['id'] })
    .first('id', 'starts_at', 'status', 'from_reminder_id')) as
    | { id: string; starts_at: Date | null; status: string; from_reminder_id: string | null }
    | undefined;
  if (!before) {
    res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' });
    return;
  }
  if (parsed.data.starts_at === null && before.starts_at) {
    res.status(400).json({ error: 'A booked appointment keeps its date. Change the date, or cancel the appointment.', code: 'VALIDATION_ERROR' });
    return;
  }
  const filed: Array<{ id: string; name: string }> = [];
  const appointmentFields = await appointmentColumns(String(req.params['id']), rest, filed);
  // An existing appointment with a new place: whoever it is with learns it
  // too, if Contacts had nothing for them.
  const providerAfter = (parsed.data.provider_id ?? appointmentFields['provider_id'] ?? null) as string | null;
  // Given its date, an appointment that was not booked yet is booked now.
  const nowBooked = !before.starts_at && !!parsed.data.starts_at;
  if (nowBooked && (!parsed.data.status || parsed.data.status === 'to_book')) appointmentFields['status'] = 'scheduled';
  if (!before.starts_at && !parsed.data.starts_at && parsed.data.status === undefined) appointmentFields['status'] = before.status;
  const [appointment] = await db('appointments')
    .where({ id: before.id })
    .update({ ...appointmentFields, updated_at: db.fn.now() })
    .returning('*');
  // Its to-do is done: the appointment is booked.
  if (nowBooked && before.from_reminder_id) {
    await db('reminders')
      .where({ id: before.from_reminder_id, care_profile_id: req.params['id'], completed: false })
      .update({ completed: true, completed_at: db.fn.now(), completed_by_account_id: req.account!.id });
  }
  // A cost already on the ledger moves to the appointment's new day.
  if (parsed.data.starts_at && cost_estimate === undefined && cost_actual === undefined) {
    await db('health_spend_entries')
      .where({ appointment_id: before.id })
      .update({ spent_on: new Date(parsed.data.starts_at).toISOString().slice(0, 10), updated_at: db.fn.now() });
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
  const currentProvider = providerAfter ?? (enriched?.provider_id as string | null) ?? null;
  if (currentProvider && !parsed.data.provider_id && !appointmentFields['provider_id']) {
    await fillProfessionalGaps(db, currentProvider, {
      address_line1: enriched.address_line1, address_line2: enriched.address_line2, address_suburb: enriched.address_suburb,
      address_state: enriched.address_state, address_postcode: enriched.address_postcode, address_country: enriched.address_country,
      directions_link: enriched.directions_link,
    });
  }
  res.json({ appointment: serializeAppointment(enriched), filed });
});

const forwardSchema = z.object({
  items: z.array(forwardItemSchema).min(1).max(50),
  to_appointment_id: z.string().uuid().optional().nullable(),
  to_reminder_id: z.string().uuid().optional().nullable(),
});

/**
 * Forward some or all of what was noted at this appointment to another one,
 * or to a next step not booked yet. Each piece becomes a note on the other
 * appointment saying who it is from; the original shows where it went.
 */
appointmentsRouter.post('/:appointmentId/forward', requireAuth, async (req, res) => {
  const parsed = forwardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Pick at least one note to forward, and where it goes.', code: 'VALIDATION_ERROR' });
    return;
  }
  const result = await db.transaction((trx) =>
    createForwards(trx, {
      profileId: String(req.params['id']),
      sourceAppointmentId: String(req.params['appointmentId']),
      actorId: req.account!.id,
      items: parsed.data.items,
      to: { appointment_id: parsed.data.to_appointment_id, reminder_id: parsed.data.to_reminder_id },
    })
  );
  if ('error' in result) {
    res.status(400).json({ error: result.error, code: 'VALIDATION_ERROR' });
    return;
  }
  res.status(201).json(result);
});

/** Take a forward back: its copy on the other appointment goes too. */
appointmentsRouter.delete('/forwards/:forwardId', requireAuth, async (req, res) => {
  const forwardId = z.string().uuid().safeParse(req.params['forwardId']);
  if (!forwardId.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const done = await db.transaction((trx) => takeBackForward(trx, String(req.params['id']), forwardId.data));
  if (!done) {
    res.status(404).json({ error: 'That forward could not be found. It may already have been taken back.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ taken_back: true });
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
