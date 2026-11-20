import type { Knex } from 'knex';
import { dateInZone } from '../lib/timezone';
import { ownerZone } from './tasks';

type Conn = Knex | Knex.Transaction;

/**
 * A medicine's history: every start, change of dose or times, stop and
 * restart, kept with why it changed and where the change came from (a visit
 * or a letter). The change and the medicine are written together, so the
 * list never says one thing and the history another. The medicine form,
 * the stop and restart buttons and Pare all come through here.
 */

export const CHANGE_KINDS = ['started', 'dose', 'times', 'stopped', 'restarted', 'other'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const STOP_REASONS = ['finished', 'side_effects', 'not_working', 'changed', 'doctor_stopped', 'no_longer_needed', 'other'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** Each stop reason in plain words. */
export const STOP_REASON_LABELS: Record<StopReason, string> = {
  finished: 'Course finished',
  side_effects: 'Side effects',
  not_working: 'Not working',
  changed: 'Changed to another medicine',
  doctor_stopped: 'Doctor stopped it',
  no_longer_needed: 'No longer needed',
  other: 'Other',
};

/** A stop reason from plain words or its code, for Pare. */
export function stopReasonFrom(text: string | null | undefined): StopReason | null {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  if ((STOP_REASONS as readonly string[]).includes(t)) return t as StopReason;
  const hit = (Object.entries(STOP_REASON_LABELS) as Array<[StopReason, string]>).find(([, label]) => label.toLowerCase() === t);
  if (hit) return hit[0];
  if (/side.?effect|reaction|made (her|him|them|me) sick/.test(t)) return 'side_effects';
  if (/finish|course (is )?(done|over|complete)|completed/.test(t)) return 'finished';
  if (/not working|didn.?t work|no effect/.test(t)) return 'not_working';
  if (/switch|changed to|replace/.test(t)) return 'changed';
  if (/doctor|gp|specialist|hospital|discharge/.test(t)) return 'doctor_stopped';
  if (/no longer need|not needed/.test(t)) return 'no_longer_needed';
  return 'other';
}

interface MedState {
  id: string;
  care_profile_id: string;
  dose_amount: string | null;
  dose_unit: string | null;
  schedule_times: unknown;
}

const timesOf = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? (() => { try { return JSON.parse(v) as string[]; } catch { return []; } })() : []);
const sameTimes = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((t, i) => t === [...b].sort()[i]);

export interface ChangeSource {
  reason?: string | null;
  source_appointment_id?: string | null;
  source_document_id?: string | null;
  changed_on?: string | null;
}

/** Today where they live, as YYYY-MM-DD. */
export async function todayFor(conn: Conn, profileId: string): Promise<string> {
  return dateInZone(new Date(), await ownerZone(conn, profileId));
}

/** Whether the source named belongs to this person; anything else is dropped rather than linked. */
async function cleanSource(conn: Conn, profileId: string, s: ChangeSource): Promise<{ appt: string | null; doc: string | null }> {
  const appt = s.source_appointment_id
    ? ((await conn('appointments').where({ id: s.source_appointment_id, care_profile_id: profileId }).first('id')) as { id: string } | undefined)?.id ?? null
    : null;
  const doc = s.source_document_id
    ? ((await conn('documents').where({ id: s.source_document_id, care_profile_id: profileId }).first('id')) as { id: string } | undefined)?.id ?? null
    : null;
  return { appt, doc };
}

/**
 * Write a change to a medicine and its history row together. `patch` is the
 * medicine's new columns; the history works out the before and after from
 * what is there now. Nothing is written when nothing worth keeping changed,
 * except a stop, start or restart, which is always kept.
 */
export async function recordMedicationChange(
  conn: Conn,
  opts: {
    medicationId: string;
    profileId: string;
    actorId: string | null;
    kind?: ChangeKind;
    patch?: Record<string, unknown>;
    source?: ChangeSource;
  }
): Promise<{ change_id: string | null }> {
  const pick = () =>
    conn('medications').where({ id: opts.medicationId, care_profile_id: opts.profileId }).first('id', 'care_profile_id', 'dose_amount', 'dose_unit', 'schedule_times') as Promise<MedState | undefined>;
  const med = await pick();
  if (!med) return { change_id: null };
  const patch = opts.patch ?? {};
  if (Object.keys(patch).length) await conn('medications').where({ id: med.id }).update(patch);
  const now = (await pick())!;
  const doseAfter = now.dose_amount;
  const unitAfter = now.dose_unit;
  const timesBefore = timesOf(med.schedule_times);
  const timesAfter = timesOf(now.schedule_times);
  const doseMoved = (doseAfter ?? '') !== (med.dose_amount ?? '') || (unitAfter ?? '') !== (med.dose_unit ?? '');
  const timesMoved = !sameTimes(timesBefore, timesAfter);
  const kind: ChangeKind | null = opts.kind ?? (doseMoved ? 'dose' : timesMoved ? 'times' : null);
  if (!kind) return { change_id: null };

  const { appt, doc } = await cleanSource(conn, opts.profileId, opts.source ?? {});
  const tracked = kind === 'dose' || kind === 'times' || kind === 'started';
  const [row] = await conn('medication_changes')
    .insert({
      medication_id: med.id,
      care_profile_id: opts.profileId,
      changed_on: opts.source?.changed_on || (await todayFor(conn, opts.profileId)),
      change_kind: kind,
      dose_amount_before: tracked && kind !== 'started' ? med.dose_amount : null,
      dose_amount_after: tracked ? doseAfter : null,
      dose_unit_before: tracked && kind !== 'started' ? med.dose_unit : null,
      dose_unit_after: tracked ? unitAfter : null,
      schedule_times_before: tracked && kind !== 'started' ? JSON.stringify(timesBefore) : null,
      schedule_times_after: tracked ? JSON.stringify(timesAfter) : null,
      reason: opts.source?.reason?.trim() || null,
      source_appointment_id: appt,
      source_document_id: doc,
      changed_by_account_id: opts.actorId,
    })
    .returning('id');
  return { change_id: (row as { id: string }).id };
}

/** Stop a medicine: off the active list, with the last day, why, and the history row. */
export async function stopMedication(
  conn: Conn,
  opts: { medicationId: string; profileId: string; actorId: string | null; stopped_on?: string | null; stop_reason?: StopReason | null; stop_notes?: string | null; source?: ChangeSource }
): Promise<{ change_id: string | null }> {
  const day = opts.stopped_on || (await todayFor(conn, opts.profileId));
  const reason = opts.stop_reason ?? null;
  const words = [reason ? STOP_REASON_LABELS[reason] : null, opts.stop_notes?.trim() || null].filter(Boolean).join('. ');
  return recordMedicationChange(conn, {
    medicationId: opts.medicationId,
    profileId: opts.profileId,
    actorId: opts.actorId,
    kind: 'stopped',
    patch: { active: false, stopped_on: day, stop_reason: reason, stop_notes: opts.stop_notes?.trim() || null, updated_at: conn.fn.now() },
    source: { ...opts.source, changed_on: day, reason: opts.source?.reason?.trim() || words || null },
  });
}

/**
 * Put a stopped medicine back on the list. Undoing a stop just made takes
 * the stop back out of the history, as if it never happened.
 */
export async function restartMedication(
  conn: Conn,
  opts: { medicationId: string; profileId: string; actorId: string | null; undoChangeId?: string | null }
): Promise<boolean> {
  const med = await conn('medications').where({ id: opts.medicationId, care_profile_id: opts.profileId }).first('id');
  if (!med) return false;
  const restore: Record<string, unknown> = { active: true, stopped_on: null, stop_reason: null, stop_notes: null, updated_at: conn.fn.now() };
  // A course that ended before it is started again ends no longer: a new last day is set if there is one.
  const course = (await conn('medications').where({ id: opts.medicationId }).first('course_ends_on')) as { course_ends_on: string | null } | undefined;
  if (course?.course_ends_on && course.course_ends_on < (await todayFor(conn, opts.profileId))) restore['course_ends_on'] = null;
  if (opts.undoChangeId) {
    const last = (await conn('medication_changes')
      .where({ medication_id: opts.medicationId })
      .orderBy('created_at', 'desc')
      .first('id', 'change_kind')) as { id: string; change_kind: string } | undefined;
    if (last && last.id === opts.undoChangeId && last.change_kind === 'stopped') {
      await conn('medication_changes').where({ id: last.id }).delete();
      await conn('medications').where({ id: opts.medicationId }).update(restore);
      return true;
    }
  }
  await recordMedicationChange(conn, { medicationId: opts.medicationId, profileId: opts.profileId, actorId: opts.actorId, kind: 'restarted', patch: restore });
  return true;
}

/** Every change on these medicines, newest first, with where each came from named. */
export async function changesFor(conn: Conn, profileId: string): Promise<Map<string, Array<Record<string, unknown>>>> {
  const rows = (await conn('medication_changes as ch')
    .leftJoin('appointments as a', 'a.id', 'ch.source_appointment_id')
    .leftJoin('documents as d', 'd.id', 'ch.source_document_id')
    .leftJoin('accounts as acc', 'acc.id', 'ch.changed_by_account_id')
    .where('ch.care_profile_id', profileId)
    .orderBy([{ column: 'ch.changed_on', order: 'desc' }, { column: 'ch.created_at', order: 'desc' }])
    .select(
      'ch.id', 'ch.medication_id', 'ch.changed_on', 'ch.change_kind', 'ch.dose_amount_before', 'ch.dose_amount_after',
      'ch.dose_unit_before', 'ch.dose_unit_after', 'ch.schedule_times_before', 'ch.schedule_times_after', 'ch.reason',
      'ch.source_appointment_id', 'a.title as source_appointment_title', 'a.starts_at as source_appointment_starts_at',
      'ch.source_document_id', 'd.label as source_document_label', 'acc.display_name as changed_by_name', 'ch.created_at'
    )) as Array<Record<string, unknown> & { medication_id: string }>;
  const out = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) {
    const list = out.get(r.medication_id) ?? [];
    list.push(r);
    out.set(r.medication_id, list);
  }
  return out;
}
