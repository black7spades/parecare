import type { Knex } from 'knex';
import { z } from 'zod';
import { contactSummaries, mainContact, resolveContactInput } from './professionals';
import { ownerZone } from './tasks';
import { parseZonedTime } from '../lib/timezone';

type Conn = Knex | Knex.Transaction;

/**
 * Test results: what a blood test, a scan or another test showed, each
 * measure its own row with its unit and normal range. A result is tied to
 * the test appointment and, worked out, to the next visit with whoever
 * ordered it, so it is there to talk about at that visit.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max).optional().nullable();
const num = z.number().finite().optional().nullable();

export const DOCTOR_VIEWS = ['normal', 'follow_up', 'not_seen'] as const;
export const DOCTOR_VIEW_LABELS: Record<(typeof DOCTOR_VIEWS)[number], string> = {
  normal: 'Normal',
  follow_up: 'Needs a follow-up',
  not_seen: 'Not seen by a doctor yet',
};
export const FLAGS = ['low', 'high', 'normal'] as const;

export const resultValueSchema = z.object({
  name: z.string().trim().min(1).max(255),
  value_number: num,
  value_text: text(255),
  unit: text(30),
  range_low: num,
  range_high: num,
  flag: z.enum(FLAGS).optional().nullable(),
});

export const resultInputSchema = z.object({
  test_name: z.string().trim().min(1).max(255),
  collected_on: day.optional().nullable(),
  reported_on: day.optional().nullable(),
  appointment_id: z.string().uuid().optional().nullable(),
  review_appointment_id: z.string().uuid().optional().nullable(),
  ordered_by_provider_id: z.string().uuid().optional().nullable(),
  ordered_by_name: text(255),
  ordered_by_type: text(100),
  lab_provider_id: z.string().uuid().optional().nullable(),
  lab_name: text(255),
  medical_condition_id: z.string().uuid().optional().nullable(),
  summary: text(5000),
  doctor_view: z.enum(DOCTOR_VIEWS).optional().nullable(),
  values: z.array(resultValueSchema).max(100).optional(),
});
export type ResultInput = z.infer<typeof resultInputSchema>;

export class ResultProblem extends Error {}

/** A flag worked out from the number and the range when none was given. */
export function flagFor(v: { value_number?: number | null; range_low?: number | null; range_high?: number | null; flag?: string | null }): string | null {
  if (v.flag) return v.flag;
  if (v.value_number == null) return null;
  if (v.range_low != null && v.value_number < v.range_low) return 'low';
  if (v.range_high != null && v.value_number > v.range_high) return 'high';
  if (v.range_low != null || v.range_high != null) return 'normal';
  return null;
}

async function belongs(conn: Conn, table: string, id: string | null | undefined, profileId: string): Promise<string | null> {
  if (!id) return null;
  const row = await conn(table).where({ id, care_profile_id: profileId }).first('id');
  return row ? id : null;
}

/**
 * The visit to talk about a result at: the earliest appointment still to
 * come after it was collected, with whoever ordered it, or with their GP
 * when nobody is named.
 */
export async function reviewVisitFor(
  conn: Conn,
  profileId: string,
  opts: { orderedBy: string | null; after: string | null }
): Promise<string | null> {
  const providerId = opts.orderedBy ?? (await mainContact(conn, profileId, 'gp'))?.id ?? null;
  if (!providerId) return null;
  const zone = await ownerZone(conn, profileId);
  const afterAt = opts.after ? (parseZonedTime(`${opts.after}T23:59:59`, zone) ?? new Date(`${opts.after}T23:59:59Z`)) : new Date();
  const from = afterAt > new Date() ? afterAt : new Date();
  const row = (await conn('appointments')
    .where({ care_profile_id: profileId, provider_id: providerId, status: 'scheduled' })
    .whereNotNull('starts_at')
    .where('starts_at', '>=', from)
    .orderBy('starts_at', 'asc')
    .first('id')) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Who ordered the test, when the test was booked from a visit's next step: whoever that visit was with. */
async function orderedFromTestVisit(conn: Conn, profileId: string, appointmentId: string | null): Promise<string | null> {
  if (!appointmentId) return null;
  const appt = (await conn('appointments').where({ id: appointmentId, care_profile_id: profileId }).first('from_reminder_id')) as { from_reminder_id: string | null } | undefined;
  if (!appt?.from_reminder_id) return null;
  const task = (await conn('reminders').where({ id: appt.from_reminder_id }).first('appointment_id')) as { appointment_id: string | null } | undefined;
  if (!task?.appointment_id) return null;
  const visit = (await conn('appointments').where({ id: task.appointment_id }).first('provider_id')) as { provider_id: string | null } | undefined;
  return visit?.provider_id ?? null;
}

/** The test appointment's own day, when a result gives no collection day. */
async function appointmentDay(conn: Conn, profileId: string, appointmentId: string | null): Promise<string | null> {
  if (!appointmentId) return null;
  const a = (await conn('appointments').where({ id: appointmentId }).first('starts_at')) as { starts_at: Date | null } | undefined;
  return a?.starts_at ? new Date(a.starts_at).toISOString().slice(0, 10) : null;
}

export async function saveResult(
  conn: Conn,
  opts: { profileId: string; actorId: string | null; resultId?: string | null; input: Partial<ResultInput> }
): Promise<{ id: string; filed: Array<{ id: string; name: string }>; ticked: number }> {
  const { profileId, input } = opts;
  const before = opts.resultId
    ? ((await conn('test_results').where({ id: opts.resultId, care_profile_id: profileId }).first()) as Record<string, unknown> | undefined)
    : undefined;
  if (opts.resultId && !before) throw new ResultProblem('That result was not found.');
  const filed: Array<{ id: string; name: string }> = [];
  const contact = async (id: string | null | undefined, name: string | null | undefined, type: string | null | undefined, defaultType: string, kind: 'person' | 'organisation') => {
    if (id === undefined && name === undefined) return undefined;
    const r = await resolveContactInput(conn, profileId, { id, name, type }, defaultType, kind);
    if ('error' in r) throw new ResultProblem(r.error);
    if (r.filed) filed.push(r.filed);
    return r.id;
  };
  const cols: Record<string, unknown> = {};
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  if (input.test_name !== undefined) cols['test_name'] = input.test_name.trim();
  if (input.collected_on !== undefined) cols['collected_on'] = input.collected_on;
  if (input.reported_on !== undefined) cols['reported_on'] = input.reported_on;
  if (input.summary !== undefined) cols['summary'] = clean(input.summary);
  if (input.doctor_view !== undefined) cols['doctor_view'] = input.doctor_view;
  if (input.appointment_id !== undefined) cols['appointment_id'] = await belongs(conn, 'appointments', input.appointment_id, profileId);
  if (input.medical_condition_id !== undefined) cols['medical_condition_id'] = await belongs(conn, 'medical_conditions', input.medical_condition_id, profileId);
  const ordered = await contact(input.ordered_by_provider_id, input.ordered_by_name, input.ordered_by_type, 'Doctor', 'person');
  if (ordered !== undefined) cols['ordered_by_provider_id'] = ordered;
  const lab = await contact(input.lab_provider_id, input.lab_name, 'Pathology', 'Pathology', 'organisation');
  if (lab !== undefined) cols['lab_provider_id'] = lab;

  const testAppt = (cols['appointment_id'] as string | null | undefined) ?? ((before?.['appointment_id'] as string | null) ?? null);
  // Nobody named who ordered it, and the test was booked from a visit: that visit's contact.
  if (!('ordered_by_provider_id' in cols) && !before?.['ordered_by_provider_id']) {
    const guess = await orderedFromTestVisit(conn, profileId, testAppt);
    if (guess) cols['ordered_by_provider_id'] = guess;
  }
  if (!('collected_on' in cols) && !before?.['collected_on']) {
    const d = await appointmentDay(conn, profileId, testAppt);
    if (d) cols['collected_on'] = d;
  }
  // The visit to talk about it at: chosen, else worked out.
  if (input.review_appointment_id !== undefined) {
    cols['review_appointment_id'] = await belongs(conn, 'appointments', input.review_appointment_id, profileId);
  } else if (!before?.['review_appointment_id']) {
    cols['review_appointment_id'] = await reviewVisitFor(conn, profileId, {
      orderedBy: ((cols['ordered_by_provider_id'] ?? before?.['ordered_by_provider_id']) as string | null) ?? null,
      after: ((cols['collected_on'] ?? before?.['collected_on']) as string | null) ?? null,
    });
  }

  let id: string;
  if (before) {
    id = String(before['id']);
    if (Object.keys(cols).length) await conn('test_results').where({ id }).update({ ...cols, updated_at: conn.fn.now() });
  } else {
    if (!input.test_name?.trim()) throw new ResultProblem('Say which test it was.');
    const [row] = await conn('test_results').insert({ care_profile_id: profileId, created_by_account_id: opts.actorId, ...cols }).returning('id');
    id = (row as { id: string }).id;
  }
  if (input.values) {
    await conn('test_result_values').where({ test_result_id: id }).delete();
    if (input.values.length) {
      await conn('test_result_values').insert(
        input.values.map((v, i) => ({
          test_result_id: id,
          name: v.name.trim(),
          value_number: v.value_number ?? null,
          value_text: clean(v.value_text),
          unit: clean(v.unit),
          range_low: v.range_low ?? null,
          range_high: v.range_high ?? null,
          flag: flagFor(v),
          sort_order: i,
        }))
      );
    }
  }
  // Waiting on these results: a "Results to chase" step from the test visit,
  // or from the visit that sent them for it, is done now.
  const ticked = await tickResultsToChase(conn, profileId, testAppt, opts.actorId);
  return { id, filed, ticked };
}

async function tickResultsToChase(conn: Conn, profileId: string, testAppt: string | null, actorId: string | null): Promise<number> {
  if (!testAppt) return 0;
  const appt = (await conn('appointments').where({ id: testAppt }).first('id', 'from_reminder_id')) as { id: string; from_reminder_id: string | null } | undefined;
  const visits = [testAppt];
  if (appt?.from_reminder_id) {
    const t = (await conn('reminders').where({ id: appt.from_reminder_id }).first('appointment_id')) as { appointment_id: string | null } | undefined;
    if (t?.appointment_id) visits.push(t.appointment_id);
  }
  return conn('reminders as r')
    .where({ 'r.care_profile_id': profileId, 'r.completed': false })
    .whereIn('r.appointment_id', visits)
    .whereIn('r.next_step_type_id', conn('next_step_types').where({ system_key: 'results' }).select('id'))
    .update({ completed: true, completed_at: conn.fn.now(), completed_by_account_id: actorId });
}

const num2 = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Results with their measures, who ordered them, the lab, and the visits they belong to. */
export async function resultsOut(conn: Conn, profileId: string, rows: Array<Record<string, unknown> & { id: string }>) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [values, contacts, appts, conds] = await Promise.all([
    conn('test_result_values').whereIn('test_result_id', ids).orderBy('sort_order', 'asc'),
    contactSummaries(conn, rows.flatMap((r) => [r['ordered_by_provider_id'] as string | null, r['lab_provider_id'] as string | null]), profileId),
    conn('appointments as a')
      .leftJoin('providers as p', 'p.id', 'a.provider_id')
      .whereIn('a.id', rows.flatMap((r) => [r['appointment_id'], r['review_appointment_id']]).filter(Boolean) as string[])
      .select('a.id', 'a.title', 'a.starts_at', 'a.all_day', 'a.status', 'p.name as provider_name'),
    conn('medical_conditions').whereIn('id', rows.map((r) => r['medical_condition_id']).filter(Boolean) as string[]).select('id', 'name'),
  ]);
  const byResult = new Map<string, Array<Record<string, unknown>>>();
  for (const v of values as Array<Record<string, unknown>>) {
    const list = byResult.get(String(v['test_result_id'])) ?? [];
    list.push({ ...v, value_number: num2(v['value_number']), range_low: num2(v['range_low']), range_high: num2(v['range_high']) });
    byResult.set(String(v['test_result_id']), list);
  }
  const apptById = new Map((appts as Array<Record<string, unknown> & { id: string }>).map((a) => [a.id, a]));
  const condById = new Map((conds as Array<{ id: string; name: string }>).map((c) => [c.id, c]));
  return rows.map((r) => ({
    ...r,
    values: byResult.get(r.id) ?? [],
    ordered_by: (r['ordered_by_provider_id'] && contacts.get(r['ordered_by_provider_id'] as string)) || null,
    lab: (r['lab_provider_id'] && contacts.get(r['lab_provider_id'] as string)) || null,
    appointment: (r['appointment_id'] && apptById.get(r['appointment_id'] as string)) || null,
    review_appointment: (r['review_appointment_id'] && apptById.get(r['review_appointment_id'] as string)) || null,
    condition: (r['medical_condition_id'] && condById.get(r['medical_condition_id'] as string)) || null,
  }));
}

/** Results to talk about at each of these appointments. */
export async function resultsToDiscuss(conn: Conn, profileId: string, appointmentIds: string[]): Promise<Map<string, Array<Record<string, unknown>>>> {
  const out = new Map<string, Array<Record<string, unknown>>>();
  if (appointmentIds.length === 0) return out;
  const rows = (await conn('test_results').where({ care_profile_id: profileId }).whereIn('review_appointment_id', appointmentIds).orderBy('collected_on', 'desc')) as Array<
    Record<string, unknown> & { id: string }
  >;
  for (const r of await resultsOut(conn, profileId, rows)) {
    const key = String((r as Record<string, unknown>)['review_appointment_id']);
    const list = out.get(key) ?? [];
    list.push(r);
    out.set(key, list);
  }
  return out;
}
