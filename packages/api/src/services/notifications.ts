import { db } from '../config/database';
import { COURSE_RUNNING_SQL } from '../lib/course';
import { contactLine, supplyContext, type NextAction } from './alertContacts';
import type { ContactSummary } from './professionals';
import { dateInZone, hmInZone, startOfDayInZone } from '../lib/timezone';
import { coveredTimes, doseAnchor } from '../lib/doseSlots';
import { DOSE_AUDIT_ENTITY, doseOutcomeWord, isGivenStatus } from '../lib/doseOutcome';
import type { Account } from '../types';

/**
 * The notification feed: everything new across every care profile an
 * account can see, derived on demand from the audit trail, medication
 * supply and medication schedules. Shared by the in-app bell and the
 * outbound delivery worker so both always agree on what exists.
 *
 * Urgency follows the medication's critical flag: missing citalopram is
 * dangerous, missing aspirin usually is not, so only critical medications
 * raise urgent overdue and out-of-stock alerts.
 */

const HORIZON_DAYS = 30;
const MAX_ITEMS = 50;

export type NotificationKind =
  | 'activity'
  | 'supply_low'
  | 'supply_out'
  | 'dose_overdue'
  | 'dose_not_given'
  | 'care_plan_ready'
  | 'outcome_due';

export interface NotificationItem {
  /** Stable identifier, also used to record reads and deliveries. */
  key: string;
  kind: NotificationKind;
  profile_id: string;
  profile_name: string;
  actor_name: string | null;
  action: 'created' | 'updated' | 'deleted' | null;
  /** Audit entity type (messages, log, documents, …) for the deep link. */
  entity_type: string | null;
  summary: string | null;
  /** Medication name for supply and overdue-dose alerts. */
  medication_name: string | null;
  /** Overdue-dose alerts: how many of today's passed times lack a record. */
  missed_count: number | null;
  /** Pressing enough to lead the feed and stand out. */
  urgent: boolean;
  created_at: string;
  read: boolean;
  /** The record it is about, when the link opens that one record. */
  record_id?: string | null;
  record_kind?: string | null;
  /** Who to call about it: the supplier or main pharmacy for a supply alert. */
  contact?: ContactSummary | null;
  /** The next thing to do: order online, call or email, or open the record. */
  next_action?: NextAction | null;
  /** Supply alerts: about how many days are left. */
  days_left?: number | null;
}

/**
 * Which kinds an account wants, from accounts.notification_prefs. A kind
 * is on unless explicitly switched off, so new kinds reach everyone.
 */
export interface NotificationPrefs {
  activity?: boolean;
  dose_overdue?: boolean;
  supply?: boolean;
  outcomes?: boolean;
}

export function prefsOf(account: Pick<Account, 'notification_prefs'>): Required<NotificationPrefs> {
  const raw = (account.notification_prefs ?? {}) as NotificationPrefs;
  return {
    activity: raw.activity !== false,
    dose_overdue: raw.dose_overdue !== false,
    supply: raw.supply !== false,
    outcomes: raw.outcomes !== false,
  };
}

function wanted(kind: NotificationKind, prefs: Required<NotificationPrefs>): boolean {
  if (kind === 'activity') return prefs.activity;
  // A refused, held or omitted dose is the same worry as a missed one.
  if (kind === 'dose_overdue' || kind === 'dose_not_given') return prefs.dose_overdue;
  if (kind === 'outcome_due') return prefs.outcomes;
  // A plan the account asked for finishing is a direct answer to their own
  // action, so it is always surfaced regardless of the activity preference.
  if (kind === 'care_plan_ready') return true;
  return prefs.supply;
}

interface AccessibleProfile {
  id: string;
  name: string;
  /** Set once the person has died: their dose and supply alerts stop. */
  died: boolean;
}

async function accessibleProfiles(accountId: string): Promise<AccessibleProfile[]> {
  const [owned, shared] = await Promise.all([
    db('care_profiles').where({ account_id: accountId, archived: false }).select('id', 'full_name', 'preferred_name', 'died_on'),
    db('care_profiles')
      .join('care_circle_members', 'care_profiles.id', 'care_circle_members.care_profile_id')
      .where({
        'care_circle_members.account_id': accountId,
        'care_circle_members.invite_accepted': true,
        'care_profiles.archived': false,
      })
      .whereNot('care_profiles.account_id', accountId)
      .select('care_profiles.id', 'care_profiles.full_name', 'care_profiles.preferred_name', 'care_profiles.died_on'),
  ]);
  return [...owned, ...shared].map((p) => ({
    id: p.id as string,
    name: (p.preferred_name ?? p.full_name) as string,
    died: !!p.died_on,
  }));
}

/**
 * Everything currently notifiable for this account, filtered to the kinds
 * they want. "Today" and "a scheduled time has passed" are judged in the
 * account's own time zone, so a dose logged at 08:00 their time counts
 * against today no matter where the server runs.
 */
export async function gatherNotifications(
  account: Pick<Account, 'id' | 'timezone' | 'notification_prefs'>,
  timeZone?: string | null
): Promise<NotificationItem[]> {
  const prefs = prefsOf(account);
  const tz = timeZone ?? account.timezone ?? null;
  const profiles = await accessibleProfiles(account.id);
  if (profiles.length === 0) return [];
  const profileIds = profiles.map((p) => p.id);
  const nameById = new Map(profiles.map((p) => [p.id, p.name]));
  // Medicine alerts are about someone still living. Once a death is recorded
  // they stop: nobody should be told a dose is overdue for a person who died.
  const livingIds = profiles.filter((p) => !p.died).map((p) => p.id);
  const horizon = new Date(Date.now() - HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const now = new Date();
  const startOfDay = startOfDayInZone(now, tz);

  const [auditRows, medRows, adminRows, readRows, planJobRows, outcomeRows] = await Promise.all([
    prefs.activity
      ? db('audit_log')
          .leftJoin('accounts', 'audit_log.actor_account_id', 'accounts.id')
          .whereIn('audit_log.care_profile_id', profileIds)
          .where('audit_log.created_at', '>=', horizon)
          // Your own actions are not news to you; AI conversations are private.
          .where((qb) => qb.whereNull('audit_log.actor_account_id').orWhereNot('audit_log.actor_account_id', account.id))
          .whereNot('audit_log.entity_type', 'ai')
          .orderBy('audit_log.created_at', 'desc')
          .limit(MAX_ITEMS)
          .select(
            'audit_log.id',
            'audit_log.care_profile_id',
            'audit_log.action',
            'audit_log.entity_type',
            'audit_log.entity_id',
            'audit_log.summary',
            'audit_log.created_at',
            'accounts.display_name as actor_name'
          )
      : Promise.resolve([]),
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .whereIn('m.care_profile_id', livingIds)
      .where('m.active', true)
      .whereRaw(COURSE_RUNNING_SQL)
      .select('m.id', 'm.care_profile_id', 'm.supply', 'm.supply_remaining', 'm.packs_on_hand', 'm.schedule_times', 'm.critical', 'm.updated_at', 'c.name'),
    // Yesterday onward, since a dose given for this morning may have been
    // recorded late last night or early, and is placed by the time it was for.
    db('medication_administrations')
      .whereIn('care_profile_id', livingIds)
      .where((qb) =>
        qb
          .where('administered_at', '>=', new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000))
          .orWhere('scheduled_for', '>=', startOfDay)
      )
      .select(
        'id',
        'medication_id',
        'care_profile_id',
        'scheduled_for',
        'administered_at',
        'status',
        'administered_by_account_id',
        'administered_by_name'
      ),
    db('notification_reads').where({ account_id: account.id }).select('item_key'),
    // Care plan generation this account started that has since finished with a
    // new version. Only the latest run per profile matters, so the newest is
    // taken below; a run that produced no changes is not "a plan ready".
    db('care_plan_generation_jobs')
      .whereIn('care_profile_id', profileIds)
      .where('account_id', account.id)
      .where('status', 'succeeded')
      .whereNotNull('result_version_id')
      .where('updated_at', '>=', horizon)
      .orderBy('updated_at', 'desc')
      .select('id', 'care_profile_id', 'updated_at'),
    // Appointments in the last fortnight that have finished with nothing yet
    // recorded about how they went. Recording an outcome or a next step
    // takes them off the list, so the alert clears itself.
    prefs.outcomes
      ? db('appointments as ap')
          .leftJoin('providers as p', 'ap.provider_id', 'p.id')
          .whereIn('ap.care_profile_id', livingIds)
          .whereIn('ap.status', ['scheduled', 'completed'])
          .whereNull('ap.outcome')
          .where('ap.starts_at', '>=', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))
          .whereRaw("coalesce(ap.ends_at, ap.starts_at + interval '1 hour') <= now()")
          .whereNotExists(db('reminders').whereRaw('reminders.appointment_id = ap.id'))
          .orderBy('ap.starts_at', 'desc')
          .select('ap.id', 'ap.care_profile_id', 'ap.title', 'ap.starts_at', 'ap.ends_at', 'p.name as provider_name')
      : Promise.resolve([]),
  ]);

  const read = new Set(readRows.map((r) => (r as { item_key: string }).item_key));
  // Today's doses per medication, each placed on the day it was due. Only a
  // dose the person actually had covers a scheduled time: a refused, held or
  // omitted dose leaves the time still overdue, and is told to the circle on
  // its own below.
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  type AdminRow = {
    id: string;
    medication_id: string;
    care_profile_id: string;
    scheduled_for: Date | null;
    administered_at: Date;
    status: string;
    administered_by_account_id: string | null;
    administered_by_name: string | null;
  };
  const dosesToday = new Map<string, Array<{ scheduled_for: Date | null; administered_at: Date }>>();
  const notGivenToday: AdminRow[] = [];
  for (const r of adminRows as AdminRow[]) {
    const at = doseAnchor(r);
    if (at < startOfDay || at >= endOfDay) continue;
    if (!isGivenStatus(r.status)) {
      notGivenToday.push(r);
      continue;
    }
    const list = dosesToday.get(String(r.medication_id)) ?? [];
    list.push(r);
    dosesToday.set(String(r.medication_id), list);
  }
  const items: NotificationItem[] = [];

  // A refused, held or omitted dose is news for the circle in its own right:
  // "Jess recorded Dorothy's Metoprolol as refused." The person who recorded
  // it already knows. Critical medicines lead the feed.
  const medById = new Map(
    (medRows as Array<{ id: string; name: string; critical: boolean }>).map((m) => [String(m.id), m])
  );
  const notGivenIds = new Set<string>();
  for (const r of notGivenToday) {
    notGivenIds.add(String(r.id));
    if (r.administered_by_account_id === account.id) continue;
    const med = medById.get(String(r.medication_id));
    if (!med) continue;
    const key = `dose_not_given:${r.id}`;
    items.push({
      key,
      kind: 'dose_not_given',
      profile_id: r.care_profile_id,
      profile_name: nameById.get(r.care_profile_id) ?? 'Unknown',
      actor_name: r.administered_by_name ?? null,
      action: null,
      entity_type: 'medications',
      summary: doseOutcomeWord(r.status),
      medication_name: med.name,
      missed_count: null,
      urgent: !!med.critical,
      created_at: new Date(r.administered_at).toISOString(),
      read: read.has(key),
    });
  }

  for (const row of auditRows) {
    // The dose outcome above already says this one, in plainer words.
    if (row.entity_type === DOSE_AUDIT_ENTITY && row.entity_id && notGivenIds.has(String(row.entity_id))) continue;
    const key = `audit:${row.id}`;
    items.push({
      key,
      kind: 'activity',
      profile_id: row.care_profile_id,
      profile_name: nameById.get(row.care_profile_id) ?? 'Unknown',
      actor_name: row.actor_name ?? null,
      action: row.action,
      entity_type: row.entity_type,
      summary: row.summary ?? null,
      medication_name: null,
      missed_count: null,
      urgent: false,
      created_at: new Date(row.created_at).toISOString(),
      read: read.has(key),
    });
  }

  // One "care plan ready" per profile: the most recent finished run. The rows
  // arrive newest-first, so the first seen for a profile is the one to keep.
  const planSeen = new Set<string>();
  for (const job of planJobRows) {
    if (planSeen.has(job.care_profile_id)) continue;
    planSeen.add(job.care_profile_id);
    const key = `care_plan_ready:${job.id}`;
    items.push({
      key,
      kind: 'care_plan_ready',
      profile_id: job.care_profile_id,
      profile_name: nameById.get(job.care_profile_id) ?? 'Unknown',
      actor_name: null,
      action: null,
      entity_type: 'plan',
      summary: null,
      medication_name: null,
      missed_count: null,
      urgent: false,
      created_at: new Date(job.updated_at ?? Date.now()).toISOString(),
      read: read.has(key),
    });
  }

  for (const ap of outcomeRows as Array<{ id: string; care_profile_id: string; title: string; starts_at: Date; ends_at: Date | null; provider_name: string | null }>) {
    const key = `outcome:${ap.id}`;
    items.push({
      key,
      kind: 'outcome_due',
      profile_id: ap.care_profile_id,
      profile_name: nameById.get(ap.care_profile_id) ?? 'Unknown',
      actor_name: null,
      action: null,
      entity_type: 'appointments',
      summary: ap.provider_name ? `${ap.title} with ${ap.provider_name}` : ap.title,
      medication_name: null,
      missed_count: null,
      urgent: false,
      created_at: new Date(ap.ends_at ?? new Date(new Date(ap.starts_at).getTime() + 60 * 60 * 1000)).toISOString(),
      read: read.has(key),
      record_id: ap.id,
    });
  }

  // A medication is overdue when scheduled times have passed today (on the
  // user's clock) and fewer doses were recorded than times passed.
  const nowHm = hmInZone(now, tz);
  const today = dateInZone(now, tz);

  for (const m of medRows) {
    const critical = !!m.critical;

    if (prefs.supply && m.supply_remaining !== null && m.supply_remaining !== undefined) {
      // Unopened packs count towards what is on hand.
      const packUnits =
        m.packs_on_hand != null && m.supply != null ? Number(m.packs_on_hand) * Number(m.supply) : 0;
      const remaining = Number(m.supply_remaining) + packUnits;
      const total = Number(m.supply);
      // Low means five or fewer doses left, or under a fifth of the supply.
      const lowThreshold = Number.isFinite(total) && total > 0 ? Math.max(5, total * 0.2) : 5;
      const out = remaining <= 0;
      if (out || remaining <= lowThreshold) {
        // The remaining count is part of the key, so a restock (or a further
        // drop) surfaces the alert again even after it was read.
        const key = `${out ? 'supply_out' : 'supply_low'}:${m.id}:${remaining}`;
        items.push({
          key,
          kind: out ? 'supply_out' : 'supply_low',
          profile_id: m.care_profile_id,
          profile_name: nameById.get(m.care_profile_id) ?? 'Unknown',
          actor_name: null,
          action: null,
          entity_type: 'medications',
          summary: null,
          medication_name: m.name,
          missed_count: null,
          urgent: out && critical,
          created_at: new Date(m.updated_at ?? Date.now()).toISOString(),
          read: read.has(key),
          record_id: m.id,
          record_kind: 'medications',
        });
      }
    }

    if (prefs.dose_overdue) {
      const times = Array.isArray(m.schedule_times) ? (m.schedule_times as string[]) : [];
      const passed = times.filter((t) => typeof t === 'string' && t <= nowHm).sort();
      const covered = coveredTimes(times, dosesToday.get(String(m.id)) ?? [], tz);
      const missed = passed.filter((t) => !covered.has(t)).length;
      if (missed > 0) {
        // Keyed by day and by how many times have passed, so each further
        // missed time raises the alert again even if the last one was read.
        const key = `dose_overdue:${m.id}:${today}:${passed.length}`;
        const lastPassed = passed[passed.length - 1];
        // The alert is timestamped at the last passed slot, on the user's clock.
        const [hh, mm] = lastPassed.split(':').map(Number);
        const occurredAt = new Date(startOfDay.getTime() + (hh * 60 + mm) * 60 * 1000);
        items.push({
          key,
          kind: 'dose_overdue',
          profile_id: m.care_profile_id,
          profile_name: nameById.get(m.care_profile_id) ?? 'Unknown',
          actor_name: null,
          action: null,
          entity_type: 'medications',
          summary: null,
          medication_name: m.name,
          missed_count: missed,
          urgent: critical,
          created_at: occurredAt.toISOString(),
          read: read.has(key),
        });
      }
    }
  }

  // Supply alerts name who to call and what to do: order online, call or
  // email the supplier, else their main pharmacy.
  const supplyIds = items.filter((i) => (i.kind === 'supply_low' || i.kind === 'supply_out') && i.record_id).map((i) => i.record_id!);
  if (supplyIds.length) {
    const ctx = await supplyContext(supplyIds);
    for (const i of items) {
      const c = i.record_id ? ctx.get(i.record_id) : undefined;
      if (!c || (i.kind !== 'supply_low' && i.kind !== 'supply_out')) continue;
      i.contact = c.contact;
      i.next_action = c.next_action;
      i.days_left = c.days_left;
    }
  }

  // Priority items lead: an unread urgent alert outranks everything, then
  // urgency, then recency.
  return items
    .filter((i) => wanted(i.kind, prefs))
    .sort(
      (a, b) =>
        Number(b.urgent && !b.read) - Number(a.urgent && !a.read) ||
        Number(b.urgent) - Number(a.urgent) ||
        (a.created_at < b.created_at ? 1 : -1)
    )
    .slice(0, MAX_ITEMS);
}

/** Where each kind of record lives, for deep links in outbound messages. */
const ENTITY_PAGES: Record<string, string> = {
  circle: 'circle',
  log: '',
  plan: 'plan',
  checklists: 'journey',
  journeys: 'journey',
  allergies: 'plan',
  conditions: '',
  questions: 'questions',
  documents: 'documents',
  providers: 'providers',
  reminders: 'tasks',
  medications: 'medications',
  doses: 'mar',
  treatments: 'medications',
  messages: 'messages',
  'memory-book': 'memory-book',
  calendar: 'calendar',
};

/** The in-app path a notification points at. */
export function notificationPath(item: NotificationItem): string {
  if (item.kind === 'outcome_due') return `/app/${item.profile_id}/appointments?outcome=${item.record_id ?? ''}`;
  if (item.kind === 'dose_overdue' || item.kind === 'dose_not_given') return `/app/${item.profile_id}/mar`;
  const page = ENTITY_PAGES[item.entity_type ?? ''] ?? '';
  // Opens the record itself when the alert is about one.
  const record = page && item.record_id && item.record_kind ? `?record=${item.record_id}` : '';
  return `/app/${item.profile_id}${page ? `/${page}` : ''}${record}`;
}

const VERBS: Record<string, string> = { created: 'added', updated: 'updated', deleted: 'removed' };

const ENTITY_NOUNS: Record<string, string> = {
  circle: 'a care circle member',
  log: 'a care log entry',
  plan: 'the care plan',
  checklists: 'a care journey item',
  journeys: 'a care journey',
  allergies: 'an allergy',
  conditions: 'a condition',
  questions: 'a question',
  documents: 'a document',
  providers: 'a provider',
  reminders: 'a task',
  medications: 'a treatment',
  treatments: 'a treatment',
  messages: 'a message',
  'memory-book': 'a memory',
  calendar: 'a calendar event',
  records: 'a note',
};

/** One plain sentence per notification, shared by every outbound channel. */
export function notificationText(item: NotificationItem): string {
  if (item.key.startsWith('test:')) {
    return 'If you can read this, this channel works.';
  }
  if (item.kind === 'outcome_due') {
    return `How did ${item.profile_name}'s appointment go? ${item.summary ?? ''}`.trim();
  }
  if (item.kind === 'dose_overdue') {
    const n = item.missed_count ?? 1;
    return n === 1
      ? `${item.profile_name}'s dose of ${item.medication_name} is due and has not been given.`
      : `${item.profile_name} has ${n} doses of ${item.medication_name} due today that have not been given.`;
  }
  if (item.kind === 'dose_not_given') {
    return `${item.actor_name ?? 'Someone'} recorded ${item.profile_name}'s ${item.medication_name} as ${item.summary ?? 'not given'}.`;
  }
  if (item.kind === 'supply_out') {
    return `${item.profile_name}'s ${item.medication_name} has run out.${contactLine(item.contact ?? null)}`;
  }
  if (item.kind === 'supply_low') {
    const days = item.days_left;
    const left = days == null ? '' : days === 0 ? ', less than a day left' : `, about ${days} ${days === 1 ? 'day' : 'days'} left`;
    return `${item.profile_name}'s ${item.medication_name} is running low${left}.${contactLine(item.contact ?? null)}`;
  }
  if (item.kind === 'care_plan_ready') {
    return `${item.profile_name}'s care plan is ready to review.`;
  }
  const who = item.actor_name ?? 'Someone';
  if (item.entity_type === 'messages' && item.action === 'created') {
    return `${who} posted in ${item.profile_name}'s messages.`;
  }
  if (item.entity_type === DOSE_AUDIT_ENTITY) {
    if (item.action === 'created') return `${who} recorded ${item.profile_name}'s ${item.summary ?? 'dose'}.`;
    const doing = item.action === 'deleted' ? 'removed a dose record' : 'corrected a dose record';
    return `${who} ${doing} for ${item.profile_name}${item.summary ? `: ${item.summary}` : ''}.`;
  }
  const noun = ENTITY_NOUNS[item.entity_type ?? ''] ?? 'a record';
  const verb = VERBS[item.action ?? ''] ?? 'changed';
  return `${who} ${verb} ${noun} for ${item.profile_name}${item.summary ? `: ${item.summary}` : ''}.`;
}
