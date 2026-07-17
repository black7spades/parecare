import { db } from '../config/database';

/**
 * Health alerts: the "this has gone on long enough, talk to the GP" nudges.
 *
 * Two situations raise one:
 *
 * 1. A current illness or injury has had symptoms above moderate severity
 *    for more than two days straight (a cold that keeps getting worse).
 * 2. An injury is still unresolved a couple of months after it happened
 *    (a sprained ankle that still hurts five months on).
 *
 * Alerts are computed from the condition and symptom records; nothing is
 * stored. Dismissals reuse the attention_dismissals table via each alert's
 * stable key.
 */

/** Above moderate on the 1 to 5 symptom scale (3 is moderate). */
const HIGH_SEVERITY = 4;
/** How long symptoms must stay above moderate before an alert is raised. */
const PERSISTENT_DAYS = 2;
/** How long an injury may stay unresolved before an alert is raised. */
const INJURY_STALE_DAYS = 60;

/** Condition categories that describe a passing health event, not a permanent condition. */
const TEMPORARY_CATEGORIES = new Set(['illness', 'injury', 'post_operative', 'recovery', 'chronic_flare', 'acute_illness']);

interface ConditionRow {
  id: string;
  care_profile_id: string;
  name: string;
  status: string | null;
  started_on: Date | string | null;
  resolved_on: Date | string | null;
  is_temporary: boolean | null;
  is_permanent: boolean | null;
  condition_type: string | null;
  expected_duration: string | null;
  category: string | null;
  created_at: Date | string;
}

export interface HealthAlertSymptom {
  id: string;
  name: string;
  severity: number;
}

export interface HealthAlertGp {
  id: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  booking_link: string | null;
}

export interface HealthAlert {
  /** Stable identifier, also used for dismissal. */
  key: string;
  profile_id: string;
  profile_name: string;
  kind: 'persistent_symptoms' | 'unresolved_injury';
  condition_id: string;
  condition_name: string;
  condition_category: string | null;
  /** When the situation began: symptoms went above moderate, or the injury happened. */
  since: string;
  /** Whole days since then. */
  days: number;
  /** The condition's unresolved symptoms with their current severity. */
  symptoms: HealthAlertSymptom[];
  /** The profile's GP, when one is linked. */
  gp: HealthAlertGp | null;
}

/**
 * A condition that belongs in Current Health: something the person is
 * going through right now, not a permanent or long-term condition.
 * Exported so the alert rules and any callers classify the same way.
 */
export function isCurrentHealthCondition(c: {
  status?: string | null;
  resolved_on?: Date | string | null;
  is_permanent?: boolean | null;
  is_temporary?: boolean | null;
  condition_type?: string | null;
  expected_duration?: string | null;
  category?: string | null;
}): boolean {
  if (c.status === 'resolved' || c.resolved_on) return false;
  if (c.is_permanent) return false;
  if (c.category === 'neurotype' || c.category === 'disability') return false;
  if (c.category && TEMPORARY_CATEGORIES.has(c.category)) return true;
  if (c.is_temporary) return true;
  if (c.condition_type === 'acute') return true;
  if (c.expected_duration === 'self_limiting' || c.expected_duration === 'short_term') return true;
  return false;
}

const dayMs = 24 * 60 * 60 * 1000;

const toIso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/**
 * Compute the health alerts for a set of profiles. Dismissed keys are
 * filtered by the caller, which knows whose dismissals apply.
 */
export async function gatherHealthAlerts(
  profiles: Array<{ id: string; name: string }>
): Promise<HealthAlert[]> {
  if (profiles.length === 0) return [];
  const profileIds = profiles.map((p) => p.id);
  const nameByProfile = new Map(profiles.map((p) => [p.id, p.name]));

  const conditions = (
    await db<ConditionRow>('medical_conditions')
      .whereIn('care_profile_id', profileIds)
      .whereNull('resolved_on')
      .where((qb) => qb.whereNull('status').orWhereNot('status', 'resolved'))
  ).filter(isCurrentHealthCondition);
  if (conditions.length === 0) return [];
  const conditionIds = conditions.map((c) => c.id);

  // Every unresolved symptom of those conditions, plus the reading history
  // of the ones currently above moderate (to see how long they have been).
  const symptoms: Array<{ id: string; condition_id: string; name: string; severity: number; noted_at: Date | string }> =
    await db('condition_symptoms')
      .whereIn('condition_id', conditionIds)
      .whereNull('resolved_at')
      .select('id', 'condition_id', 'name', 'severity', 'noted_at');
  const highSymptomIds = symptoms.filter((s) => s.severity >= HIGH_SEVERITY).map((s) => s.id);
  const readings: Array<{ symptom_id: string; severity: number; recorded_at: Date | string }> = highSymptomIds.length
    ? await db('condition_symptom_readings')
        .whereIn('symptom_id', highSymptomIds)
        .orderBy('recorded_at', 'asc')
        .select('symptom_id', 'severity', 'recorded_at')
    : [];
  const readingsBySymptom = new Map<string, Array<{ severity: number; recorded_at: Date | string }>>();
  for (const r of readings) {
    const arr = readingsBySymptom.get(r.symptom_id) ?? [];
    arr.push(r);
    readingsBySymptom.set(r.symptom_id, arr);
  }

  // When did each high symptom last go above moderate? The start of the
  // trailing run of readings at or above HIGH_SEVERITY.
  const highSince = new Map<string, number>();
  for (const s of symptoms) {
    if (s.severity < HIGH_SEVERITY) continue;
    const course = readingsBySymptom.get(s.id) ?? [];
    let runStart: number | null = null;
    for (const r of course) {
      if (r.severity >= HIGH_SEVERITY) {
        if (runStart === null) runStart = new Date(r.recorded_at).getTime();
      } else {
        runStart = null;
      }
    }
    highSince.set(s.id, runStart ?? new Date(s.noted_at).getTime());
  }

  // The GP linked to each profile, for the "contact their GP" suggestion.
  const gpRows: Array<{
    care_profile_id: string;
    id: string;
    name: string;
    organisation: string | null;
    phone: string | null;
    booking_link: string | null;
  }> = await db('care_profile_providers as cpp')
    .join('providers as p', 'cpp.provider_id', 'p.id')
    .whereIn('cpp.care_profile_id', profileIds)
    .where('p.provider_type', 'gp')
    .orderBy('p.name', 'asc')
    .select('cpp.care_profile_id', 'p.id', 'p.name', 'p.organisation', 'p.phone', 'p.booking_link');
  const gpByProfile = new Map<string, HealthAlertGp>();
  for (const g of gpRows) {
    if (!gpByProfile.has(g.care_profile_id)) {
      gpByProfile.set(g.care_profile_id, {
        id: g.id,
        name: g.name,
        organisation: g.organisation,
        phone: g.phone,
        booking_link: g.booking_link,
      });
    }
  }

  const symptomsByCondition = new Map<string, typeof symptoms>();
  for (const s of symptoms) {
    const arr = symptomsByCondition.get(s.condition_id) ?? [];
    arr.push(s);
    symptomsByCondition.set(s.condition_id, arr);
  }

  const now = Date.now();
  const alerts: HealthAlert[] = [];
  for (const c of conditions) {
    const profileName = nameByProfile.get(c.care_profile_id) ?? '';
    const gp = gpByProfile.get(c.care_profile_id) ?? null;
    const conditionSymptoms = symptomsByCondition.get(c.id) ?? [];
    const currentSymptoms: HealthAlertSymptom[] = conditionSymptoms.map((s) => ({
      id: s.id,
      name: s.name,
      severity: s.severity,
    }));

    // 1. Symptoms above moderate for PERSISTENT_DAYS or longer.
    const persistent = conditionSymptoms.filter((s) => {
      const since = highSince.get(s.id);
      return since !== undefined && now - since >= PERSISTENT_DAYS * dayMs;
    });
    if (persistent.length > 0) {
      const since = Math.min(...persistent.map((s) => highSince.get(s.id)!));
      alerts.push({
        key: `health_alert:persistent_symptoms:${c.id}:${new Date(since).toISOString().slice(0, 10)}`,
        profile_id: c.care_profile_id,
        profile_name: profileName,
        kind: 'persistent_symptoms',
        condition_id: c.id,
        condition_name: c.name,
        condition_category: c.category,
        since: new Date(since).toISOString(),
        days: Math.floor((now - since) / dayMs),
        symptoms: persistent.map((s) => ({ id: s.id, name: s.name, severity: s.severity })),
        gp,
      });
    }

    // 2. An injury still unresolved months after it happened.
    if (c.category === 'injury') {
      const startedAt = c.started_on ? new Date(c.started_on).getTime() : new Date(c.created_at).getTime();
      if (now - startedAt >= INJURY_STALE_DAYS * dayMs) {
        alerts.push({
          key: `health_alert:unresolved_injury:${c.id}`,
          profile_id: c.care_profile_id,
          profile_name: profileName,
          kind: 'unresolved_injury',
          condition_id: c.id,
          condition_name: c.name,
          condition_category: c.category,
          since: toIso(c.started_on ?? c.created_at),
          days: Math.floor((now - startedAt) / dayMs),
          symptoms: currentSymptoms,
          gp,
        });
      }
    }
  }
  return alerts;
}
