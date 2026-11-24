import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { accountIdForProfile } from '../services/documentCategories';
import { resolveNextStepTypeByName, stepBooks } from '../services/nextStepTypes';
import { isValidTimeZone, parseZonedTime } from '../lib/timezone';
import { createForwards, forwardItemSchema, forwardsSentFor, takeBackForward } from '../services/noteForwards';
import { contactSummaries, ensureProfessional } from '../services/professionals';
import { APPOINTMENT_FIELD_LABELS, OUTCOME_FIELD_LABELS, plainValidationError } from '../lib/plainValidation';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  BookingProblem,
  addBookingTodo,
  appointmentInputSchema,
  bookAppointment,
  enrichAppointments,
  moveLater,
  removePreparationTasks,
  stopRepeating,
  syncAppointmentSpend,
  syncPreparationTask,
  updateAppointment,
} from '../services/booking';
import { createTask, findSameBookingTask, joinTask } from '../services/tasks';
import { refreshReferrals } from '../services/documentDates';
import { sendShareEmail } from '../services/email';
import {
  SendProblem,
  appointmentEmailLines,
  appointmentForSending,
  appointmentIcs,
  createShareLink,
  linkOut,
  ownerZone,
  resolveRecipient,
  sendToSchema,
  shareUrl,
  whenText,
} from '../services/shareLinks';

/**
 * Appointments are a first-class record: who is being seen, what for,
 * where and when. They feed the profile calendar (which feeds the
 * overview) rather than living inside it. Every write goes through
 * services/booking, which Pare uses too.
 */

export const appointmentsRouter = Router({ mergeParams: true });

export { APPOINTMENT_TYPES, APPOINTMENT_STATUSES, syncAppointmentSpend, addBookingTodo };

const appointmentSelect = (profileId: string) =>
  db('appointments as a')
    .leftJoin('providers as p', 'a.provider_id', 'p.id')
    .leftJoin('health_spend_entries as e', 'e.appointment_id', 'a.id')
    .where('a.care_profile_id', profileId)
    .select(
      'a.*', 'p.name as provider_name', 'p.provider_type', 'p.organisation as provider_organisation',
      'p.address as provider_address', 'p.directions_link as provider_directions_link',
      'p.phone as provider_phone', 'p.email as provider_email', 'p.booking_link as provider_booking_link',
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

/** One appointment as the list returns it, everything included. */
async function fullAppointment(profileId: string, id: string) {
  const row = await appointmentSelect(profileId).andWhere('a.id', id).first();
  if (!row) return null;
  const [enriched] = await enrichAppointments(db, profileId, [serializeAppointment(row)]);
  const [steps, forwarded] = await Promise.all([nextStepsFor([id]), forwardsSentFor([id])]);
  return { ...enriched, next_steps: steps.get(id) ?? [], forwarded: forwarded.get(id) ?? [] };
}

/**
 * The next steps each appointment set off, with what each led to: the task
 * itself, its kind, and any appointment booked to carry it out.
 */
export async function nextStepsFor(appointmentIds: string[]) {
  if (appointmentIds.length === 0) return new Map<string, unknown[]>();
  const rows = await db('reminders as r')
    .leftJoin('next_step_types as t', 'r.next_step_type_id', 't.id')
    .whereIn('r.appointment_id', appointmentIds)
    .whereNull('r.merged_into_id')
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
  const contacts = await contactSummaries(db, rows.map((r) => r.provider_id as string | null));
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
      provider: r.provider_id ? contacts.get(r.provider_id) ?? null : null,
      led_to: ledToByTask.get(r.id) ?? null,
    });
    byAppointment.set(r.appointment_id, list);
  }
  return byAppointment;
}

appointmentsRouter.get('/', requireAuth, async (req, res) => {
  const profileId = String(req.params['id']);
  const query = appointmentSelect(profileId);
  if (req.query['from']) query.where('a.starts_at', '>=', new Date(String(req.query['from'])));
  if (req.query['to']) query.where('a.starts_at', '<=', new Date(String(req.query['to'])));
  const appointments = (await query.orderBy('a.starts_at', 'asc')) as Array<Record<string, unknown> & { id: string }>;
  const ids = appointments.map((a) => a.id);
  const [steps, forwarded, enriched] = await Promise.all([
    nextStepsFor(ids),
    forwardsSentFor(ids),
    enrichAppointments(db, profileId, appointments.map((a) => serializeAppointment(a))),
  ]);
  res.json({
    appointments: enriched.map((a) => ({
      ...a,
      next_steps: steps.get(a.id) ?? [],
      forwarded: forwarded.get(a.id) ?? [],
    })),
  });
});

const tzOf = (req: { account?: unknown }) => (req.account as { timezone?: string | null } | undefined)?.timezone ?? null;

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
        provider_phone: z.string().trim().max(50).optional().nullable(),
        // Pieces of this visit to send with the step, such as what happened
        // for the specialist a referral is to. They land when it is booked.
        forward: z.array(forwardItemSchema).max(50).default([]),
        // Keep it as its own task even when an open task does the same booking.
        no_join: z.boolean().optional(),
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

export interface AddedStep {
  id: string;
  title: string;
  type_name: string;
  provider_id: string | null;
  filed: { id: string; name: string } | null;
  /** Joined into an open task doing the same booking, rather than added. */
  joined: null | {
    into_id: string;
    into_title: string;
    name: string | null;
    previous: Record<string, unknown>;
    note_id: string | null;
    document_ids: string[];
    step: { title: string; next_due_at: string; next_step_type_id: string; provider_id: string | null; appointment_id: string };
  };
}

/**
 * Add next steps to an appointment as tasks tied to it. Shared by the outcome
 * form and by Pare, so both file a next step the same way. A step that books
 * what an open task already books joins that task: one task per booking.
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
      provider_phone?: string | null;
      no_join?: boolean;
    }>;
    source?: 'person' | 'pare';
  }
): Promise<AddedStep[]> {
  const accountId = (await accountIdForProfile(opts.profileId, trx))!;
  const source = (await trx('appointments').where({ id: opts.appointmentId }).first('title', 'starts_at')) as { title: string; starts_at: Date | null } | undefined;
  const out: AddedStep[] = [];
  for (const step of opts.steps) {
    const typeId = await resolveNextStepTypeByName(accountId, step.type || 'Other', trx);
    const typeRow = (await trx('next_step_types').where({ id: typeId }).first('name', 'system_key')) as { name: string; system_key: string | null };
    const typeName = typeRow.name;
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
        if (step.provider_phone?.trim()) {
          await trx('providers').where({ id: provider.id }).where((w) => w.whereNull('phone').orWhereRaw("trim(phone) = ''")).update({ phone: step.provider_phone.trim() });
        }
      }
    } else if (step.provider_name?.trim()) {
      const pro = await ensureProfessional(trx, { profileId: opts.profileId, name: step.provider_name, providerType: step.provider_type, phone: step.provider_phone });
      provider = pro;
      if (pro?.created) filedNew = { id: pro.id, name: pro.name };
    }
    const providerType = provider
      ? ((await trx('providers').where({ id: provider.id }).first('provider_type')) as { provider_type: string | null } | undefined)?.provider_type
      : null;
    const who = provider ? `${provider.name}${providerType && providerType !== 'other' ? `, ${providerTypeWords(providerType)}` : ''}` : '';
    const title = (step.details?.trim() || (who ? `See ${who}` : typeName)).slice(0, 255);

    if (stepBooks(typeRow.system_key) && !step.no_join) {
      const same = await findSameBookingTask(trx, opts.profileId, {
        providerId: provider?.id ?? null, providerName: provider?.name ?? null, providerType: providerType ?? null, kindKey: typeRow.system_key, title,
      });
      if (same) {
        const when = source?.starts_at
          ? `, ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: isValidTimeZone(opts.timeZone) ? opts.timeZone! : 'UTC' }).format(new Date(source.starts_at))}`
          : '';
        const joined = await joinTask(trx, {
          profileId: opts.profileId,
          intoId: same.id,
          actorId: opts.actorId,
          fields: { provider_id: provider?.id ?? null, next_step_type_id: typeId, appointment_id: opts.appointmentId, next_due_at: due },
          note: `From ${source?.title ?? 'an appointment'}${when}: ${title}`,
        });
        out.push({
          id: same.id, title: same.title, type_name: typeName, provider_id: provider?.id ?? null, filed: filedNew,
          joined: {
            into_id: same.id, into_title: same.title, name: provider?.name ?? null, previous: joined.previous, note_id: joined.note_id, document_ids: joined.document_ids,
            step: { title, next_due_at: due.toISOString(), next_step_type_id: typeId, provider_id: provider?.id ?? null, appointment_id: opts.appointmentId },
          },
        });
        continue;
      }
    }

    const created = await createTask(trx, {
      profileId: opts.profileId,
      actorId: opts.actorId,
      input: { title, next_due_at: due.toISOString(), appointment_id: opts.appointmentId, next_step_type_id: typeId, provider_id: provider?.id ?? null, no_infer: true, no_join: true },
    });
    const taskId = created.reminder.id;
    out.push({ id: taskId, title, type_name: typeName, provider_id: provider?.id ?? null, filed: filedNew, joined: null });
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
  const tz = isValidTimeZone(tzIn) ? tzIn : tzOf(req);

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
    if (fields['status'] === 'completed') await syncPreparationTask(trx, appointment.id, tz);
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

  res.json({
    appointment: await fullAppointment(profileId, appointment.id),
    created: created.map((c) => c.id),
    // Who each new step is with, so a booking made straight away starts there.
    created_steps: created.map((c) => ({ id: c.id, provider_id: c.provider_id })),
    // Anyone newly added to Contacts, so the screen can say so.
    filed: created.map((c) => c.filed).filter((f): f is { id: string; name: string } => !!f),
    // Steps that joined an open task for the same booking.
    joined: created.map((c) => c.joined).filter((j): j is NonNullable<AddedStep['joined']> => !!j),
  });
});

appointmentsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = appointmentInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: plainValidationError(parsed.error, APPOINTMENT_FIELD_LABELS, 'The appointment did not save. Check each box and try again.'), code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  try {
    const result = await db.transaction((trx) =>
      bookAppointment(trx, { profileId, actorId: req.account!.id, input: parsed.data, timeZone: tzOf(req) })
    );
    res.status(201).json({ appointment: await fullAppointment(profileId, result.appointment.id), filed: result.filed });
  } catch (err) {
    if (err instanceof BookingProblem) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
});

appointmentsRouter.patch('/:appointmentId', requireAuth, async (req, res) => {
  const parsed = appointmentInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: plainValidationError(parsed.error, APPOINTMENT_FIELD_LABELS, 'The appointment did not save. Check each box and try again.'), code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  try {
    const result = await db.transaction((trx) =>
      updateAppointment(trx, { profileId, appointmentId: String(req.params['appointmentId']), actorId: req.account!.id, input: parsed.data, timeZone: tzOf(req) })
    );
    if (!result) {
      res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ appointment: await fullAppointment(profileId, result.appointment.id), filed: result.filed, series_move: result.series_move });
  } catch (err) {
    if (err instanceof BookingProblem) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
});

/**
 * Add one appointment to someone's own calendar: a single calendar file with
 * the place, who it is with and their phone, what to bring and two alarms.
 */
appointmentsRouter.get('/:appointmentId/calendar.ics', requireAuth, async (req, res) => {
  const file = await appointmentIcs(String(req.params['id']), String(req.params['appointmentId']));
  if (!file) {
    res.status(404).json({ error: 'This appointment has no date yet, so there is nothing to add to a calendar.', code: 'NOT_FOUND' });
    return;
  }
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.body);
});

/**
 * Send one appointment to someone, such as whoever is driving: the time, the
 * place, the contact's phone, what to bring and how to get ready, with the
 * calendar entry attached and a link that opens with no login. Notes stay
 * private. With no email set up here, the link comes back to send another way.
 */
appointmentsRouter.post('/:appointmentId/send', requireAuth, async (req, res) => {
  const parsed = z.object({ to: sendToSchema }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose who to send it to.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  const appointmentId = String(req.params['appointmentId']);
  const found = await appointmentForSending(profileId, appointmentId);
  if (!found) {
    res.status(404).json({ error: 'That appointment could not be found.', code: 'NOT_FOUND' });
    return;
  }
  let recipient;
  try {
    recipient = await resolveRecipient(profileId, parsed.data.to);
  } catch (err) {
    if (err instanceof SendProblem) {
      res.status(400).json({ error: err.message, code: 'NO_EMAIL' });
      return;
    }
    throw err;
  }
  const link = await createShareLink(db, {
    profileId,
    kind: 'appointment',
    entityId: appointmentId,
    providerId: recipient.provider_id,
    circleMemberId: recipient.circle_member_id,
    recipientEmail: recipient.email,
    createdBy: req.account!.id,
  });
  const [zone, profile] = await Promise.all([
    ownerZone(profileId),
    db('care_profiles').where({ id: profileId }).first('full_name', 'preferred_name') as Promise<{ full_name: string; preferred_name: string | null } | undefined>,
  ]);
  const name = profile?.preferred_name || profile?.full_name || 'Someone';
  const ics = await appointmentIcs(profileId, appointmentId);
  const url = shareUrl(link.token);
  let sent = false;
  try {
    sent = await sendShareEmail(
      recipient.email,
      `${name}: ${found.shared.title}, ${whenText(found.shared.starts_at, found.shared.all_day, zone)}`,
      appointmentEmailLines(name, found.shared, zone),
      { text: 'Open the appointment', url },
      ics ? [{ filename: ics.filename, content: ics.body, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] : []
    );
  } catch (err) {
    console.error('Appointment email failed:', err);
    res.status(502).json({
      error: `The email to ${recipient.name} did not go. Copy the link and send it another way, or try again in a minute.`,
      code: 'EMAIL_FAILED',
      link: linkOut(link),
      recipient: { name: recipient.name, email: recipient.email },
    });
    return;
  }
  res.status(201).json({ sent, link: linkOut(link), recipient: { name: recipient.name, email: recipient.email } });
});

/** Stop a repeating appointment here. Later ones nobody has added to are removed. */
appointmentsRouter.post('/:appointmentId/stop-repeating', requireAuth, async (req, res) => {
  const profileId = String(req.params['id']);
  const result = await db.transaction((trx) => stopRepeating(trx, profileId, String(req.params['appointmentId'])));
  if (!result) {
    res.status(404).json({ error: 'That appointment does not repeat.', code: 'NOT_FOUND' });
    return;
  }
  res.json(result);
});

/** After moving one in a series, move the later ones by the same change. */
appointmentsRouter.post('/:appointmentId/move-later', requireAuth, async (req, res) => {
  const parsed = z.object({ from_starts_at: z.string().datetime() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say where it moved from.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  const result = await db.transaction((trx) => moveLater(trx, profileId, String(req.params['appointmentId']), parsed.data.from_starts_at));
  if (!result) {
    res.status(404).json({ error: 'That appointment does not repeat.', code: 'NOT_FOUND' });
    return;
  }
  res.json(result);
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
  const ids = (await db('appointments').where({ care_profile_id: req.params['id'] }).whereIn('id', parsed.data.ids).pluck('id')) as string[];
  // Attended, cancelled or gone: no night-before reminder.
  await removePreparationTasks(db, ids);
  const scope = db('appointments').whereIn('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (parsed.data.action === 'delete') {
    const deleted = await scope.del();
    await refreshReferrals(db, String(req.params['id']));
    res.json({ deleted });
    return;
  }
  const updated = await scope.update({
    status: parsed.data.action === 'complete' ? 'completed' : 'cancelled',
    updated_at: db.fn.now(),
  });
  await refreshReferrals(db, String(req.params['id']));
  res.json({ updated });
});

appointmentsRouter.delete('/:appointmentId', requireAuth, async (req, res) => {
  const scope = { id: req.params['appointmentId'], care_profile_id: req.params['id'] };
  await removePreparationTasks(db, ((await db('appointments').where(scope).pluck('id')) as string[]));
  const deleted = await db('appointments').where(scope).delete();
  if (!deleted) {
    res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' });
    return;
  }
  await refreshReferrals(db, String(req.params['id']));
  res.json({ message: 'Appointment deleted.' });
});
