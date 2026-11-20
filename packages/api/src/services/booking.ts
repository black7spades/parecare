import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../config/database';
import { deliverForwards } from './noteForwards';
import { appointmentPlaceColumns, contactSummaries, ensureProfessional, fillProfessionalGaps, linkContact, type KnownPlace } from './professionals';
import { createTask, ownerZone } from './tasks';
import { withCategory } from './documentCategories';
import { REPEAT_CHOICE_VALUES, advance, repeatChoice, repeatColumns } from '../lib/repeat';
import { dateInZone, parseZonedTime, isValidTimeZone } from '../lib/timezone';

type Conn = Knex | Knex.Transaction;

/**
 * Appointments are written in one place. The booking form, "Book it now" in
 * How did it go, Pare and the document reader all book through here, so the
 * place, a new contact, the task it carries out, cost, the people going,
 * documents to bring, preparation and repeats behave the same everywhere.
 */

export const APPOINTMENT_TYPES = ['consultation', 'test', 'procedure', 'therapy', 'review', 'vaccination', 'other'] as const;
// to_book: everything is known except the date; it waits on a to-do.
export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'missed', 'to_book'] as const;

const attendeeSchema = z
  .object({
    circle_member_id: z.string().uuid().optional().nullable(),
    account_id: z.string().uuid().optional().nullable(),
    is_driver: z.boolean().default(false),
  })
  .refine((a) => !!a.circle_member_id !== !!a.account_id, { message: 'Pick one person for each place.' });

export const appointmentInputSchema = z.object({
  title: z.string().min(1).max(255),
  appointment_type: z.enum(APPOINTMENT_TYPES).default('consultation'),
  provider_id: z.string().uuid().optional().nullable(),
  medical_condition_id: z.string().uuid().optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  address_line1: z.string().max(255).optional().nullable(),
  address_line2: z.string().max(255).optional().nullable(),
  address_suburb: z.string().max(120).optional().nullable(),
  address_state: z.string().max(120).optional().nullable(),
  address_postcode: z.string().max(20).optional().nullable(),
  address_country: z.string().max(120).optional().nullable(),
  directions_link: z.string().max(2000).optional().nullable(),
  provider_name: z.string().max(255).optional().nullable(),
  provider_type: z.string().max(100).optional().nullable(),
  provider_phone: z.string().max(50).optional().nullable(),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
  // No set time: starts_at is midnight that day where they live.
  all_day: z.boolean().optional(),
  status: z.enum(APPOINTMENT_STATUSES).default('scheduled'),
  notes: z.string().max(4000).optional().nullable(),
  cost_estimate: z.coerce.number().min(0).max(1e9).optional().nullable(),
  cost_actual: z.coerce.number().min(0).max(1e9).optional().nullable(),
  from_reminder_id: z.string().uuid().optional().nullable(),
  preparation: z.string().max(4000).optional().nullable(),
  telehealth_link: z.string().max(2000).optional().nullable(),
  interpreter_needed: z.boolean().optional(),
  interpreter_language: z.string().max(100).optional().nullable(),
  attendees: z.array(attendeeSchema).max(30).optional(),
  bring_document_ids: z.array(z.string().uuid()).max(50).optional(),
  repeat: z.enum(REPEAT_CHOICE_VALUES).optional(),
  repeat_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  tz: z.string().max(64).optional().nullable(),
});
export type AppointmentInput = z.infer<typeof appointmentInputSchema>;

export class BookingProblem extends Error {}

/**
 * Keep an appointment's single spend entry in step with its cost. A confirmed
 * actual wins; otherwise an estimate is kept as pending; clearing both removes
 * the entry. The entry is dated to the appointment day.
 */
export async function syncAppointmentSpend(
  appointmentId: string,
  profileId: string,
  accountId: string,
  startsAt: string | Date | null,
  cost: { estimate?: number | null; actual?: number | null },
  conn: Conn = db
): Promise<void> {
  const spentOn = new Date(startsAt ?? Date.now()).toISOString().slice(0, 10);
  const hasActual = cost.actual != null;
  const hasEstimate = cost.estimate != null;
  if (!hasActual && !hasEstimate) {
    if (cost.actual === null || cost.estimate === null) {
      await conn('health_spend_entries').where({ appointment_id: appointmentId }).del();
    }
    return;
  }
  const amount = hasActual ? cost.actual! : cost.estimate!;
  const status = hasActual ? 'confirmed' : 'estimated';
  await conn('health_spend_entries')
    .insert({ care_profile_id: profileId, appointment_id: appointmentId, amount, spent_on: spentOn, category: 'appointment', status, created_by_account_id: accountId })
    .onConflict('appointment_id')
    .merge({ amount, status, spent_on: spentOn, updated_at: conn.fn.now() });
}

/**
 * The to-do that keeps an appointment that is not booked yet in view. An open
 * task already doing this booking is used instead of adding a second one.
 */
export async function addBookingTodo(
  profileId: string,
  title: string,
  actorId: string,
  conn: Conn = db,
  providerId: string | null = null
): Promise<string> {
  const result = await createTask(conn, {
    profileId,
    actorId,
    input: {
      title: `Book ${title}`.slice(0, 255),
      next_due_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      provider_id: providerId,
      no_infer: true,
    },
    joinNote: `Waiting on “${title}”, saved without a date.`,
  });
  if (!result.joined_into) {
    await conn('audit_log').insert({
      care_profile_id: profileId, actor_account_id: actorId, action: 'created', entity_type: 'reminders',
      entity_id: result.reminder.id, summary: `Book ${title}`.slice(0, 255), source: 'person',
    });
  }
  return result.reminder.id;
}

const PLACE_KEYS = ['location', 'address_line1', 'address_line2', 'address_suburb', 'address_state', 'address_postcode', 'address_country', 'directions_link'] as const;
const EXTRA_KEYS = ['attendees', 'bring_document_ids', 'repeat', 'repeat_until', 'tz', 'provider_phone', 'cost_estimate', 'cost_actual'] as const;

/** The columns an appointment write stores, with a new contact filed and linked. */
async function appointmentColumns(
  conn: Conn,
  profileId: string,
  data: Partial<AppointmentInput>,
  filed: Array<{ id: string; name: string }>
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = { ...data };
  const { provider_name, provider_type, provider_phone } = data;
  delete fields['provider_name'];
  delete fields['provider_type'];
  for (const k of EXTRA_KEYS) delete fields[k];
  const place: Record<string, string | null | undefined> = {};
  for (const k of PLACE_KEYS) {
    if (k in fields) {
      place[k] = fields[k] as string | null | undefined;
      delete fields[k];
    }
  }
  const placeCols = Object.keys(place).length ? appointmentPlaceColumns(place) : {};
  const out: Record<string, unknown> = { ...fields, ...placeCols };
  for (const k of ['preparation', 'telehealth_link', 'interpreter_language'] as const) {
    if (k in out) out[k] = String(out[k] ?? '').trim() || null;
  }
  if (out['interpreter_needed'] === false) out['interpreter_language'] = null;
  const known: KnownPlace | null = Object.keys(placeCols).length ? (placeCols as KnownPlace) : null;
  if (!data.provider_id && provider_name?.trim()) {
    const pro = await ensureProfessional(conn, { profileId, name: provider_name, providerType: provider_type, place: known, phone: provider_phone });
    if (pro) {
      out['provider_id'] = pro.id;
      if (pro.created) filed.push({ id: pro.id, name: pro.name });
    }
  } else if (data.provider_id) {
    // Someone from the account's directory is linked to this person; anyone
    // else's contact is never attached.
    if (!(await linkContact(conn, profileId, data.provider_id))) {
      throw new BookingProblem("That contact is not in this person's contacts. Add them to Contacts first, then pick them here.");
    }
    if (known) await fillProfessionalGaps(conn, data.provider_id, known);
    if (provider_phone?.trim()) {
      await conn('providers').where({ id: data.provider_id }).where((w) => w.whereNull('phone').orWhereRaw("trim(phone) = ''")).update({ phone: provider_phone.trim() });
    }
  }
  return out;
}


const PREP_AHEAD_MS = 14 * 24 * 3600 * 1000;

/**
 * The night-before reminder for an appointment with preparation: one task,
 * due at 7pm the evening before where they live, moved with the date and
 * gone when the preparation is cleared or the appointment is cancelled.
 */
export async function syncPreparationTask(conn: Conn, appointmentId: string, timeZone?: string | null): Promise<void> {
  const a = (await conn('appointments').where({ id: appointmentId }).first()) as Record<string, unknown> | undefined;
  if (!a) return;
  const taskId = a['preparation_task_id'] as string | null;
  const prep = String(a['preparation'] ?? '').trim();
  // Only the next fortnight gets its reminder, so a long repeat does not fill
  // the task list; the daily check adds each one as it comes into range.
  const soon = !!a['starts_at'] && new Date(a['starts_at'] as string).getTime() <= Date.now() + PREP_AHEAD_MS;
  const wanted = !!prep && soon && new Date(a['starts_at'] as string).getTime() > Date.now() && !['cancelled', 'missed', 'completed'].includes(String(a['status']));
  if (!wanted) {
    if (taskId) {
      await conn('appointments').where({ id: appointmentId }).update({ preparation_task_id: null });
      await conn('reminders').where({ id: taskId }).delete();
    }
    return;
  }
  const zone = await ownerZone(conn, String(a['care_profile_id']), timeZone);
  const day = dateInZone(new Date(a['starts_at'] as string), zone);
  const eve = new Date(`${day}T12:00:00Z`);
  eve.setUTCDate(eve.getUTCDate() - 1);
  const eveDay = eve.toISOString().slice(0, 10);
  const due = (zone ? parseZonedTime(`${eveDay}T19:00:00`, zone) : null) ?? new Date(`${eveDay}T19:00:00Z`);
  const fields = {
    title: `Get ready for ${String(a['title'])} tomorrow`.slice(0, 255),
    body: prep,
    next_due_at: due,
    all_day: false,
    medical_condition_id: a['medical_condition_id'] ?? null,
    provider_id: a['provider_id'] ?? null,
  };
  const existing = (taskId ? await conn('reminders').where({ id: taskId }).first('id', 'next_due_at') : null) as { id: string; next_due_at: Date } | null;
  if (existing) {
    // Ticked off stays ticked off; only a new date makes it due again.
    const moved = new Date(existing.next_due_at).getTime() !== due.getTime();
    await conn('reminders').where({ id: taskId! }).update({ ...fields, ...(moved ? { completed: false, completed_at: null, last_notified_at: null } : {}) });
    return;
  }
  // Deleted by the person: not made again until the preparation changes.
  if (a['preparation_reminder_off']) return;
  const [row] = await conn('reminders')
    .insert({ care_profile_id: a['care_profile_id'], reminder_type: 'once', ...fields })
    .returning('id');
  await conn('appointments').where({ id: appointmentId }).update({ preparation_task_id: (row as { id: string }).id });
}

async function setAttendees(conn: Conn, profileId: string, appointmentId: string, attendees: AppointmentInput['attendees']) {
  if (!attendees) return;
  await conn('appointment_attendees').where({ appointment_id: appointmentId }).delete();
  const members = new Set((await conn('care_circle_members').where({ care_profile_id: profileId }).pluck('id')) as string[]);
  const owner = ((await conn('care_profiles').where({ id: profileId }).first('account_id')) as { account_id: string }).account_id;
  const seen = new Set<string>();
  const rows = attendees
    .filter((p) => (p.circle_member_id ? members.has(p.circle_member_id) : p.account_id === owner))
    .filter((p) => {
      const key = p.circle_member_id ?? `a:${p.account_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({ appointment_id: appointmentId, circle_member_id: p.circle_member_id ?? null, account_id: p.circle_member_id ? null : p.account_id, is_driver: p.is_driver }));
  if (rows.length) await conn('appointment_attendees').insert(rows);
}

/** Mark which linked documents to bring; documents named here are linked if they were not. */
async function setBring(conn: Conn, profileId: string, appointmentId: string, ids: string[] | undefined) {
  if (!ids) return;
  const docs = (await conn('documents').where({ care_profile_id: profileId }).whereIn('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).pluck('id')) as string[];
  await conn('document_links').where({ entity_type: 'appointments', entity_id: appointmentId }).whereNotIn('document_id', docs.length ? docs : ['00000000-0000-0000-0000-000000000000']).update({ bring: false });
  if (docs.length) {
    await conn('document_links')
      .insert(docs.map((d) => ({ document_id: d, entity_type: 'appointments', entity_id: appointmentId, bring: true })))
      .onConflict(['document_id', 'entity_type', 'entity_id'])
      .merge({ bring: true });
  }
}

/** How far ahead a repeat is laid out: 13 weeks for daily and weekly kinds, a year for the rest. */
function horizonFor(rrule: string): Date {
  const weekly = /FREQ=(DAILY|WEEKLY)/i.test(rrule);
  return new Date(Date.now() + (weekly ? 13 * 7 : 366) * 24 * 3600 * 1000);
}

/** Lay out the occurrences ahead of the last one in a series, at most 12 at a time. */
export async function extendSeries(conn: Conn, seriesId: string, timeZone?: string | null): Promise<number> {
  const series = (await conn('appointment_series').where({ id: seriesId }).first()) as { id: string; care_profile_id: string; rrule: string; repeat_until: string | Date | null } | undefined;
  if (!series) return 0;
  const last = (await conn('appointments').where({ series_id: seriesId }).whereNotNull('starts_at').orderBy('starts_at', 'desc').first()) as Record<string, unknown> | undefined;
  if (!last) return 0;
  const zone = await ownerZone(conn, series.care_profile_id, timeZone);
  const until = series.repeat_until ? String(series.repeat_until instanceof Date ? series.repeat_until.toISOString() : series.repeat_until).slice(0, 10) : null;
  const horizon = horizonFor(series.rrule);
  const firstRow = (await conn('appointments').where({ series_id: seriesId }).whereNotNull('starts_at').orderBy('starts_at', 'asc').first('starts_at')) as { starts_at: Date };
  const anchorDay = Number(dateInZone(new Date(firstRow.starts_at), zone).slice(8, 10));
  const attendees = (await conn('appointment_attendees').where({ appointment_id: last['id'] })) as Array<{ circle_member_id: string | null; account_id: string | null; is_driver: boolean }>;
  const bring = (await conn('document_links').where({ entity_type: 'appointments', entity_id: last['id'], bring: true }).pluck('document_id')) as string[];
  const lengthMs = last['ends_at'] ? new Date(last['ends_at'] as string).getTime() - new Date(last['starts_at'] as string).getTime() : null;
  let at = new Date(last['starts_at'] as string);
  let made = 0;
  for (let i = 0; i < 12; i++) {
    at = advance(at, series.rrule, zone, anchorDay);
    if (at > horizon) break;
    if (until && dateInZone(at, zone) > until) break;
    const copy: Record<string, unknown> = {};
    for (const k of ['care_profile_id', 'title', 'appointment_type', 'provider_id', 'medical_condition_id', 'location', 'address_line1', 'address_line2', 'address_suburb', 'address_state', 'address_postcode', 'address_country', 'directions_link', 'notes', 'all_day', 'preparation', 'telehealth_link', 'interpreter_needed', 'interpreter_language', 'created_by_account_id']) {
      copy[k] = last[k] ?? null;
    }
    const [row] = await conn('appointments')
      .insert({ ...copy, interpreter_needed: !!last['interpreter_needed'], all_day: !!last['all_day'], series_id: seriesId, starts_at: at, ends_at: lengthMs != null ? new Date(at.getTime() + lengthMs) : null, status: 'scheduled' })
      .returning('id');
    const id = (row as { id: string }).id;
    if (attendees.length) await conn('appointment_attendees').insert(attendees.map((p) => ({ appointment_id: id, circle_member_id: p.circle_member_id, account_id: p.account_id, is_driver: p.is_driver })));
    if (bring.length) await conn('document_links').insert(bring.map((d) => ({ document_id: d, entity_type: 'appointments', entity_id: id, bring: true }))).onConflict(['document_id', 'entity_type', 'entity_id']).ignore();
    await syncPreparationTask(conn, id, zone);
    made++;
  }
  return made;
}

/** Start repeating from this appointment. */
async function startSeries(conn: Conn, appointmentId: string, profileId: string, actorId: string, repeat: string, repeatUntil: string | null | undefined, zone: string | null) {
  const cols = repeatColumns(repeat);
  if (!cols.rrule) return;
  const [s] = await conn('appointment_series')
    .insert({ care_profile_id: profileId, rrule: cols.rrule, repeat_until: repeatUntil || null, created_by_account_id: actorId })
    .returning('id');
  const seriesId = (s as { id: string }).id;
  await conn('appointments').where({ id: appointmentId }).update({ series_id: seriesId });
  await extendSeries(conn, seriesId, zone);
}

/** Occurrences after this one that nobody has added anything to yet. */
async function laterCleanOccurrences(conn: Conn, appointment: { id: string; series_id: string | null; starts_at: Date | string | null }) {
  if (!appointment.series_id || !appointment.starts_at) return [] as Array<{ id: string; starts_at: Date; ends_at: Date | null; preparation_task_id: string | null }>;
  return (await conn('appointments as a')
    .where({ 'a.series_id': appointment.series_id, 'a.status': 'scheduled' })
    .where('a.starts_at', '>', appointment.starts_at)
    .whereNot('a.id', appointment.id)
    .whereNull('a.outcome')
    .whereNotExists(conn('record_notes as n').whereRaw("n.entity_type = 'appointments' AND n.entity_id = a.id"))
    .whereNotExists(conn('document_links as l').whereRaw("l.entity_type = 'appointments' AND l.entity_id = a.id AND l.bring = false"))
    .orderBy('a.starts_at', 'asc')
    .select('a.id', 'a.starts_at', 'a.ends_at', 'a.preparation_task_id')) as Array<{ id: string; starts_at: Date; ends_at: Date | null; preparation_task_id: string | null }>;
}

/** Stop a series at this appointment: later ones nobody has added to are removed. */
export async function stopRepeating(conn: Conn, profileId: string, appointmentId: string): Promise<{ removed: number } | null> {
  const a = (await conn('appointments').where({ id: appointmentId, care_profile_id: profileId }).first()) as { id: string; series_id: string | null; starts_at: Date | null } | undefined;
  if (!a || !a.series_id) return null;
  const zone = await ownerZone(conn, profileId);
  const later = await laterCleanOccurrences(conn, a);
  const prepIds = later.map((l) => l.preparation_task_id).filter((v): v is string => !!v);
  if (later.length) await conn('appointments').whereIn('id', later.map((l) => l.id)).delete();
  if (prepIds.length) await conn('reminders').whereIn('id', prepIds).delete();
  await conn('appointment_series').where({ id: a.series_id }).update({ repeat_until: a.starts_at ? dateInZone(new Date(a.starts_at), zone) : null, updated_at: conn.fn.now() });
  return { removed: later.length };
}

/** Move the later ones in a series by the same change as this one. */
export async function moveLater(conn: Conn, profileId: string, appointmentId: string, fromStartsAt: string): Promise<{ moved: number } | null> {
  const a = (await conn('appointments').where({ id: appointmentId, care_profile_id: profileId }).first()) as { id: string; series_id: string | null; starts_at: Date | null } | undefined;
  if (!a || !a.series_id || !a.starts_at) return null;
  const delta = new Date(a.starts_at).getTime() - new Date(fromStartsAt).getTime();
  if (!delta) return { moved: 0 };
  const later = await laterCleanOccurrences(conn, { id: a.id, series_id: a.series_id, starts_at: fromStartsAt });
  for (const l of later) {
    await conn('appointments').where({ id: l.id }).update({
      starts_at: new Date(new Date(l.starts_at).getTime() + delta),
      ends_at: l.ends_at ? new Date(new Date(l.ends_at).getTime() + delta) : null,
      updated_at: conn.fn.now(),
    });
    await syncPreparationTask(conn, l.id);
  }
  return { moved: later.length };
}

/** Repeating appointments are kept a season ahead. Once a day is plenty. */
export async function topUpAllSeries(conn: Conn = db): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await conn('appointment_series as s')
    .join('care_profiles as cp', 's.care_profile_id', 'cp.id')
    .whereNull('cp.died_on')
    .where((w) => w.whereNull('s.repeat_until').orWhere('s.repeat_until', '>=', today))
    .select('s.id')) as Array<{ id: string }>;
  for (const r of rows) await extendSeries(conn, r.id).catch((err) => console.warn('Series top-up failed:', (err as Error).message));
  // Night-before reminders for appointments coming into the next fortnight.
  const due = (await conn('appointments as a')
    .join('care_profiles as cp', 'a.care_profile_id', 'cp.id')
    .whereNull('cp.died_on')
    .whereNull('a.preparation_task_id')
    .whereNotNull('a.preparation')
    .where('a.status', 'scheduled')
    .whereBetween('a.starts_at', [new Date(), new Date(Date.now() + PREP_AHEAD_MS)])
    .pluck('a.id')) as string[];
  for (const id of due) await syncPreparationTask(conn, id).catch((err) => console.warn('Preparation reminder failed:', (err as Error).message));
}

export interface BookResult {
  appointment: Record<string, unknown> & { id: string };
  filed: Array<{ id: string; name: string }>;
}

/** Book an appointment, with or without its date. */
export async function bookAppointment(
  conn: Conn,
  opts: { profileId: string; actorId: string; input: AppointmentInput; timeZone?: string | null }
): Promise<BookResult> {
  const { profileId, actorId, input } = opts;
  const zone = await ownerZone(conn, profileId, input.tz ?? opts.timeZone);
  const filed: Array<{ id: string; name: string }> = [];
  const cols = await appointmentColumns(conn, profileId, input, filed);
  const dated = !!input.starts_at;
  if (!dated) {
    cols['starts_at'] = null;
    cols['status'] = 'to_book';
    if (!input.from_reminder_id) {
      cols['from_reminder_id'] = await addBookingTodo(profileId, input.title, actorId, conn, (cols['provider_id'] as string | null) ?? null);
    }
  }
  if (cols['all_day']) cols['ends_at'] = null;
  const [appointment] = await conn('appointments')
    .insert({ care_profile_id: profileId, ...cols, created_by_account_id: actorId })
    .returning('*');
  const id = (appointment as { id: string }).id;
  if (input.from_reminder_id) {
    if (dated) {
      await conn('reminders')
        .where({ id: input.from_reminder_id, care_profile_id: profileId, completed: false })
        .update({ completed: true, completed_at: conn.fn.now(), completed_by_account_id: actorId });
    }
    await deliverForwards(conn, { profileId, reminderId: input.from_reminder_id, appointmentId: id });
  }
  await setAttendees(conn, profileId, id, input.attendees);
  // The task's documents come to the appointment to be brought, unless the
  // form said exactly what to bring.
  let bring = input.bring_document_ids;
  if (!bring && input.from_reminder_id) {
    bring = (await conn('document_links').where({ entity_type: 'reminders', entity_id: input.from_reminder_id }).pluck('document_id')) as string[];
  }
  await setBring(conn, profileId, id, bring);
  await syncAppointmentSpend(id, profileId, actorId, input.starts_at ?? null, { estimate: input.cost_estimate, actual: input.cost_actual }, conn);
  await syncPreparationTask(conn, id, zone);
  if (dated && input.repeat && input.repeat !== 'once') await startSeries(conn, id, profileId, actorId, input.repeat, input.repeat_until, zone);
  const row = (await conn('appointments').where({ id }).first()) as BookResult['appointment'];
  return { appointment: row, filed };
}

export interface UpdateResult extends BookResult {
  /** A moved appointment in a series, so the screen can offer to move the later ones. */
  series_move: { from_starts_at: string; later: number } | null;
}

/** Change an appointment. Editing one in a series changes that one only. */
export async function updateAppointment(
  conn: Conn,
  opts: { profileId: string; appointmentId: string; actorId: string; input: Partial<AppointmentInput>; timeZone?: string | null }
): Promise<UpdateResult | null> {
  const { profileId, actorId, input } = opts;
  const before = (await conn('appointments').where({ id: opts.appointmentId, care_profile_id: profileId }).first()) as
    | (Record<string, unknown> & { id: string; starts_at: Date | null; status: string; from_reminder_id: string | null; series_id: string | null })
    | undefined;
  if (!before) return null;
  if (input.starts_at === null && before.starts_at) {
    throw new BookingProblem('A booked appointment keeps its date. Change the date, or cancel the appointment.');
  }
  const zone = await ownerZone(conn, profileId, input.tz ?? opts.timeZone);
  const filed: Array<{ id: string; name: string }> = [];
  const cols = await appointmentColumns(conn, profileId, input, filed);
  // New preparation wording brings back a night-before reminder that was deleted.
  if (input.preparation !== undefined && (input.preparation ?? '').trim() !== String(before['preparation'] ?? '').trim()) cols['preparation_reminder_off'] = false;
  const nowBooked = !before.starts_at && !!input.starts_at;
  if (nowBooked && (!input.status || input.status === 'to_book')) cols['status'] = 'scheduled';
  if (!before.starts_at && !input.starts_at && input.status === undefined) cols['status'] = before.status;
  if (cols['all_day']) cols['ends_at'] = null;
  await conn('appointments').where({ id: before.id }).update({ ...cols, updated_at: conn.fn.now() });
  if (nowBooked && before.from_reminder_id) {
    await conn('reminders')
      .where({ id: before.from_reminder_id, care_profile_id: profileId, completed: false })
      .update({ completed: true, completed_at: conn.fn.now(), completed_by_account_id: actorId });
  }
  if (input.starts_at && input.cost_estimate === undefined && input.cost_actual === undefined) {
    await conn('health_spend_entries').where({ appointment_id: before.id }).update({ spent_on: new Date(input.starts_at).toISOString().slice(0, 10), updated_at: conn.fn.now() });
  }
  const after = (await conn('appointments').where({ id: before.id }).first()) as Record<string, unknown> & { id: string; starts_at: Date | null; series_id: string | null };
  if (input.cost_estimate !== undefined || input.cost_actual !== undefined) {
    await syncAppointmentSpend(before.id, profileId, actorId, after.starts_at, { estimate: input.cost_estimate, actual: input.cost_actual }, conn);
  }
  await setAttendees(conn, profileId, before.id, input.attendees);
  await setBring(conn, profileId, before.id, input.bring_document_ids);
  // Whoever it is with learns the place, if Contacts had nothing for them.
  const providerId = after['provider_id'] as string | null;
  if (providerId && input.provider_id === undefined && !input.provider_name) {
    await fillProfessionalGaps(conn, providerId, {
      address_line1: after['address_line1'] as string, address_line2: after['address_line2'] as string, address_suburb: after['address_suburb'] as string,
      address_state: after['address_state'] as string, address_postcode: after['address_postcode'] as string, address_country: after['address_country'] as string,
      directions_link: after['directions_link'] as string,
    });
  }
  await syncPreparationTask(conn, before.id, zone);

  // Repeats.
  if (input.repeat !== undefined && after.starts_at) {
    if (!after.series_id && input.repeat !== 'once') {
      await startSeries(conn, before.id, profileId, actorId, input.repeat, input.repeat_until, zone);
    } else if (after.series_id) {
      const series = (await conn('appointment_series').where({ id: after.series_id }).first()) as { rrule: string; repeat_until: unknown };
      const current = repeatChoice({ rrule: series.rrule });
      if (input.repeat === 'once') await stopRepeating(conn, profileId, before.id);
      else if (input.repeat !== current) {
        const later = await laterCleanOccurrences(conn, after);
        if (later.length) await conn('appointments').whereIn('id', later.map((l) => l.id)).delete();
        const prepIds = later.map((l) => l.preparation_task_id).filter((v): v is string => !!v);
        if (prepIds.length) await conn('reminders').whereIn('id', prepIds).delete();
        await conn('appointment_series').where({ id: after.series_id }).update({ rrule: repeatColumns(input.repeat).rrule, repeat_until: input.repeat_until ?? null, updated_at: conn.fn.now() });
        await extendSeries(conn, after.series_id, zone);
      } else if (input.repeat_until !== undefined) {
        await conn('appointment_series').where({ id: after.series_id }).update({ repeat_until: input.repeat_until || null, updated_at: conn.fn.now() });
        if (input.repeat_until) {
          const later = await laterCleanOccurrences(conn, after);
          const past = later.filter((l) => dateInZone(new Date(l.starts_at), zone) > input.repeat_until!);
          if (past.length) await conn('appointments').whereIn('id', past.map((l) => l.id)).delete();
          const pastPrep = past.map((l) => l.preparation_task_id).filter((v): v is string => !!v);
          if (pastPrep.length) await conn('reminders').whereIn('id', pastPrep).delete();
        } else await extendSeries(conn, after.series_id, zone);
      }
    }
  }

  let seriesMove: UpdateResult['series_move'] = null;
  const fresh = (await conn('appointments').where({ id: before.id }).first()) as Record<string, unknown> & { id: string; starts_at: Date | null; series_id: string | null };
  if (fresh.series_id && before.starts_at && fresh.starts_at && new Date(before.starts_at).getTime() !== new Date(fresh.starts_at).getTime()) {
    const later = await laterCleanOccurrences(conn, { id: fresh.id, series_id: fresh.series_id, starts_at: before.starts_at });
    if (later.length) seriesMove = { from_starts_at: new Date(before.starts_at).toISOString(), later: later.length };
  }
  return { appointment: fresh, filed, series_move: seriesMove };
}

/** Before an appointment goes: its night-before reminder goes too. */
export async function removePreparationTasks(conn: Conn, appointmentIds: string[]): Promise<void> {
  if (appointmentIds.length === 0) return;
  const ids = (await conn('appointments').whereIn('id', appointmentIds).whereNotNull('preparation_task_id').pluck('preparation_task_id')) as string[];
  if (ids.length) {
    await conn('appointments').whereIn('id', appointmentIds).update({ preparation_task_id: null });
    await conn('reminders').whereIn('id', ids).delete();
  }
}

/**
 * What an appointment list shows beyond the row: who it is with as someone
 * to call, who is going, what to bring, its repeat, and the task it came from.
 */
export async function enrichAppointments(conn: Conn, profileId: string, rows: Array<Record<string, unknown> & { id: string }>) {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const taskIds = rows.map((r) => r['from_reminder_id']).filter(Boolean) as string[];
  const [contacts, attendees, bring, series, tasks, taskNotes] = await Promise.all([
    contactSummaries(conn, rows.map((r) => r['provider_id'] as string | null), profileId),
    conn('appointment_attendees as t')
      .leftJoin('care_circle_members as m', 't.circle_member_id', 'm.id')
      .leftJoin('accounts as ac', 't.account_id', 'ac.id')
      .whereIn('t.appointment_id', ids)
      .orderBy('t.created_at', 'asc')
      .select('t.appointment_id', 't.circle_member_id', 't.account_id', 't.is_driver', db.raw('coalesce(m.display_name, ac.display_name) as name'), 'm.phone'),
    withCategory(conn('documents'))
      .join('document_links as l', 'l.document_id', 'documents.id')
      .where({ 'documents.care_profile_id': profileId, 'l.entity_type': 'appointments', 'l.bring': true })
      .whereIn('l.entity_id', ids)
      .select('l.entity_id'),
    conn('appointment_series').whereIn('id', rows.map((r) => r['series_id']).filter(Boolean) as string[]).select('id', 'rrule', 'repeat_until'),
    taskIds.length ? conn('reminders').whereIn('id', taskIds).select('id', 'title', 'body', 'completed_at') : Promise.resolve([]),
    taskIds.length
      ? conn('record_notes as n').leftJoin('accounts as a', 'n.author_account_id', 'a.id').where({ 'n.entity_type': 'reminders' }).whereIn('n.entity_id', taskIds).orderBy('n.created_at', 'asc').select('n.id', 'n.entity_id', 'n.body', 'n.created_at', 'a.display_name as author_name')
      : Promise.resolve([]),
  ]);
  const group = <T extends Record<string, unknown>>(list: T[], key: string) => {
    const m = new Map<string, T[]>();
    for (const x of list) {
      const k = String(x[key]);
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    return m;
  };
  const attendeesBy = group(attendees as Array<Record<string, unknown>>, 'appointment_id');
  const bringBy = group(bring as Array<Record<string, unknown>>, 'entity_id');
  const seriesBy = new Map((series as Array<{ id: string; rrule: string; repeat_until: Date | string | null }>).map((s) => [s.id, s]));
  const taskBy = new Map((tasks as Array<{ id: string; title: string; body: string | null; completed_at: Date | null }>).map((t) => [t.id, t]));
  const notesBy = group(taskNotes as Array<Record<string, unknown>>, 'entity_id');
  return rows.map((r) => {
    const s = r['series_id'] ? seriesBy.get(r['series_id'] as string) : undefined;
    const t = r['from_reminder_id'] ? taskBy.get(r['from_reminder_id'] as string) : undefined;
    return {
      ...r,
      provider: r['provider_id'] ? contacts.get(r['provider_id'] as string) ?? null : null,
      attendees: (attendeesBy.get(r.id) ?? []).map((a) => ({
        circle_member_id: a['circle_member_id'] ?? null, account_id: a['account_id'] ?? null, is_driver: !!a['is_driver'], name: a['name'] ?? 'Someone', phone: a['phone'] ?? null,
      })),
      bring_documents: (bringBy.get(r.id) ?? []).map((d) => ({ id: d['id'], label: d['label'], category_name: d['category_name'] ?? null })),
      series: s ? { id: s.id, repeat: repeatChoice({ rrule: s.rrule }), repeat_until: s.repeat_until ? String(s.repeat_until instanceof Date ? s.repeat_until.toISOString() : s.repeat_until).slice(0, 10) : null } : null,
      from_task: t ? { id: t.id, title: t.title, body: t.body, completed_at: t.completed_at, notes: (notesBy.get(t.id) ?? []).map((n) => ({ id: n['id'], body: n['body'], created_at: n['created_at'], author_name: n['author_name'] ?? null })) } : null,
    };
  });
}
