import { db } from '../config/database';
import { dateInZone, hmInZone, startOfDayInZone } from '../lib/timezone';
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

export type NotificationKind = 'activity' | 'supply_low' | 'supply_out' | 'dose_overdue';

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
}

/**
 * Which kinds an account wants, from accounts.notification_prefs. A kind
 * is on unless explicitly switched off, so new kinds reach everyone.
 */
export interface NotificationPrefs {
  activity?: boolean;
  dose_overdue?: boolean;
  supply?: boolean;
}

export function prefsOf(account: Pick<Account, 'notification_prefs'>): Required<NotificationPrefs> {
  const raw = (account.notification_prefs ?? {}) as NotificationPrefs;
  return {
    activity: raw.activity !== false,
    dose_overdue: raw.dose_overdue !== false,
    supply: raw.supply !== false,
  };
}

function wanted(kind: NotificationKind, prefs: Required<NotificationPrefs>): boolean {
  if (kind === 'activity') return prefs.activity;
  if (kind === 'dose_overdue') return prefs.dose_overdue;
  return prefs.supply;
}

interface AccessibleProfile {
  id: string;
  name: string;
}

async function accessibleProfiles(accountId: string): Promise<AccessibleProfile[]> {
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
  const horizon = new Date(Date.now() - HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const now = new Date();
  const startOfDay = startOfDayInZone(now, tz);

  const [auditRows, medRows, adminRows, readRows] = await Promise.all([
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
            'audit_log.summary',
            'audit_log.created_at',
            'accounts.display_name as actor_name'
          )
      : Promise.resolve([]),
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .whereIn('m.care_profile_id', profileIds)
      .where('m.active', true)
      .select('m.id', 'm.care_profile_id', 'm.supply', 'm.supply_remaining', 'm.schedule_times', 'm.critical', 'm.updated_at', 'c.name'),
    db('medication_administrations')
      .whereIn('care_profile_id', profileIds)
      .where('administered_at', '>=', startOfDay)
      .groupBy('medication_id')
      .select('medication_id')
      .count('id as count'),
    db('notification_reads').where({ account_id: account.id }).select('item_key'),
  ]);

  const read = new Set(readRows.map((r) => (r as { item_key: string }).item_key));
  const adminCounts = new Map(adminRows.map((r) => [String(r.medication_id), Number(r.count)]));
  const items: NotificationItem[] = [];

  for (const row of auditRows) {
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

  // A medication is overdue when scheduled times have passed today (on the
  // user's clock) and fewer doses were recorded than times passed.
  const nowHm = hmInZone(now, tz);
  const today = dateInZone(now, tz);

  for (const m of medRows) {
    const critical = !!m.critical;

    if (prefs.supply && m.supply_remaining !== null && m.supply_remaining !== undefined) {
      const remaining = Number(m.supply_remaining);
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
        });
      }
    }

    if (prefs.dose_overdue) {
      const times = Array.isArray(m.schedule_times) ? (m.schedule_times as string[]) : [];
      const passed = times.filter((t) => typeof t === 'string' && t <= nowHm).sort();
      const recorded = adminCounts.get(String(m.id)) ?? 0;
      if (passed.length > 0 && recorded < passed.length) {
        const missed = passed.length - recorded;
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
  treatments: 'medications',
  messages: 'messages',
  'memory-book': 'memory-book',
  calendar: 'calendar',
};

/** The in-app path a notification points at. */
export function notificationPath(item: NotificationItem): string {
  const page = ENTITY_PAGES[item.entity_type ?? ''] ?? '';
  return `/app/${item.profile_id}${page ? `/${page}` : ''}`;
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
};

/** One plain sentence per notification, shared by every outbound channel. */
export function notificationText(item: NotificationItem): string {
  if (item.key.startsWith('test:')) {
    return 'If you can read this, this channel works.';
  }
  if (item.kind === 'dose_overdue') {
    const n = item.missed_count ?? 1;
    return n === 1
      ? `${item.profile_name}'s dose of ${item.medication_name} is due and not yet recorded.`
      : `${item.profile_name} has ${n} doses of ${item.medication_name} due and not yet recorded today.`;
  }
  if (item.kind === 'supply_out') {
    return `${item.profile_name}'s prescription for ${item.medication_name} is out of stock.`;
  }
  if (item.kind === 'supply_low') {
    return `${item.profile_name}'s prescription for ${item.medication_name} is low.`;
  }
  const who = item.actor_name ?? 'Someone';
  if (item.entity_type === 'messages' && item.action === 'created') {
    return `${who} posted in ${item.profile_name}'s messages.`;
  }
  const noun = ENTITY_NOUNS[item.entity_type ?? ''] ?? 'a record';
  const verb = VERBS[item.action ?? ''] ?? 'changed';
  return `${who} ${verb} ${noun} for ${item.profile_name}${item.summary ? `: ${item.summary}` : ''}.`;
}
