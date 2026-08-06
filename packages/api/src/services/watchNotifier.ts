import { db } from '../config/database';
import { env } from '../config/env';
import type { Account } from '../types';
import {
  accessibleProfiles,
  evaluateWatch,
  watchLabel,
  type WatchRow,
  type WatchHit,
  type WatchCadence,
} from './watches';
import { sendLinesToChannel, type NotificationChannel, type DeliveryLine } from './notifier';
import { sendAlertEmail, type AlertSection } from './email';

/**
 * Sending the watches a person has set up. Every minute, alongside the derived
 * feed, each enabled watch with a destination is evaluated: an immediate watch
 * sends the moment it has something to say (recorded so it never repeats), and
 * digest watches sharing a destination are composed into one message at their
 * rhythm, so a fortnightly email can carry supply, appointments and a
 * medication record together.
 */

const PERIOD_MS: Record<Exclude<WatchCadence, 'immediate'>, number> = {
  daily: 24 * 3600 * 1000,
  weekly: 7 * 24 * 3600 * 1000,
  fortnightly: 14 * 24 * 3600 * 1000,
  monthly: 30 * 24 * 3600 * 1000,
};

// A window a little wider than the tick interval for the activity-style
// metrics, so nothing new is missed between checks; delivery records catch any
// overlap, so a widened window never sends the same thing twice.
const IMMEDIATE_WINDOW_MS = 3 * 60 * 1000;

const CADENCE_WORD: Record<string, string> = {
  daily: 'daily update',
  weekly: 'weekly update',
  fortnightly: 'fortnightly update',
  monthly: 'monthly update',
};

const abs = (u: string): string => (/^https?:\/\//i.test(u) ? u : `${env.APP_URL}${u}`);

const hitsToSections = (
  groups: { title: string; hits: WatchHit[] }[]
): AlertSection[] =>
  groups
    .filter((g) => g.hits.length > 0)
    .map((g) => ({
      title: g.title,
      lines: g.hits.map((h) => ({
        text: h.text,
        url: abs(h.url),
        ...(h.action_label && h.action_url ? { actionText: h.action_label, actionUrl: abs(h.action_url) } : {}),
      })),
    }));

const hitsToLines = (hits: WatchHit[]): DeliveryLine[] =>
  hits.map((h) => ({
    text: h.text,
    url: h.url,
    urgent: h.urgent,
    ...(h.action_label && h.action_url ? { action_label: h.action_label, action_url: h.action_url } : {}),
  }));

async function deliver(
  channel: NotificationChannel,
  account: Account,
  subject: string,
  groups: { title: string; hits: WatchHit[] }[]
): Promise<void> {
  if (channel.kind === 'email') {
    const sections = hitsToSections(groups);
    if (sections.length === 0) return;
    const to = (channel.config['address'] as string) || account.email;
    await sendAlertEmail(to, subject, sections);
    return;
  }
  const lines = groups.flatMap((g) => hitsToLines(g.hits));
  if (lines.length === 0) return;
  await sendLinesToChannel(channel, account, subject, lines);
}

/** Record what an immediate watch's destination has been sent, once each. */
async function markDelivered(channelId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db('notification_deliveries')
    .insert(keys.map((item_key) => ({ channel_id: channelId, item_key })))
    .onConflict(['channel_id', 'item_key'])
    .ignore();
}

export async function deliverWatchesForAccount(account: Account, channels: NotificationChannel[]): Promise<void> {
  const channelById = new Map(channels.map((c) => [c.id, c]));
  const watches = (await db('notification_watches')
    .where({ account_id: account.id, enabled: true })
    .whereNotNull('channel_id')) as WatchRow[];
  if (watches.length === 0) return;

  const profiles = await accessibleProfiles(account.id);
  const now = new Date();

  // Names for medication-scoped watches, for the section headings.
  const medIds = [...new Set(watches.map((w) => w.medication_id).filter((id): id is string => !!id))];
  const medNameById = new Map<string, string>();
  if (medIds.length > 0) {
    const rows = await db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .whereIn('m.id', medIds)
      .select('m.id', 'c.name');
    for (const r of rows) medNameById.set(String(r.id), String(r.name));
  }

  const scopeOf = (w: WatchRow) => (w.care_profile_id ? profiles.filter((p) => p.id === w.care_profile_id) : profiles);
  const titleOf = (w: WatchRow) => {
    const profileName = w.care_profile_id ? profiles.find((p) => p.id === w.care_profile_id)?.name ?? null : null;
    return watchLabel(w, profileName, w.medication_id ? medNameById.get(w.medication_id) : null);
  };

  // ---- Immediate watches: one combined message per destination ----
  const immediate = watches.filter((w) => w.cadence === 'immediate');
  const byChannelImmediate = new Map<string, WatchRow[]>();
  for (const w of immediate) {
    if (!w.channel_id || !channelById.has(w.channel_id)) continue;
    const arr = byChannelImmediate.get(w.channel_id) ?? [];
    arr.push(w);
    byChannelImmediate.set(w.channel_id, arr);
  }

  for (const [channelId, group] of byChannelImmediate) {
    const channel = channelById.get(channelId)!;
    const since = new Date(now.getTime() - IMMEDIATE_WINDOW_MS);
    const perWatch: { title: string; hits: WatchHit[] }[] = [];
    for (const w of group) {
      const hits = await evaluateWatch(w, { timezone: account.timezone ?? null, profiles: scopeOf(w), now, since });
      if (hits.length > 0) perWatch.push({ title: titleOf(w), hits });
    }
    const allKeys = perWatch.flatMap((g) => g.hits.map((h) => h.key));
    if (allKeys.length === 0) continue;
    const alreadySent = new Set(
      (await db('notification_deliveries').where({ channel_id: channelId }).whereIn('item_key', allKeys).select('item_key')).map(
        (r) => r.item_key as string
      )
    );
    const fresh = perWatch
      .map((g) => ({ title: g.title, hits: g.hits.filter((h) => !alreadySent.has(h.key)) }))
      .filter((g) => g.hits.length > 0);
    if (fresh.length === 0) continue;
    const count = fresh.reduce((n, g) => n + g.hits.length, 0);
    const subject = count === 1 ? 'PareCare alert' : `PareCare: ${count} alerts`;
    try {
      await deliver(channel, account, subject, fresh);
      await markDelivered(channelId, fresh.flatMap((g) => g.hits.map((h) => h.key)));
    } catch (err) {
      console.warn(`Watch delivery failed for channel ${channelId} (${channel.kind}):`, (err as Error).message);
    }
  }

  // ---- Digest watches: composed per destination when the period is up ----
  const digest = watches.filter((w) => w.cadence !== 'immediate');
  const byChannelDigest = new Map<string, WatchRow[]>();
  for (const w of digest) {
    if (!w.channel_id || !channelById.has(w.channel_id)) continue;
    const period = PERIOD_MS[w.cadence as Exclude<WatchCadence, 'immediate'>] ?? PERIOD_MS.daily;
    const last = w.last_sent_at ? new Date(w.last_sent_at).getTime() : 0;
    if (last !== 0 && now.getTime() - last < period) continue; // not due yet
    const arr = byChannelDigest.get(w.channel_id) ?? [];
    arr.push(w);
    byChannelDigest.set(w.channel_id, arr);
  }

  for (const [channelId, group] of byChannelDigest) {
    const channel = channelById.get(channelId)!;
    const perWatch: { title: string; hits: WatchHit[] }[] = [];
    for (const w of group) {
      const period = PERIOD_MS[w.cadence as Exclude<WatchCadence, 'immediate'>] ?? PERIOD_MS.daily;
      const since = w.last_sent_at ? new Date(w.last_sent_at) : new Date(now.getTime() - period);
      const hits = await evaluateWatch(w, { timezone: account.timezone ?? null, profiles: scopeOf(w), now, since });
      perWatch.push({ title: titleOf(w), hits });
    }
    const cadences = new Set(group.map((w) => w.cadence));
    const subject = `Your PareCare ${cadences.size === 1 ? CADENCE_WORD[[...cadences][0]] ?? 'update' : 'update'}`;
    const anything =
      channel.kind === 'email' ? hitsToSections(perWatch).length > 0 : perWatch.some((g) => g.hits.length > 0);
    let ok = true;
    if (anything) {
      try {
        await deliver(channel, account, subject, perWatch);
      } catch (err) {
        ok = false;
        console.warn(`Watch digest failed for channel ${channelId} (${channel.kind}):`, (err as Error).message);
      }
    }
    // Reset the period when the digest went out, or when there was nothing to
    // say this period; a failed send is left to retry on the next cycle.
    if (ok) {
      await db('notification_watches')
        .whereIn('id', group.map((w) => w.id))
        .update({ last_sent_at: db.fn.now(), updated_at: db.fn.now() });
    }
  }
}
