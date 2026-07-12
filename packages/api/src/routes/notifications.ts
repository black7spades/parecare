import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * The notification bell: everything new across every care profile this
 * account can see, in one feed. Two sources:
 *
 * - The audit trail, which already records every successful create, update
 *   and delete under every profile section. The viewer's own actions are
 *   left out (you were there), as are AI conversations (private).
 * - Medication supply: a prescription running low or out.
 * - Overdue doses: a scheduled medication time has passed today with no
 *   dose recorded. These are priority items: they lead the feed, and as
 *   further scheduled times pass unrecorded the alert comes back even if
 *   an earlier one was read.
 *
 * Read state is per account and per item, so the badge counts only what
 * this person has not yet seen.
 */
export const notificationsRouter = Router();

const HORIZON_DAYS = 30;
const MAX_ITEMS = 50;

export interface NotificationItem {
  /** Stable identifier, also used to record the read. */
  key: string;
  kind: 'activity' | 'supply_low' | 'supply_out' | 'dose_overdue';
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

interface AccessibleProfile {
  id: string;
  name: string;
}

async function accessibleProfiles(accountId: string): Promise<AccessibleProfile[]> {
  const [owned, shared] = await Promise.all([
    db('care_profiles')
      .where({ account_id: accountId, archived: false })
      .select('id', 'full_name', 'preferred_name'),
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

async function gatherNotifications(accountId: string): Promise<NotificationItem[]> {
  const profiles = await accessibleProfiles(accountId);
  if (profiles.length === 0) return [];
  const profileIds = profiles.map((p) => p.id);
  const nameById = new Map(profiles.map((p) => [p.id, p.name]));
  const horizon = new Date(Date.now() - HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [auditRows, medRows, adminRows, readRows] = await Promise.all([
    db('audit_log')
      .leftJoin('accounts', 'audit_log.actor_account_id', 'accounts.id')
      .whereIn('audit_log.care_profile_id', profileIds)
      .where('audit_log.created_at', '>=', horizon)
      // Your own actions are not news to you; AI conversations are private.
      .where((qb) => qb.whereNull('audit_log.actor_account_id').orWhereNot('audit_log.actor_account_id', accountId))
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
      ),
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .whereIn('m.care_profile_id', profileIds)
      .where('m.active', true)
      .select('m.id', 'm.care_profile_id', 'm.supply', 'm.supply_remaining', 'm.schedule_times', 'm.updated_at', 'c.name'),
    db('medication_administrations')
      .whereIn('care_profile_id', profileIds)
      .where('administered_at', '>=', startOfDay)
      .groupBy('medication_id')
      .select('medication_id')
      .count('id as count'),
    db('notification_reads').where({ account_id: accountId }).select('item_key'),
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

  // A medication is overdue when scheduled times have passed today and
  // fewer doses were recorded than times passed (same rule as the
  // needs-attention feed).
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = `${startOfDay.getFullYear()}-${String(startOfDay.getMonth() + 1).padStart(2, '0')}-${String(startOfDay.getDate()).padStart(2, '0')}`;

  for (const m of medRows) {
    if (m.supply_remaining !== null && m.supply_remaining !== undefined) {
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
          urgent: out,
          created_at: new Date(m.updated_at ?? Date.now()).toISOString(),
          read: read.has(key),
        });
      }
    }

    const times = Array.isArray(m.schedule_times) ? (m.schedule_times as string[]) : [];
    const passed = times.filter((t) => typeof t === 'string' && t <= nowHm).sort();
    const recorded = adminCounts.get(String(m.id)) ?? 0;
    if (passed.length > 0 && recorded < passed.length) {
      const missed = passed.length - recorded;
      // Keyed by day and by how many times have passed, so each further
      // missed time raises the alert again even if the last one was read.
      const key = `dose_overdue:${m.id}:${today}:${passed.length}`;
      const lastPassed = passed[passed.length - 1];
      const [hh, mm] = lastPassed.split(':').map(Number);
      const occurredAt = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), startOfDay.getDate(), hh, mm);
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
        urgent: true,
        created_at: occurredAt.toISOString(),
        read: read.has(key),
      });
    }
  }

  // Priority items lead: an unread urgent alert outranks everything, then
  // urgency, then recency.
  return items
    .sort(
      (a, b) =>
        Number(b.urgent && !b.read) - Number(a.urgent && !a.read) ||
        Number(b.urgent) - Number(a.urgent) ||
        (a.created_at < b.created_at ? 1 : -1)
    )
    .slice(0, MAX_ITEMS);
}

notificationsRouter.get('/', requireAuth, async (req, res) => {
  const items = await gatherNotifications(req.account!.id);
  res.json({ items, unread: items.filter((i) => !i.read).length });
});

notificationsRouter.post('/read', requireAuth, async (req, res) => {
  const parsed = z.object({ keys: z.array(z.string().min(1).max(255)).min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  await db('notification_reads')
    .insert(parsed.data.keys.map((key) => ({ account_id: req.account!.id, item_key: key })))
    .onConflict(['account_id', 'item_key'])
    .ignore();
  res.json({ read: parsed.data.keys.length });
});

notificationsRouter.post('/read-all', requireAuth, async (req, res) => {
  const items = await gatherNotifications(req.account!.id);
  const unread = items.filter((i) => !i.read);
  if (unread.length > 0) {
    await db('notification_reads')
      .insert(unread.map((i) => ({ account_id: req.account!.id, item_key: i.key })))
      .onConflict(['account_id', 'item_key'])
      .ignore();
  }
  res.json({ read: unread.length });
});
