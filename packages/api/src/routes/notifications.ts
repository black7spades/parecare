import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { isValidTimeZone } from '../lib/timezone';
import { gatherNotifications, prefsOf } from '../services/notifications';
import { sendToChannel, type NotificationChannel } from '../services/notifier';
import { vapidPublicKey } from '../services/webpush';
import {
  WATCH_METRICS,
  accessibleProfiles,
  isKnownMetric,
  metricMeta,
  watchLabel,
  type WatchRow,
} from '../services/watches';

/**
 * The notification bell and its settings. The feed itself is derived on
 * demand (see services/notifications); these routes add read state,
 * per-kind preferences, and the channels notifications are delivered to
 * beyond the bell: email, web push, Discord, Telegram or a generic
 * webhook, each instant for urgent alerts and digested for the rest.
 */
export const notificationsRouter = Router();

notificationsRouter.get('/', requireAuth, async (req, res) => {
  // The browser's zone rides along and is remembered, so scheduled-dose
  // checks (here and in the background worker) run on the user's clock.
  const tz = typeof req.query['tz'] === 'string' ? req.query['tz'] : null;
  if (isValidTimeZone(tz) && tz !== req.account!.timezone) {
    await db('accounts').where({ id: req.account!.id }).update({ timezone: tz });
    req.account!.timezone = tz;
  }
  const items = await gatherNotifications(req.account!, tz);
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
  const items = await gatherNotifications(req.account!);
  const unread = items.filter((i) => !i.read);
  if (unread.length > 0) {
    await db('notification_reads')
      .insert(unread.map((i) => ({ account_id: req.account!.id, item_key: i.key })))
      .onConflict(['account_id', 'item_key'])
      .ignore();
  }
  res.json({ read: unread.length });
});

// ---------- Preferences and delivery channels ----------

notificationsRouter.get('/settings', requireAuth, async (req, res) => {
  const channels = await db('notification_channels')
    .where({ account_id: req.account!.id })
    .orderBy('created_at', 'asc');
  res.json({
    preferences: prefsOf(req.account!),
    channels,
    // The public half of the server's web push identity, needed by the
    // browser to subscribe this device.
    vapid_public_key: vapidPublicKey(),
  });
});

const prefsSchema = z.object({
  activity: z.boolean().optional(),
  dose_overdue: z.boolean().optional(),
  supply: z.boolean().optional(),
});

notificationsRouter.put('/preferences', requireAuth, async (req, res) => {
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const merged = { ...prefsOf(req.account!), ...parsed.data };
  await db('accounts')
    .where({ id: req.account!.id })
    .update({ notification_prefs: JSON.stringify(merged), updated_at: db.fn.now() });
  res.json({ preferences: merged });
});

const CHANNEL_KINDS = ['email', 'webpush', 'discord', 'telegram', 'webhook'] as const;

const channelSchema = z.object({
  kind: z.enum(CHANNEL_KINDS),
  label: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()).default({}),
  urgent_instantly: z.boolean().optional(),
  digest: z.enum(['off', 'daily', 'weekly', 'monthly']).optional(),
  enabled: z.boolean().optional(),
});

/** Kind-specific sanity checks, so a channel cannot be saved half-configured. */
function configError(kind: (typeof CHANNEL_KINDS)[number], config: Record<string, unknown>): string | null {
  const str = (k: string) => (typeof config[k] === 'string' && (config[k] as string).trim() ? (config[k] as string) : null);
  if (kind === 'discord' && !str('webhook_url')) return 'A Discord webhook URL is needed.';
  if (kind === 'telegram' && (!str('bot_token') || !str('chat_id'))) return 'A Telegram bot token and chat id are both needed.';
  if (kind === 'webhook' && !str('url')) return 'A webhook URL is needed.';
  if (kind === 'webpush') {
    const sub = config['subscription'] as { endpoint?: string } | undefined;
    if (!sub?.endpoint) return 'The push subscription from this browser is missing.';
  }
  return null;
}

notificationsRouter.post('/channels', requireAuth, async (req, res) => {
  const parsed = channelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const invalid = configError(parsed.data.kind, parsed.data.config);
  if (invalid) {
    res.status(400).json({ error: invalid, code: 'VALIDATION_ERROR' });
    return;
  }
  const [channel] = await db('notification_channels')
    .insert({
      account_id: req.account!.id,
      kind: parsed.data.kind,
      label: parsed.data.label,
      config: JSON.stringify(parsed.data.config),
      urgent_instantly: parsed.data.urgent_instantly ?? true,
      digest: parsed.data.digest ?? 'daily',
      enabled: parsed.data.enabled ?? true,
      // The first digest goes out one period from now, not immediately.
      last_digest_at: db.fn.now(),
    })
    .returning('*');

  // Everything that already exists is not news; only what happens from now
  // on flows to the new channel.
  const items = await gatherNotifications(req.account!);
  if (items.length > 0) {
    await db('notification_deliveries')
      .insert(items.map((i) => ({ channel_id: channel.id, item_key: i.key })))
      .onConflict(['channel_id', 'item_key'])
      .ignore();
  }

  res.status(201).json({ channel });
});

notificationsRouter.patch('/channels/:channelId', requireAuth, async (req, res) => {
  const parsed = channelSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const existing = await db('notification_channels')
    .where({ id: req.params['channelId'], account_id: req.account!.id })
    .first();
  if (!existing) {
    res.status(404).json({ error: 'Channel not found', code: 'NOT_FOUND' });
    return;
  }
  if (parsed.data.config) {
    const invalid = configError((parsed.data.kind ?? existing.kind) as (typeof CHANNEL_KINDS)[number], parsed.data.config);
    if (invalid) {
      res.status(400).json({ error: invalid, code: 'VALIDATION_ERROR' });
      return;
    }
  }
  const { kind: _kind, config, ...rest } = parsed.data;
  const [channel] = await db('notification_channels')
    .where({ id: existing.id })
    .update({
      ...rest,
      ...(config ? { config: JSON.stringify(config) } : {}),
      updated_at: db.fn.now(),
    })
    .returning('*');
  res.json({ channel });
});

notificationsRouter.delete('/channels/:channelId', requireAuth, async (req, res) => {
  const deleted = await db('notification_channels')
    .where({ id: req.params['channelId'], account_id: req.account!.id })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Channel not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Channel removed.' });
});

// ---------- Watches: the alerts a person sets up for themselves ----------

const WATCH_CADENCES = ['immediate', 'daily', 'weekly', 'fortnightly', 'monthly'] as const;

const watchSchema = z.object({
  metric: z.string().min(1).max(40),
  care_profile_id: z.string().uuid().nullable().optional(),
  medication_id: z.string().uuid().nullable().optional(),
  threshold_days: z.number().int().min(1).max(3650).nullable().optional(),
  critical_only: z.boolean().optional(),
  channel_id: z.string().uuid().nullable().optional(),
  cadence: z.enum(WATCH_CADENCES).optional(),
  label: z.string().max(160).nullable().optional(),
  enabled: z.boolean().optional(),
});

/** Reject a watch whose scope or shape does not add up, in plain words. */
async function watchScopeError(
  accountId: string,
  data: z.infer<typeof watchSchema>,
  existing?: WatchRow
): Promise<string | null> {
  const metric = data.metric ?? existing?.metric;
  if (!metric || !isKnownMetric(metric)) return 'That is not something PareCare can watch.';
  const meta = metricMeta(metric)!;
  const profileId = data.care_profile_id !== undefined ? data.care_profile_id : existing?.care_profile_id ?? null;
  const cadence = data.cadence ?? (existing?.cadence as string) ?? 'immediate';

  if (meta.requires_profile && !profileId) return 'Choose whose record this alert is about.';
  if (meta.digest_only && cadence === 'immediate') return 'This one is only sent as a digest. Choose a rhythm.';

  if (profileId) {
    const accessible = await accessibleProfiles(accountId);
    if (!accessible.some((p) => p.id === profileId)) return 'That person is not in your care circles.';
  }
  if (data.medication_id) {
    if (!profileId) return 'Choose whose medication this is about.';
    const med = await db('medications').where({ id: data.medication_id, care_profile_id: profileId }).first();
    if (!med) return 'That medication is not on that person.';
  }
  if (data.channel_id) {
    const channel = await db('notification_channels').where({ id: data.channel_id, account_id: accountId }).first();
    if (!channel) return 'That destination could not be found.';
  }
  return null;
}

/** Turn a stored watch into what the settings list shows: the plain sentences. */
function decorateWatch(
  watch: WatchRow,
  profileName: string | null,
  medicationName: string | null,
  channelLabel: string | null
): Record<string, unknown> {
  const meta = metricMeta(watch.metric);
  return {
    ...watch,
    metric_label: meta?.label ?? watch.metric,
    display_label: watchLabel(watch, profileName, medicationName),
    profile_name: profileName,
    medication_name: medicationName,
    channel_label: channelLabel,
  };
}

notificationsRouter.get('/watches', requireAuth, async (req, res) => {
  const [watches, profiles, channels] = await Promise.all([
    db('notification_watches').where({ account_id: req.account!.id }).orderBy('created_at', 'asc') as Promise<WatchRow[]>,
    accessibleProfiles(req.account!.id),
    db('notification_channels').where({ account_id: req.account!.id }).select('id', 'label', 'kind'),
  ]);
  const profileById = new Map(profiles.map((p) => [p.id, p.name]));
  const channelById = new Map(channels.map((c) => [c.id, c.label as string]));
  const medIds = [...new Set(watches.map((w) => w.medication_id).filter((id): id is string => !!id))];
  const medNameById = new Map<string, string>();
  if (medIds.length > 0) {
    const rows = await db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .whereIn('m.id', medIds)
      .select('m.id', 'c.name');
    for (const r of rows) medNameById.set(String(r.id), String(r.name));
  }
  res.json({
    watches: watches.map((w) =>
      decorateWatch(
        w,
        w.care_profile_id ? profileById.get(w.care_profile_id) ?? null : null,
        w.medication_id ? medNameById.get(w.medication_id) ?? null : null,
        w.channel_id ? channelById.get(w.channel_id) ?? null : null
      )
    ),
    // Everything the builder needs to offer the choices, so it is self-sufficient.
    metrics: WATCH_METRICS,
    profiles,
  });
});

notificationsRouter.post('/watches', requireAuth, async (req, res) => {
  const parsed = watchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const problem = await watchScopeError(req.account!.id, parsed.data);
  if (problem) {
    res.status(400).json({ error: problem, code: 'VALIDATION_ERROR' });
    return;
  }
  const cadence = parsed.data.cadence ?? 'immediate';
  const [watch] = await db('notification_watches')
    .insert({
      account_id: req.account!.id,
      metric: parsed.data.metric,
      care_profile_id: parsed.data.care_profile_id ?? null,
      medication_id: parsed.data.medication_id ?? null,
      threshold_days: parsed.data.threshold_days ?? null,
      critical_only: parsed.data.critical_only ?? false,
      channel_id: parsed.data.channel_id ?? null,
      cadence,
      label: parsed.data.label?.trim() || null,
      enabled: parsed.data.enabled ?? true,
      // A digest waits a full period before its first send, like a channel.
      last_sent_at: cadence === 'immediate' ? null : db.fn.now(),
    })
    .returning('*');
  res.status(201).json({ watch });
});

notificationsRouter.patch('/watches/:watchId', requireAuth, async (req, res) => {
  const parsed = watchSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const existing = (await db('notification_watches')
    .where({ id: req.params['watchId'], account_id: req.account!.id })
    .first()) as WatchRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Alert not found', code: 'NOT_FOUND' });
    return;
  }
  const problem = await watchScopeError(req.account!.id, { metric: existing.metric, ...parsed.data }, existing);
  if (problem) {
    res.status(400).json({ error: problem, code: 'VALIDATION_ERROR' });
    return;
  }
  const patch: Record<string, unknown> = { updated_at: db.fn.now() };
  for (const key of ['metric', 'care_profile_id', 'medication_id', 'threshold_days', 'critical_only', 'channel_id', 'cadence', 'enabled'] as const) {
    if (parsed.data[key] !== undefined) patch[key] = parsed.data[key];
  }
  if (parsed.data.label !== undefined) patch['label'] = parsed.data.label?.trim() || null;
  // Moving from immediate to a digest starts its clock now, so it does not fire
  // an entire period's backlog at once.
  if (parsed.data.cadence && parsed.data.cadence !== 'immediate' && existing.cadence === 'immediate') {
    patch['last_sent_at'] = db.fn.now();
  }
  const [watch] = await db('notification_watches').where({ id: existing.id }).update(patch).returning('*');
  res.json({ watch });
});

notificationsRouter.delete('/watches/:watchId', requireAuth, async (req, res) => {
  const deleted = await db('notification_watches')
    .where({ id: req.params['watchId'], account_id: req.account!.id })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Alert not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Alert removed.' });
});

/** Send a test message so the person can see the channel works. */
notificationsRouter.post('/channels/:channelId/test', requireAuth, async (req, res) => {
  const channel = (await db('notification_channels')
    .where({ id: req.params['channelId'], account_id: req.account!.id })
    .first()) as NotificationChannel | undefined;
  if (!channel) {
    res.status(404).json({ error: 'Channel not found', code: 'NOT_FOUND' });
    return;
  }
  try {
    await sendToChannel(channel, req.account!, [
      {
        key: `test:${Date.now()}`,
        kind: 'activity',
        profile_id: '',
        profile_name: 'PareCare',
        actor_name: 'PareCare',
        action: null,
        entity_type: null,
        summary: null,
        medication_name: null,
        missed_count: null,
        urgent: false,
        created_at: new Date().toISOString(),
        read: false,
      },
    ], 'PareCare test notification');
    res.json({ sent: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message, code: 'DELIVERY_FAILED' });
  }
});
