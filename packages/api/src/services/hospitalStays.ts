import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../config/database';
import { contactSummaries, mainContact, resolveContactInput, type ContactSummary } from './professionals';
import { keepTask } from './keptTasks';
import { addDays } from './documentDates';
import { todayFor } from './medicationChanges';

type Conn = Knex | Knex.Transaction;

/**
 * A hospital stay: when they went in, the hospital and ward, the treating
 * team, why, and when they came home. While a stay is open the medicine
 * reminders pause, because the hospital gives the medicines. Recording the
 * discharge makes the GP follow-up and a look over the care plan, and the
 * discharge letter is filed against the stay.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max).optional().nullable();

export const stayInputSchema = z.object({
  hospital_provider_id: z.string().uuid().optional().nullable(),
  hospital_name: text(255),
  hospital_phone: text(50),
  admitted_on: day,
  discharged_on: day.optional().nullable(),
  ward: text(120),
  treating_team: text(255),
  treating_provider_id: z.string().uuid().optional().nullable(),
  treating_name: text(255),
  treating_type: text(100),
  treating_phone: text(50),
  reason: text(4000),
  follow_up_days: z.number().int().min(0).max(365).optional().nullable(),
});
export type StayInput = z.infer<typeof stayInputSchema>;

export const dischargeSchema = z.object({
  discharged_on: day,
  follow_up_days: z.number().int().min(0).max(365).optional().nullable(),
  document_id: z.string().uuid().optional().nullable(),
  follow_up_with_provider_id: z.string().uuid().optional().nullable(),
});
export type DischargeInput = z.infer<typeof dischargeSchema>;

export class StayProblem extends Error {}

/** The default days after leaving hospital to see the GP. */
export const DEFAULT_FOLLOW_UP_DAYS = 7;

export interface StayRow {
  id: string;
  care_profile_id: string;
  hospital_provider_id: string | null;
  admitted_on: string;
  discharged_on: string | null;
  ward: string | null;
  treating_team: string | null;
  treating_provider_id: string | null;
  reason: string | null;
  discharge_document_id: string | null;
  follow_up_task_id: string | null;
  plan_review_task_id: string | null;
  created_at: Date;
}

export async function openStay(conn: Conn, profileId: string): Promise<StayRow | null> {
  return ((await conn('hospital_stays').where({ care_profile_id: profileId }).whereNull('discharged_on').first()) as StayRow | undefined) ?? null;
}

/** Everyone in the list who is in hospital now. Their medicine alerts pause. */
export async function profilesInHospital(conn: Conn, profileIds: string[]): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();
  const rows = (await conn('hospital_stays').whereIn('care_profile_id', profileIds).whereNull('discharged_on').select('care_profile_id')) as Array<{ care_profile_id: string }>;
  return new Set(rows.map((r) => r.care_profile_id));
}

/** Stays, each with the hospital and treating doctor as someone to call. */
export async function staysOut(conn: Conn, profileId: string, rows: StayRow[]) {
  const contacts = await contactSummaries(
    conn,
    rows.flatMap((r) => [r.hospital_provider_id, r.treating_provider_id]),
    profileId
  );
  const docIds = rows.map((r) => r.discharge_document_id).filter((v): v is string => !!v);
  const docs = docIds.length ? ((await conn('documents').whereIn('id', docIds).select('id', 'label')) as Array<{ id: string; label: string | null }>) : [];
  const taskIds = rows.flatMap((r) => [r.follow_up_task_id, r.plan_review_task_id]).filter((v): v is string => !!v);
  const tasks = taskIds.length
    ? ((await conn('reminders').whereIn('id', taskIds).select('id', 'title', 'next_due_at', 'all_day', 'completed')) as Array<Record<string, unknown> & { id: string }>)
    : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const docById = new Map(docs.map((d) => [d.id, d]));
  return rows.map((r) => ({
    ...r,
    hospital: (r.hospital_provider_id && contacts.get(r.hospital_provider_id)) || null,
    treating: (r.treating_provider_id && contacts.get(r.treating_provider_id)) || null,
    discharge_document: r.discharge_document_id ? docById.get(r.discharge_document_id) ?? null : null,
    follow_up_task: r.follow_up_task_id ? taskById.get(r.follow_up_task_id) ?? null : null,
    plan_review_task: r.plan_review_task_id ? taskById.get(r.plan_review_task_id) ?? null : null,
  }));
}

/** The open stay as the banner shows it: "In Box Hill Hospital, Ward 5 West, since 3 Nov 2026." */
export async function openStaySummary(conn: Conn, profileId: string): Promise<{ id: string; hospital: ContactSummary | null; hospital_name: string | null; ward: string | null; admitted_on: string; days: number } | null> {
  const stay = await openStay(conn, profileId);
  if (!stay) return null;
  const [out] = await staysOut(conn, profileId, [stay]);
  const today = await todayFor(conn, profileId);
  const days = Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${stay.admitted_on}T12:00:00Z`)) / 86400000));
  return { id: stay.id, hospital: out!.hospital, hospital_name: out!.hospital?.name ?? null, ward: stay.ward, admitted_on: stay.admitted_on, days };
}

async function contactColumn(
  conn: Conn,
  profileId: string,
  input: { id?: string | null; name?: string | null; type?: string | null; phone?: string | null },
  defaultType: string,
  kind: 'person' | 'organisation',
  filed?: Array<{ id: string; name: string }>
): Promise<string | null | undefined> {
  if (input.id === undefined && input.name === undefined) return undefined;
  const r = await resolveContactInput(conn, profileId, input, defaultType, kind);
  if ('error' in r) throw new StayProblem(r.error);
  if (r.filed) filed?.push(r.filed);
  return r.id;
}

function stayColumns(input: Partial<StayInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  if (input.admitted_on !== undefined) out['admitted_on'] = input.admitted_on;
  if (input.ward !== undefined) out['ward'] = clean(input.ward);
  if (input.treating_team !== undefined) out['treating_team'] = clean(input.treating_team);
  if (input.reason !== undefined) out['reason'] = clean(input.reason);
  return out;
}

const friendly = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Record a stay. One open at a time: an earlier one still open must be discharged first. */
export async function createStay(
  conn: Conn,
  opts: { profileId: string; actorId: string | null; input: StayInput; timeZone?: string | null; documentId?: string | null }
): Promise<{ stay: StayRow; filed: Array<{ id: string; name: string }> }> {
  const { profileId, input } = opts;
  if (input.discharged_on && input.discharged_on < input.admitted_on) throw new StayProblem('Left hospital on is before Went in on. Check the two dates.');
  const open = await openStay(conn, profileId);
  if (open && !input.discharged_on) {
    const [o] = await staysOut(conn, profileId, [open]);
    throw new StayProblem(
      `They are already shown as in ${o!.hospital?.name ?? 'hospital'} since ${friendly(open.admitted_on)}. Record that discharge first, then add the new stay.`
    );
  }
  const filed: Array<{ id: string; name: string }> = [];
  const hospitalId = await contactColumn(conn, profileId, { id: input.hospital_provider_id, name: input.hospital_name, type: 'Hospital', phone: input.hospital_phone }, 'Hospital', 'organisation', filed);
  const treatingId = await contactColumn(conn, profileId, { id: input.treating_provider_id, name: input.treating_name, type: input.treating_type, phone: input.treating_phone }, 'Doctor', 'person', filed);
  const [row] = await conn('hospital_stays')
    .insert({
      care_profile_id: profileId,
      ...stayColumns(input),
      hospital_provider_id: hospitalId ?? null,
      treating_provider_id: treatingId ?? null,
      created_by_account_id: opts.actorId,
    })
    .returning('*');
  let stay = row as StayRow;
  if (input.discharged_on) {
    stay = await dischargeStay(conn, {
      profileId,
      stayId: stay.id,
      actorId: opts.actorId,
      timeZone: opts.timeZone,
      input: { discharged_on: input.discharged_on, follow_up_days: input.follow_up_days ?? null, document_id: opts.documentId ?? null },
    });
  }
  return { stay, filed };
}

export async function updateStay(
  conn: Conn,
  opts: { profileId: string; stayId: string; actorId: string | null; input: Partial<StayInput>; timeZone?: string | null }
): Promise<StayRow | null> {
  const { profileId, input } = opts;
  const before = (await conn('hospital_stays').where({ id: opts.stayId, care_profile_id: profileId }).first()) as StayRow | undefined;
  if (!before) return null;
  const filed: Array<{ id: string; name: string }> = [];
  const update = stayColumns(input);
  const hospitalId = await contactColumn(conn, profileId, { id: input.hospital_provider_id, name: input.hospital_name, type: 'Hospital', phone: input.hospital_phone }, 'Hospital', 'organisation', filed);
  if (hospitalId !== undefined) update['hospital_provider_id'] = hospitalId;
  const treatingId = await contactColumn(conn, profileId, { id: input.treating_provider_id, name: input.treating_name, type: input.treating_type, phone: input.treating_phone }, 'Doctor', 'person', filed);
  if (treatingId !== undefined) update['treating_provider_id'] = treatingId;
  const admitted = (update['admitted_on'] as string | undefined) ?? before.admitted_on;
  if (before.discharged_on && before.discharged_on < admitted && input.discharged_on === undefined) {
    throw new StayProblem('Went in on is after Left hospital on. Check the two dates.');
  }
  if (Object.keys(update).length) await conn('hospital_stays').where({ id: before.id }).update({ ...update, updated_at: conn.fn.now() });
  // Only a changed discharge day reworks the discharge, so fixing the ward
  // never brings back a task someone deleted.
  const dischargeMoved = input.discharged_on !== undefined && input.discharged_on !== before.discharged_on;
  if (dischargeMoved || (input.follow_up_days != null && before.discharged_on)) {
    if (input.discharged_on === null) return reopenStay(conn, { profileId, stayId: before.id });
    return dischargeStay(conn, {
      profileId,
      stayId: before.id,
      actorId: opts.actorId,
      timeZone: opts.timeZone,
      input: { discharged_on: (input.discharged_on ?? before.discharged_on)!, follow_up_days: input.follow_up_days ?? null },
    });
  }
  return (await conn('hospital_stays').where({ id: before.id }).first()) as StayRow;
}

/**
 * Record the discharge: the day they left, the letter, and the two tasks it
 * makes. Recording it again with a new day moves the tasks with it.
 */
export async function dischargeStay(
  conn: Conn,
  opts: { profileId: string; stayId: string; actorId: string | null; input: DischargeInput; timeZone?: string | null }
): Promise<StayRow> {
  const { profileId, input } = opts;
  const stay = (await conn('hospital_stays').where({ id: opts.stayId, care_profile_id: profileId }).first()) as StayRow | undefined;
  if (!stay) throw new StayProblem('That hospital stay was not found.');
  if (input.discharged_on < stay.admitted_on) throw new StayProblem(`Left hospital on is before they went in on ${friendly(stay.admitted_on)}. Check the date.`);
  let documentId: string | null = stay.discharge_document_id;
  if (input.document_id) {
    const doc = await conn('documents').where({ id: input.document_id, care_profile_id: profileId }).first('id');
    if (doc) documentId = input.document_id;
  }
  // The days to see the GP: what was asked for, else what the earlier
  // follow-up was set to, else a week.
  let days = input.follow_up_days ?? null;
  if (days == null && stay.discharged_on && stay.follow_up_task_id) {
    const t = (await conn('reminders').where({ id: stay.follow_up_task_id }).first('next_due_at')) as { next_due_at: Date } | undefined;
    if (t) days = Math.round((new Date(t.next_due_at).getTime() - Date.parse(`${stay.discharged_on}T00:00:00Z`)) / 86400000);
    if (days != null && (days < 0 || days > 365)) days = null;
  }
  days = days ?? DEFAULT_FOLLOW_UP_DAYS;
  const gp = input.follow_up_with_provider_id
    ? { id: input.follow_up_with_provider_id, name: ((await conn('providers').where({ id: input.follow_up_with_provider_id }).first('name')) as { name: string } | undefined)?.name ?? 'the GP' }
    : await mainContact(conn, profileId, 'gp');
  const followUp = await keepTask(conn, {
    profileId,
    actorId: opts.actorId,
    taskId: stay.follow_up_task_id,
    timeZone: opts.timeZone,
    want: {
      title: `See ${gp?.name ?? 'the GP'} within ${days} ${days === 1 ? 'day' : 'days'} of leaving hospital`,
      due_on: addDays(input.discharged_on, days),
      provider_id: gp?.id ?? null,
      kind_key: 'follow_up',
    },
  });
  const planReview = await keepTask(conn, {
    profileId,
    actorId: opts.actorId,
    taskId: stay.plan_review_task_id,
    timeZone: opts.timeZone,
    want: { title: 'Look over the care plan after the hospital stay', due_on: addDays(input.discharged_on, 7) },
  });
  await conn('hospital_stays').where({ id: stay.id }).update({
    discharged_on: input.discharged_on,
    discharge_document_id: documentId,
    follow_up_task_id: followUp,
    plan_review_task_id: planReview,
    updated_at: conn.fn.now(),
  });
  if (documentId) {
    await conn('document_links').insert({ document_id: documentId, entity_type: 'hospital-stays', entity_id: stay.id }).onConflict(['document_id', 'entity_type', 'entity_id']).ignore();
  }
  return (await conn('hospital_stays').where({ id: stay.id }).first()) as StayRow;
}

/** Taking a discharge back: the stay is open again and its open follow-up tasks go. */
export async function reopenStay(conn: Conn, opts: { profileId: string; stayId: string }): Promise<StayRow> {
  const stay = (await conn('hospital_stays').where({ id: opts.stayId, care_profile_id: opts.profileId }).first()) as StayRow;
  const open = await openStay(conn, opts.profileId);
  if (open && open.id !== stay.id) throw new StayProblem('Another stay is open already. Record that discharge first.');
  const followUp = await keepTask(conn, { profileId: opts.profileId, actorId: null, taskId: stay.follow_up_task_id, want: null });
  const planReview = await keepTask(conn, { profileId: opts.profileId, actorId: null, taskId: stay.plan_review_task_id, want: null });
  await conn('hospital_stays').where({ id: stay.id }).update({ discharged_on: null, follow_up_task_id: followUp, plan_review_task_id: planReview, updated_at: conn.fn.now() });
  return (await conn('hospital_stays').where({ id: stay.id }).first()) as StayRow;
}

/** Delete a stay recorded by mistake, with the open tasks it made. */
export async function deleteStay(conn: Conn, opts: { profileId: string; stayId: string }): Promise<boolean> {
  const stay = (await conn('hospital_stays').where({ id: opts.stayId, care_profile_id: opts.profileId }).first()) as StayRow | undefined;
  if (!stay) return false;
  for (const id of [stay.follow_up_task_id, stay.plan_review_task_id]) {
    if (id) await conn('reminders').where({ id, completed: false }).delete();
  }
  await conn('document_links').where({ entity_type: 'hospital-stays', entity_id: stay.id }).delete();
  await conn('hospital_stays').where({ id: stay.id }).delete();
  return true;
}

/** What the screen asks when a dose is recorded at home for someone shown as in hospital. */
export async function homeDoseQuestion(conn: Conn, profileId: string): Promise<{ stay_id: string; text: string } | null> {
  const stay = await openStay(conn, profileId);
  if (!stay) return null;
  const p = (await conn('care_profiles').where({ id: profileId }).first('preferred_name', 'first_name', 'full_name')) as
    | { preferred_name: string | null; first_name: string | null; full_name: string }
    | undefined;
  const name = p?.preferred_name || p?.first_name || p?.full_name || 'They';
  return { stay_id: stay.id, text: `${name} is shown as in hospital. Are they home?` };
}

/** Stays open 14 days or more, to ask whether they are still there. */
export async function longOpenStays(profileIds: string[]): Promise<Array<{ id: string; care_profile_id: string; admitted_on: string; hospital_name: string | null; days: number }>> {
  if (profileIds.length === 0) return [];
  const rows = (await db('hospital_stays as s')
    .leftJoin('providers as p', 'p.id', 's.hospital_provider_id')
    .whereIn('s.care_profile_id', profileIds)
    .whereNull('s.discharged_on')
    .whereRaw("s.admitted_on <= current_date - interval '14 days'")
    .select('s.id', 's.care_profile_id', 's.admitted_on', 'p.name as hospital_name')) as Array<{ id: string; care_profile_id: string; admitted_on: string; hospital_name: string | null }>;
  const now = Date.now();
  return rows.map((r) => ({ ...r, days: Math.floor((now - Date.parse(`${r.admitted_on}T00:00:00Z`)) / 86400000) }));
}
