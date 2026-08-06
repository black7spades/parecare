import { db } from '../config/database';
import { dateInZone, hmInZone, startOfDayInZone } from '../lib/timezone';
import { perDoseDrawdown } from './medicationSupply';

/**
 * Watches: the alerts a person sets up for themselves, evaluated against the
 * record. The bell and the What's new screen show everything as it happens;
 * a watch is the other direction, one specific thing pushed to a destination
 * on the person's own terms.
 *
 * This module is the catalogue of what can be watched and the code that
 * decides, right now, whether each watch has anything to say. Delivery (which
 * channel, immediate or digest) lives in watchNotifier; keeping the two apart
 * means a new metric is one entry here and nothing else.
 */

export type WatchCadence = 'immediate' | 'daily' | 'weekly' | 'fortnightly' | 'monthly';

export interface WatchRow {
  id: string;
  account_id: string;
  metric: string;
  care_profile_id: string | null;
  medication_id: string | null;
  threshold_days: number | null;
  critical_only: boolean;
  channel_id: string | null;
  cadence: WatchCadence;
  label: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  last_sent_at: string | Date | null;
}

/** One thing a watch found worth saying: a plain sentence and where it lives. */
export interface WatchHit {
  key: string;
  text: string;
  url: string;
  urgent: boolean;
  /** An optional second action, such as a reorder link. */
  action_label?: string;
  action_url?: string;
  occurred_at: string;
}

/**
 * What the settings screen offers. Each metric declares which options apply to
 * it, so the form shows a medication picker, a horizon or a dangerous-only
 * switch only where they mean something.
 */
export interface MetricMeta {
  metric: string;
  label: string;
  description: string;
  category: 'medications' | 'appointments' | 'tasks' | 'care' | 'activity';
  /** Show a medication picker (within the chosen person). */
  uses_medication: boolean;
  /** Show a "within this many days" number. */
  uses_threshold_days: boolean;
  threshold_label: string | null;
  threshold_default: number | null;
  /** Show a "only the dangerous ones" switch. */
  uses_critical_only: boolean;
  critical_label: string | null;
  /** Only meaningful bundled into a digest (a periodic summary). */
  digest_only: boolean;
  /** Needs one person chosen; "anyone" makes no sense. */
  requires_profile: boolean;
}

export const WATCH_METRICS: MetricMeta[] = [
  {
    metric: 'medication_supply',
    label: 'Medication running low',
    description: 'When a medication is projected to run out within a set number of days, with a reorder link where there is one.',
    category: 'medications',
    uses_medication: true,
    uses_threshold_days: true,
    threshold_label: 'Tell me when it has this many days left',
    threshold_default: 7,
    uses_critical_only: true,
    critical_label: 'Only medications marked dangerous to miss',
    digest_only: false,
    requires_profile: false,
  },
  {
    metric: 'dose_overdue',
    label: 'Dose not recorded',
    description: 'When a scheduled dose time has passed today with no dose recorded.',
    category: 'medications',
    uses_medication: true,
    uses_threshold_days: false,
    threshold_label: null,
    threshold_default: null,
    uses_critical_only: true,
    critical_label: 'Only medications marked dangerous to miss',
    digest_only: false,
    requires_profile: false,
  },
  {
    metric: 'appointment_upcoming',
    label: 'Upcoming appointment',
    description: 'When an appointment is coming up within a set number of days.',
    category: 'appointments',
    uses_medication: false,
    uses_threshold_days: true,
    threshold_label: 'Appointments within this many days',
    threshold_default: 14,
    uses_critical_only: false,
    critical_label: null,
    digest_only: false,
    requires_profile: false,
  },
  {
    metric: 'task_due',
    label: 'Task due',
    description: 'When a task is due within a set number of days.',
    category: 'tasks',
    uses_medication: false,
    uses_threshold_days: true,
    threshold_label: 'Tasks due within this many days',
    threshold_default: 3,
    uses_critical_only: false,
    critical_label: null,
    digest_only: false,
    requires_profile: false,
  },
  {
    metric: 'mar_report',
    label: 'Medication record',
    description: 'A summary of the doses recorded in the period, with a link to the full medication record.',
    category: 'medications',
    uses_medication: false,
    uses_threshold_days: false,
    threshold_label: null,
    threshold_default: null,
    uses_critical_only: false,
    critical_label: null,
    digest_only: true,
    requires_profile: true,
  },
  {
    metric: 'care_plan',
    label: 'Care plan ready',
    description: 'When a care plan has finished generating and is ready to review.',
    category: 'care',
    uses_medication: false,
    uses_threshold_days: false,
    threshold_label: null,
    threshold_default: null,
    uses_critical_only: false,
    critical_label: null,
    digest_only: false,
    requires_profile: false,
  },
  {
    metric: 'care_activity',
    label: 'Any care circle activity',
    description: 'Anything someone else adds or changes: care log entries, records, documents and the rest.',
    category: 'activity',
    uses_medication: false,
    uses_threshold_days: false,
    threshold_label: null,
    threshold_default: null,
    uses_critical_only: false,
    critical_label: null,
    digest_only: false,
    requires_profile: false,
  },
  {
    metric: 'new_message',
    label: 'New message',
    description: 'When someone posts a message on a profile you can see.',
    category: 'activity',
    uses_medication: false,
    uses_threshold_days: false,
    threshold_label: null,
    threshold_default: null,
    uses_critical_only: false,
    critical_label: null,
    digest_only: false,
    requires_profile: false,
  },
  {
    metric: 'document_added',
    label: 'New document',
    description: 'When a document is added.',
    category: 'activity',
    uses_medication: false,
    uses_threshold_days: false,
    threshold_label: null,
    threshold_default: null,
    uses_critical_only: false,
    critical_label: null,
    digest_only: false,
    requires_profile: false,
  },
  {
    metric: 'health_change',
    label: 'Health change',
    description: 'When a condition or allergy is added or changed.',
    category: 'activity',
    uses_medication: false,
    uses_threshold_days: false,
    threshold_label: null,
    threshold_default: null,
    uses_critical_only: false,
    critical_label: null,
    digest_only: false,
    requires_profile: false,
  },
];

const METRIC_BY_KEY = new Map(WATCH_METRICS.map((m) => [m.metric, m]));
export const isKnownMetric = (metric: string): boolean => METRIC_BY_KEY.has(metric);
export const metricMeta = (metric: string): MetricMeta | undefined => METRIC_BY_KEY.get(metric);

export interface AccessibleProfile {
  id: string;
  name: string;
}

/** Every profile this account can see, owned or shared, by name. */
export async function accessibleProfiles(accountId: string): Promise<AccessibleProfile[]> {
  const [owned, shared] = await Promise.all([
    db('care_profiles').where({ account_id: accountId, archived: false }).select('id', 'full_name', 'preferred_name'),
    db('care_profiles')
      .join('care_circle_members', 'care_profiles.id', 'care_circle_members.care_profile_id')
      .where({
        'care_circle_members.account_id': accountId,
        'care_circle_members.invite_accepted': true,
        'care_profiles.archived': false,
      })
      .whereNot('care_profiles.account_id', accountId)
      .select('care_profiles.id', 'care_profiles.full_name', 'care_profiles.preferred_name'),
  ]);
  return [...owned, ...shared].map((p) => ({ id: p.id as string, name: (p.preferred_name ?? p.full_name) as string }));
}

/** A plain name for a watch, for the settings list and the digest section head. */
export function watchLabel(watch: Pick<WatchRow, 'metric' | 'label'>, profileName: string | null, medicationName?: string | null): string {
  if (watch.label && watch.label.trim()) return watch.label.trim();
  const meta = METRIC_BY_KEY.get(watch.metric);
  const base = meta?.label ?? 'Alert';
  const who = medicationName ? `${medicationName}` : profileName ?? 'anyone in your care';
  return `${base} · ${who}`;
}

interface EvalContext {
  timezone: string | null;
  /** Profiles in scope for this watch (already narrowed to the watch's person). */
  profiles: AccessibleProfile[];
  now: Date;
  /** For activity-style metrics, only what is newer than this counts. */
  since: Date;
}

const ENTITY_PAGE: Record<string, string> = {
  messages: 'messages',
  documents: 'documents',
  conditions: '',
  allergies: 'plan',
  log: '',
  circle: 'circle',
  providers: 'providers',
  reminders: 'tasks',
  medications: 'medications',
  calendar: 'calendar',
};

const VERBS: Record<string, string> = { created: 'added', updated: 'updated', deleted: 'removed' };
const NOUNS: Record<string, string> = {
  messages: 'a message',
  documents: 'a document',
  conditions: 'a condition',
  allergies: 'an allergy',
  log: 'a care log entry',
  circle: 'a care circle member',
  providers: 'a provider',
  reminders: 'a task',
  medications: 'a treatment',
  calendar: 'a calendar event',
};

/** The one query that backs every activity-style metric, filtered by entity. */
async function auditHits(
  watch: WatchRow,
  ctx: EvalContext,
  entityTypes: string[] | null
): Promise<WatchHit[]> {
  const profileIds = ctx.profiles.map((p) => p.id);
  if (profileIds.length === 0) return [];
  const nameById = new Map(ctx.profiles.map((p) => [p.id, p.name]));
  const q = db('audit_log')
    .leftJoin('accounts', 'audit_log.actor_account_id', 'accounts.id')
    .whereIn('audit_log.care_profile_id', profileIds)
    .where('audit_log.created_at', '>=', ctx.since)
    .where((qb) => qb.whereNull('audit_log.actor_account_id').orWhereNot('audit_log.actor_account_id', watch.account_id))
    .whereNot('audit_log.entity_type', 'ai')
    .orderBy('audit_log.created_at', 'desc')
    .limit(50)
    .select(
      'audit_log.id',
      'audit_log.care_profile_id',
      'audit_log.action',
      'audit_log.entity_type',
      'audit_log.summary',
      'audit_log.created_at',
      'accounts.display_name as actor_name'
    );
  if (entityTypes) q.whereIn('audit_log.entity_type', entityTypes);
  const rows = await q;
  return rows.map((r) => {
    const who = (r.actor_name as string) ?? 'Someone';
    const name = nameById.get(r.care_profile_id) ?? 'someone';
    const page = ENTITY_PAGE[r.entity_type ?? ''] ?? '';
    let text: string;
    if (r.entity_type === 'messages' && r.action === 'created') {
      text = `${who} posted in ${name}'s messages.`;
    } else {
      const noun = NOUNS[r.entity_type ?? ''] ?? 'a record';
      const verb = VERBS[r.action ?? ''] ?? 'changed';
      text = `${who} ${verb} ${noun} for ${name}${r.summary ? `: ${r.summary}` : ''}.`;
    }
    return {
      key: `watch:${watch.id}:audit:${r.id}`,
      text,
      url: `/app/${r.care_profile_id}${page ? `/${page}` : ''}`,
      urgent: false,
      occurred_at: new Date(r.created_at).toISOString(),
    };
  });
}

async function supplyHits(watch: WatchRow, ctx: EvalContext): Promise<WatchHit[]> {
  const profileIds = ctx.profiles.map((p) => p.id);
  if (profileIds.length === 0) return [];
  const nameById = new Map(ctx.profiles.map((p) => [p.id, p.name]));
  const withinDays = watch.threshold_days ?? 7;
  const q = db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .whereIn('m.care_profile_id', profileIds)
    .where('m.active', true)
    .whereNotNull('m.supply_remaining')
    .select(
      'm.id', 'm.care_profile_id', 'm.supply', 'm.supply_remaining', 'm.packs_on_hand',
      'm.schedule_times', 'm.units_per_dose', 'm.dose_amount', 'm.form', 'm.critical',
      'm.supplier', 'm.supplier_order_url', 'c.name'
    );
  if (watch.medication_id) q.where('m.id', watch.medication_id);
  if (watch.critical_only) q.where('m.critical', true);
  const rows = await q;

  const hits: WatchHit[] = [];
  for (const m of rows) {
    const packUnits = m.packs_on_hand != null && m.supply != null ? Number(m.packs_on_hand) * Number(m.supply) : 0;
    const remaining = Number(m.supply_remaining) + packUnits;
    const times = Array.isArray(m.schedule_times) ? (m.schedule_times as string[]) : [];
    const perDose = perDoseDrawdown({ form: m.form, units_per_dose: m.units_per_dose, dose_amount: m.dose_amount });
    const perDay = times.length * perDose;
    const out = remaining <= 0;
    const daysLeft = perDay > 0 ? remaining / perDay : null;
    // Fire when out, when the projected days left is within the horizon, or —
    // when the run rate is unknown — when five or fewer doses remain.
    const fires = out || (daysLeft !== null ? daysLeft <= withinDays : remaining <= 5);
    if (!fires) continue;
    const name = nameById.get(m.care_profile_id) ?? 'someone';
    const bucket = out ? 'out' : daysLeft !== null ? String(Math.ceil(daysLeft)) : String(Math.ceil(remaining));
    const shownDays = daysLeft !== null ? Math.max(1, Math.round(daysLeft)) : 0;
    const text = out
      ? `${name}'s ${m.name} is out of stock.`
      : daysLeft !== null
        ? `${name}'s ${m.name} has about ${shownDays} ${shownDays === 1 ? 'day' : 'days'} left.`
        : `${name}'s ${m.name} is running low.`;
    hits.push({
      key: `watch:${watch.id}:supply:${m.id}:${bucket}`,
      text,
      url: `/app/${m.care_profile_id}/medications`,
      urgent: out && !!m.critical,
      ...(m.supplier_order_url ? { action_label: `Reorder${m.supplier ? ` from ${m.supplier}` : ''}`, action_url: String(m.supplier_order_url) } : {}),
      occurred_at: ctx.now.toISOString(),
    });
  }
  return hits;
}

async function doseOverdueHits(watch: WatchRow, ctx: EvalContext): Promise<WatchHit[]> {
  const profileIds = ctx.profiles.map((p) => p.id);
  if (profileIds.length === 0) return [];
  const nameById = new Map(ctx.profiles.map((p) => [p.id, p.name]));
  const startOfDay = startOfDayInZone(ctx.now, ctx.timezone);
  const nowHm = hmInZone(ctx.now, ctx.timezone);
  const today = dateInZone(ctx.now, ctx.timezone);

  const medQ = db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .whereIn('m.care_profile_id', profileIds)
    .where('m.active', true)
    .select('m.id', 'm.care_profile_id', 'm.schedule_times', 'm.critical', 'c.name');
  if (watch.medication_id) medQ.where('m.id', watch.medication_id);
  if (watch.critical_only) medQ.where('m.critical', true);
  const meds = await medQ;
  if (meds.length === 0) return [];

  const adminRows = await db('medication_administrations')
    .whereIn('medication_id', meds.map((m) => m.id))
    .where('administered_at', '>=', startOfDay)
    .groupBy('medication_id')
    .select('medication_id')
    .count('id as count');
  const counts = new Map(adminRows.map((r) => [String(r.medication_id), Number(r.count)]));

  const hits: WatchHit[] = [];
  for (const m of meds) {
    const times = Array.isArray(m.schedule_times) ? (m.schedule_times as string[]) : [];
    const passed = times.filter((t) => typeof t === 'string' && t <= nowHm);
    const recorded = counts.get(String(m.id)) ?? 0;
    if (passed.length === 0 || recorded >= passed.length) continue;
    const missed = passed.length - recorded;
    const name = nameById.get(m.care_profile_id) ?? 'someone';
    hits.push({
      key: `watch:${watch.id}:dose:${m.id}:${today}:${passed.length}`,
      text: missed === 1
        ? `${name}'s dose of ${m.name} is due and not yet recorded.`
        : `${name} has ${missed} doses of ${m.name} due and not yet recorded today.`,
      url: `/app/${m.care_profile_id}/mar`,
      urgent: !!m.critical,
      occurred_at: ctx.now.toISOString(),
    });
  }
  return hits;
}

async function appointmentHits(watch: WatchRow, ctx: EvalContext): Promise<WatchHit[]> {
  const profileIds = ctx.profiles.map((p) => p.id);
  if (profileIds.length === 0) return [];
  const nameById = new Map(ctx.profiles.map((p) => [p.id, p.name]));
  const within = watch.threshold_days ?? 14;
  const horizon = new Date(ctx.now.getTime() + within * 24 * 3600 * 1000);
  const rows = await db('appointments')
    .whereIn('care_profile_id', profileIds)
    .where('status', 'scheduled')
    .where('starts_at', '>=', ctx.now)
    .where('starts_at', '<=', horizon)
    .orderBy('starts_at', 'asc')
    .limit(50)
    .select('id', 'care_profile_id', 'title', 'starts_at', 'location');
  return rows.map((a) => {
    const name = nameById.get(a.care_profile_id) ?? 'someone';
    const when = new Date(a.starts_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return {
      key: `watch:${watch.id}:appt:${a.id}`,
      text: `${name} has an appointment on ${when}: ${a.title}${a.location ? ` at ${a.location}` : ''}.`,
      url: `/app/${a.care_profile_id}/appointments`,
      urgent: false,
      occurred_at: ctx.now.toISOString(),
    };
  });
}

async function taskHits(watch: WatchRow, ctx: EvalContext): Promise<WatchHit[]> {
  const profileIds = ctx.profiles.map((p) => p.id);
  if (profileIds.length === 0) return [];
  const nameById = new Map(ctx.profiles.map((p) => [p.id, p.name]));
  const within = watch.threshold_days ?? 3;
  const horizon = new Date(ctx.now.getTime() + within * 24 * 3600 * 1000);
  const rows = await db('reminders')
    .whereIn('care_profile_id', profileIds)
    .where('completed', false)
    .where('next_due_at', '<=', horizon)
    .orderBy('next_due_at', 'asc')
    .limit(50)
    .select('id', 'care_profile_id', 'title', 'next_due_at');
  return rows.map((r) => {
    const name = nameById.get(r.care_profile_id) ?? 'someone';
    const due = new Date(r.next_due_at);
    const when = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return {
      key: `watch:${watch.id}:task:${r.id}:${due.toISOString().slice(0, 10)}`,
      text: `Task ${due.getTime() <= ctx.now.getTime() ? 'due' : 'coming up'} for ${name}: ${r.title} (${when}).`,
      url: `/app/${r.care_profile_id}/tasks`,
      urgent: false,
      occurred_at: ctx.now.toISOString(),
    };
  });
}

async function carePlanHits(watch: WatchRow, ctx: EvalContext): Promise<WatchHit[]> {
  const profileIds = ctx.profiles.map((p) => p.id);
  if (profileIds.length === 0) return [];
  const nameById = new Map(ctx.profiles.map((p) => [p.id, p.name]));
  const rows = await db('care_plan_generation_jobs')
    .whereIn('care_profile_id', profileIds)
    .where('account_id', watch.account_id)
    .where('status', 'succeeded')
    .whereNotNull('result_version_id')
    .where('updated_at', '>=', ctx.since)
    .orderBy('updated_at', 'desc')
    .limit(20)
    .select('id', 'care_profile_id', 'updated_at');
  const seen = new Set<string>();
  const hits: WatchHit[] = [];
  for (const j of rows) {
    if (seen.has(j.care_profile_id)) continue;
    seen.add(j.care_profile_id);
    const name = nameById.get(j.care_profile_id) ?? 'someone';
    hits.push({
      key: `watch:${watch.id}:plan:${j.id}`,
      text: `${name}'s care plan is ready to review.`,
      url: `/app/${j.care_profile_id}/plan`,
      urgent: false,
      occurred_at: new Date(j.updated_at ?? ctx.now).toISOString(),
    });
  }
  return hits;
}

async function marReportHits(watch: WatchRow, ctx: EvalContext): Promise<WatchHit[]> {
  const profileIds = ctx.profiles.map((p) => p.id);
  if (profileIds.length === 0) return [];
  const rows = await db('medication_administrations')
    .whereIn('care_profile_id', profileIds)
    .where('administered_at', '>=', ctx.since)
    .groupBy('care_profile_id')
    .select('care_profile_id')
    .count('id as count');
  const countById = new Map(rows.map((r) => [String(r.care_profile_id), Number(r.count)]));
  return ctx.profiles.map((p) => {
    const n = countById.get(p.id) ?? 0;
    return {
      key: `watch:${watch.id}:mar:${p.id}:${ctx.since.toISOString().slice(0, 10)}`,
      text: `${p.name}'s medication record: ${n} ${n === 1 ? 'dose' : 'doses'} recorded in this period.`,
      url: `/app/${p.id}/mar`,
      urgent: false,
      occurred_at: ctx.now.toISOString(),
    };
  });
}

/** Everything this watch has to say right now, given its scope and horizon. */
export async function evaluateWatch(watch: WatchRow, ctx: EvalContext): Promise<WatchHit[]> {
  switch (watch.metric) {
    case 'medication_supply':
      return supplyHits(watch, ctx);
    case 'dose_overdue':
      return doseOverdueHits(watch, ctx);
    case 'appointment_upcoming':
      return appointmentHits(watch, ctx);
    case 'task_due':
      return taskHits(watch, ctx);
    case 'care_plan':
      return carePlanHits(watch, ctx);
    case 'mar_report':
      return marReportHits(watch, ctx);
    case 'care_activity':
      return auditHits(watch, ctx, null);
    case 'new_message':
      return auditHits(watch, ctx, ['messages']);
    case 'document_added':
      return auditHits(watch, ctx, ['documents']);
    case 'health_change':
      return auditHits(watch, ctx, ['conditions', 'allergies']);
    default:
      return [];
  }
}
