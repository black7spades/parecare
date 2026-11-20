import type { Knex } from 'knex';
import { db } from '../config/database';
import { checkLimits, type LimitCheck } from '../lib/asNeeded';
import { GIVEN_STATUSES, NOT_IN_STOCK, DOSE_STATUSES, type DoseStatus } from '../lib/doseOutcome';
import { drawDownOnHand, perDoseDrawdown } from './medicationSupply';
import { ownerZone } from './tasks';
import { COURSE_RUNNING_SQL } from '../lib/course';
import { dateInZone, parseZonedTime } from '../lib/timezone';

type Conn = Knex | Knex.Transaction;

/**
 * Recording doses. One service for every path that writes a dose: the dose
 * form, a round of taps, the medicine round across residents and Pare. It
 * checks the note rule, as-needed limits and the clock, writes the record,
 * counts the supply down, and turns "not in stock" into the out-of-stock
 * alert with who to call.
 */

export interface DoseInput {
  medication_id: string;
  scheduled_for?: string | null;
  administered_at?: string | Date | null;
  status: DoseStatus;
  dose_given?: string | null;
  route_given?: string | null;
  notes?: string | null;
  /** Why an as-needed dose was needed now. */
  reason?: string | null;
  /** Why it had to be given inside the gap or over the most in 24 hours. */
  outside_limits_reason?: string | null;
  right_dose?: boolean;
  right_route?: boolean;
  right_time?: boolean;
}

export interface DoseMed {
  id: string;
  name: string;
  form: string | null;
  dose: string | null;
  dose_amount: string | null;
  units_per_dose: unknown;
  route: string | null;
  as_needed: boolean;
  min_hours_between_doses: unknown;
  max_doses_per_day: unknown;
}

/** What a limit check found, in the shape every screen and Pare says it. */
export interface LimitProblem {
  medication_id: string;
  medication_name: string;
  at: string;
  last_given_at: string | null;
  next_from: string | null;
  min_hours_between_doses: number | null;
  max_doses_per_day: number | null;
  count_with_this: number;
  inside_gap: boolean;
  over_most: boolean;
}

export class DoseProblem extends Error {
  code: 'NOTE_REQUIRED' | 'FUTURE_TIME' | 'OUTSIDE_LIMITS' | 'UNKNOWN_MEDICATION';
  limits?: LimitProblem;
  constructor(code: DoseProblem['code'], message: string, limits?: LimitProblem) {
    super(message);
    this.code = code;
    this.limits = limits;
  }
}

const FUTURE_SKEW_MS = 60 * 1000;
export const NOTE_REQUIRED_MSG = 'Say why the dose was not given, then save it again.';

/** Outcomes that stand on their own. Refused, omitted and held need a note. */
export const noteOptional = (status: string): boolean => GIVEN_STATUSES.has(status) || status === NOT_IN_STOCK;

export const isDoseStatus = (s: string): s is DoseStatus => (DOSE_STATUSES as readonly string[]).includes(s);

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The medicines a set of doses is for, on this profile only. */
export async function doseMeds(conn: Conn, profileId: string, ids: string[]): Promise<Map<string, DoseMed>> {
  const rows = (await conn('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where('m.care_profile_id', profileId)
    .whereIn('m.id', [...new Set(ids)])
    .select('m.id', 'c.name', 'c.form', 'm.dose', 'm.dose_amount', 'm.units_per_dose', 'm.route', 'm.as_needed', 'm.min_hours_between_doses', 'm.max_doses_per_day')) as DoseMed[];
  return new Map(rows.map((r) => [r.id, r]));
}

// Only an as-needed medicine has limits: a scheduled one runs to its times.
const hasLimits = (m: DoseMed) => !!m.as_needed && (num(m.min_hours_between_doses) != null || num(m.max_doses_per_day) != null);

/**
 * Where a dose stands against its medicine's as-needed limits, counting the
 * doses already given in the day either side of it and any recorded earlier
 * in the same round.
 */
export async function limitCheckFor(
  conn: Conn,
  med: DoseMed,
  at: Date,
  alsoGiven: Date[] = []
): Promise<LimitCheck | null> {
  if (!hasLimits(med)) return null;
  const rows = (await conn('medication_administrations')
    .where({ medication_id: med.id })
    .whereIn('status', [...GIVEN_STATUSES])
    .where('administered_at', '>', new Date(at.getTime() - 24 * 3600 * 1000))
    .where('administered_at', '<', new Date(at.getTime() + 24 * 3600 * 1000))
    .pluck('administered_at')) as Array<Date | string>;
  return checkLimits(
    { min_hours_between_doses: num(med.min_hours_between_doses), max_doses_per_day: num(med.max_doses_per_day) },
    at,
    [...rows.map((d) => new Date(d)), ...alsoGiven]
  );
}

export const limitProblem = (med: DoseMed, at: Date, c: LimitCheck): LimitProblem => ({
  medication_id: med.id,
  medication_name: med.name,
  at: at.toISOString(),
  last_given_at: c.last_given_at ? c.last_given_at.toISOString() : null,
  next_from: c.next_from ? c.next_from.toISOString() : null,
  min_hours_between_doses: num(med.min_hours_between_doses),
  max_doses_per_day: num(med.max_doses_per_day),
  count_with_this: c.count_with_this,
  inside_gap: c.inside_gap,
  over_most: c.over_most,
});

/** "Endone was given at 14:05. It needs 4 hours between doses." */
export function limitSentence(p: LimitProblem, fmt: (d: Date) => string): string {
  const parts: string[] = [];
  if (p.inside_gap && p.last_given_at && p.min_hours_between_doses != null) {
    parts.push(`${p.medication_name} was given at ${fmt(new Date(p.last_given_at))}. It needs ${p.min_hours_between_doses} hours between doses.`);
  }
  if (p.over_most && p.max_doses_per_day != null) {
    parts.push(`This would be dose ${p.count_with_this} in 24 hours. The most is ${p.max_doses_per_day}.`);
  }
  return parts.join(' ');
}

export interface RecordedDose {
  id: string;
  medication_id: string;
  status: string;
  outside_limits: boolean;
}

/**
 * Check and write a set of doses for one profile. Nothing is written if any
 * of them fails a check. A dose inside the gap or over the daily most needs
 * a reason saying why it had to be given, and is marked as given outside
 * the limits.
 */
export async function recordDoses(
  conn: Conn,
  opts: {
    profileId: string;
    account: { id: string; display_name: string };
    entries: DoseInput[];
    /** A conversational log cannot confirm the dose, route or time by sight. */
    viaAssistant?: boolean;
  }
): Promise<{ doses: RecordedDose[]; meds: Map<string, DoseMed> }> {
  const meds = await doseMeds(conn, opts.profileId, opts.entries.map((e) => e.medication_id));
  const rows: Record<string, unknown>[] = [];
  const givenThisRound = new Map<string, Date[]>();
  for (const e of opts.entries) {
    const med = meds.get(e.medication_id);
    if (!med) throw new DoseProblem('UNKNOWN_MEDICATION', 'That medicine is not on this person\'s list.');
    const at = e.administered_at ? new Date(e.administered_at) : new Date();
    if (Number.isNaN(at.getTime())) throw new DoseProblem('FUTURE_TIME', 'That time could not be read. Pick the time again.');
    if (at.getTime() > Date.now() + FUTURE_SKEW_MS) throw new DoseProblem('FUTURE_TIME', 'A dose cannot be recorded in the future.');
    if (!noteOptional(e.status) && !e.notes?.trim()) throw new DoseProblem('NOTE_REQUIRED', NOTE_REQUIRED_MSG);
    let outside = false;
    if (GIVEN_STATUSES.has(e.status)) {
      const earlier = givenThisRound.get(med.id) ?? [];
      const check = await limitCheckFor(conn, med, at, earlier);
      if (check?.outside) {
        // Only a reason given for exactly this, never an unrelated note,
        // lets a dose past its limits.
        if (!e.outside_limits_reason?.trim()) {
          throw new DoseProblem('OUTSIDE_LIMITS', 'Say why it must be given now, then save it again.', limitProblem(med, at, check));
        }
        outside = true;
      }
      givenThisRound.set(med.id, [...earlier, at]);
    }
    rows.push({
      medication_id: med.id,
      care_profile_id: opts.profileId,
      scheduled_for: e.scheduled_for ? new Date(e.scheduled_for) : null,
      administered_at: at,
      administered_by_account_id: opts.account.id,
      administered_by_name: opts.account.display_name,
      status: e.status,
      dose_given: e.dose_given ?? med.dose ?? null,
      route_given: e.route_given ?? med.route ?? null,
      notes: opts.viaAssistant
        ? [e.notes?.trim(), 'Recorded through the PareCare assistant.'].filter(Boolean).join(' ')
        : e.notes?.trim() || null,
      reason: e.reason?.trim() || null,
      outside_limits: outside,
      outside_limits_reason: outside ? e.outside_limits_reason?.trim() || null : null,
      right_patient: true,
      right_medication: true,
      right_documentation: true,
      // Dose, route and time are confirmed by a person at the point of care;
      // a conversational log cannot see them.
      right_dose: opts.viaAssistant ? false : e.right_dose ?? false,
      right_route: opts.viaAssistant ? false : e.right_route ?? false,
      right_time: opts.viaAssistant ? false : e.right_time ?? true,
    });
  }

  const inserted = (await conn('medication_administrations')
    .insert(rows)
    .returning(['id', 'medication_id', 'status', 'outside_limits'])) as RecordedDose[];

  // Each given dose counts the supply down, per medicine.
  const drawdowns = new Map<string, number>();
  for (const e of opts.entries) {
    if (GIVEN_STATUSES.has(e.status)) drawdowns.set(e.medication_id, (drawdowns.get(e.medication_id) ?? 0) + 1);
  }
  for (const [medId, doses] of drawdowns) {
    const med = meds.get(medId)!;
    await drawDownOnHand(medId, doses * perDoseDrawdown(med), conn);
  }

  // There was none to give: the medicine points at this dose, so the
  // out-of-stock alert shows with who to call, even if it was set aside
  // before. The stock count is left as it was, so taking the dose back
  // takes the alert back too.
  for (const d of inserted.filter((r) => r.status === NOT_IN_STOCK)) {
    await conn('medications').where({ id: d.medication_id }).update({ not_in_stock_admin_id: d.id, updated_at: conn.fn.now() });
    await conn('attention_dismissals').where({ item_key: `out_of_stock:${d.medication_id}` }).delete();
  }
  return { doses: inserted, meds };
}

/**
 * The last dose given, how many in the last 24 hours, and the given times
 * in the last two days, for each as-needed or limited medicine. Screens use
 * it to say "Last given 14:05 by Jess Carter. 2 doses in the last 24 hours"
 * and to warn before a dose inside the gap.
 */
export async function doseHistory(
  conn: Conn,
  medIds: string[]
): Promise<Map<string, { last_given_at: string | null; last_given_by: string | null; given_24h: number; recent_given: string[] }>> {
  const out = new Map<string, { last_given_at: string | null; last_given_by: string | null; given_24h: number; recent_given: string[] }>();
  if (medIds.length === 0) return out;
  const since = new Date(Date.now() - 48 * 3600 * 1000);
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const rows = (await conn('medication_administrations')
    .whereIn('medication_id', medIds)
    .whereIn('status', [...GIVEN_STATUSES])
    .where('administered_at', '>', since)
    .orderBy('administered_at', 'desc')
    .select('medication_id', 'administered_at', 'administered_by_name')) as Array<{ medication_id: string; administered_at: Date; administered_by_name: string | null }>;
  // The last given ever, for a dose given longer ago than two days.
  const last = (await conn('medication_administrations')
    .whereIn('medication_id', medIds)
    .whereIn('status', [...GIVEN_STATUSES])
    .distinctOn('medication_id')
    .orderBy([{ column: 'medication_id' }, { column: 'administered_at', order: 'desc' }])
    .select('medication_id', 'administered_at', 'administered_by_name')) as Array<{ medication_id: string; administered_at: Date; administered_by_name: string | null }>;
  for (const id of medIds) out.set(id, { last_given_at: null, last_given_by: null, given_24h: 0, recent_given: [] });
  for (const l of last) {
    const h = out.get(l.medication_id)!;
    h.last_given_at = new Date(l.administered_at).toISOString();
    h.last_given_by = l.administered_by_name;
  }
  for (const r of rows) {
    const h = out.get(r.medication_id)!;
    const t = new Date(r.administered_at);
    h.recent_given.push(t.toISOString());
    if (t.getTime() > dayAgo && t.getTime() <= Date.now() + FUTURE_SKEW_MS) h.given_24h += 1;
  }
  return out;
}

export interface DueDose {
  profile_id: string;
  medication_id: string;
  medication_name: string;
  dose: string | null;
  route: string | null;
  instructions: string | null;
  with_food: boolean;
  critical: boolean;
  /** The time it is due, HH:MM where they are. */
  time: string;
  /** The same moment as an instant, to record the dose against. */
  scheduled_for: string;
  /** Already past its time. */
  late: boolean;
}

const DUE_WINDOW_MS = 2 * 3600 * 1000;

/**
 * Doses due from two hours ago to two hours ahead that nobody has recorded
 * yet, across one or more people. A dose recorded against its time covers
 * it whatever the outcome; a given dose with no time covers the earliest
 * time still open that day. The same rule as the medication record.
 */
export async function dosesDue(
  conn: Conn,
  profileIds: string[],
  opts: { now?: Date; timeZone?: string | null } = {}
): Promise<DueDose[]> {
  if (profileIds.length === 0) return [];
  const now = opts.now ?? new Date();
  const meds = (await conn('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .whereIn('m.care_profile_id', profileIds)
    .where('m.active', true)
    .where('m.as_needed', false)
    .whereRaw(COURSE_RUNNING_SQL)
    .select('m.id', 'm.care_profile_id', 'c.name', 'm.dose', 'm.route', 'm.instructions', 'm.with_food', 'm.critical', 'm.schedule_times')
    .orderBy('c.name', 'asc')) as Array<{
    id: string;
    care_profile_id: string;
    name: string;
    dose: string | null;
    route: string | null;
    instructions: string | null;
    with_food: boolean;
    critical: boolean;
    schedule_times: unknown;
  }>;
  const scheduled = meds.filter((m) => Array.isArray(m.schedule_times) && (m.schedule_times as unknown[]).length > 0);
  if (scheduled.length === 0) return [];
  const admins = (await conn('medication_administrations')
    .whereIn('medication_id', scheduled.map((m) => m.id))
    .where((w) =>
      w.where('administered_at', '>', new Date(now.getTime() - 36 * 3600 * 1000)).orWhere('scheduled_for', '>', new Date(now.getTime() - 36 * 3600 * 1000))
    )
    .select('id', 'medication_id', 'scheduled_for', 'administered_at', 'status')) as Array<{
    id: string;
    medication_id: string;
    scheduled_for: Date | null;
    administered_at: Date;
    status: string;
  }>;
  const zones = new Map<string, string | null>();
  for (const pid of [...new Set(scheduled.map((m) => m.care_profile_id))]) {
    zones.set(pid, await ownerZone(conn, pid, opts.timeZone ?? null));
  }
  const out: DueDose[] = [];
  for (const m of scheduled) {
    const zone = zones.get(m.care_profile_id) ?? null;
    const times = [...new Set((m.schedule_times as string[]).filter((t) => /^\d{2}:\d{2}$/.test(t)))].sort();
    const mine = admins.filter((a) => a.medication_id === m.id);
    for (const offset of [-1, 0, 1]) {
      const day = dateInZone(new Date(now.getTime() + offset * 24 * 3600 * 1000), zone);
      const slots = times
        .map((t) => ({ t, at: parseZonedTime(`${day}T${t}:00`, zone) }))
        .filter((s): s is { t: string; at: Date } => !!s.at);
      const used = new Set<string>();
      const covered = new Set<string>();
      for (const s of slots) {
        const exact = mine.find((a) => !used.has(a.id) && a.scheduled_for && new Date(a.scheduled_for).getTime() === s.at.getTime());
        if (exact) {
          used.add(exact.id);
          covered.add(s.t);
        }
      }
      // Given doses that day with no time of their own fill the earliest
      // open times already passed.
      const loose = mine.filter(
        (a) => !used.has(a.id) && GIVEN_STATUSES.has(a.status) && dateInZone(new Date(a.scheduled_for ?? a.administered_at), zone) === day
      );
      let li = 0;
      for (const s of slots) {
        if (!covered.has(s.t) && s.at.getTime() <= now.getTime() && li < loose.length) {
          covered.add(s.t);
          li += 1;
        }
      }
      for (const s of slots) {
        if (covered.has(s.t)) continue;
        if (Math.abs(s.at.getTime() - now.getTime()) > DUE_WINDOW_MS) continue;
        out.push({
          profile_id: m.care_profile_id,
          medication_id: m.id,
          medication_name: m.name,
          dose: m.dose,
          route: m.route,
          instructions: m.instructions,
          with_food: !!m.with_food,
          critical: !!m.critical,
          time: s.t,
          scheduled_for: s.at.toISOString(),
          late: s.at.getTime() <= now.getTime(),
        });
      }
    }
  }
  return out.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for) || a.medication_name.localeCompare(b.medication_name));
}
