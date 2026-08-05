import { db } from '../config/database';
import { isCurrentHealthCondition } from './healthAlerts';
import type { CareProfile } from '../types';

/**
 * A person's situation, composed once on the server from things that already
 * exist in three unconnected places: the care journey and its phase, how their
 * health is sitting right now, what needs attention, and whether their care has
 * ended. Nothing new is stored and nothing is asked of the assistant; this is
 * derived on read. It is the value the card system and the sidebar read to
 * decide what surfaces for this person, so an end-of-life journey or an unwell
 * spell can bring the right things forward and take the wrong ones away.
 */
export interface Situation {
  journey: { name: string; phase: string; phase_index: number } | null;
  /** From the date of birth, or an expected arrival's due date. Null for pets. */
  life_stage: string | null;
  acuity: 'settled' | 'watching' | 'unwell';
  attention: { urgent: number; total: number };
  /** A death has been recorded. */
  ended: boolean;
}

const SEVERE = new Set(['severe', 'critical']);
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function lifeStage(profile: CareProfile): string | null {
  if (profile.kind === 'pet') return null;
  // An expected arrival: a due date still ahead and no birth date yet.
  if (profile.due_date && !profile.date_of_birth) {
    const due = new Date(profile.due_date);
    if (!Number.isNaN(due.getTime()) && due.getTime() > Date.now()) return 'expecting';
  }
  if (!profile.date_of_birth) return null;
  const dob = new Date(profile.date_of_birth);
  if (Number.isNaN(dob.getTime())) return null;
  const years = (Date.now() - dob.getTime()) / YEAR_MS;
  if (years < 2) return 'infant';
  if (years < 13) return 'child';
  if (years < 18) return 'teenager';
  if (years < 65) return 'adult';
  return 'older adult';
}

export async function buildSituation(profile: CareProfile): Promise<Situation> {
  // The active journey and the phase it is currently in (entered, not locked).
  const jRows = (await db.raw(
    `SELECT j.name AS journey_name, p.name AS phase_name, p.sort_order AS phase_index
       FROM care_journeys j
       LEFT JOIN care_journey_phases p
         ON p.care_journey_id = j.id AND p.entered_at IS NOT NULL AND p.locked_at IS NULL
      WHERE j.care_profile_id = ? AND j.status = 'active'
      ORDER BY j.started_at ASC
      LIMIT 1`,
    [profile.id],
  )) as { rows?: Array<{ journey_name: string | null; phase_name: string | null; phase_index: number | null }> };
  const jr = jRows.rows?.[0];
  const journey = jr?.journey_name
    ? { name: jr.journey_name, phase: jr.phase_name ?? '', phase_index: Number(jr.phase_index ?? 0) }
    : null;

  // Acuity, from the passing (current) health conditions and their severity.
  const conds = await db('medical_conditions')
    .where({ care_profile_id: profile.id })
    .whereNull('resolved_on')
    .select('status', 'is_permanent', 'is_temporary', 'condition_type', 'expected_duration', 'category', 'severity');
  const current = conds.filter((c) => isCurrentHealthCondition(c));
  let acuity: Situation['acuity'] = 'settled';
  if (current.some((c) => c.severity && SEVERE.has(String(c.severity).toLowerCase()))) acuity = 'unwell';
  else if (current.length > 0) acuity = 'watching';

  // A light per-profile attention count (overdue tasks), enough to signal
  // pressure without running the whole account-wide engine on a profile load.
  const overdue = (await db('reminders')
    .where({ care_profile_id: profile.id, completed: false })
    .where('next_due_at', '<', new Date())
    .count('* as c')
    .first()) as { c?: string | number } | undefined;
  const total = Number(overdue?.c ?? 0);

  return {
    journey,
    life_stage: lifeStage(profile),
    acuity,
    attention: { urgent: total, total },
    ended: !!profile.died_on,
  };
}
