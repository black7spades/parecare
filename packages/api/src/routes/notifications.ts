import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { isValidTimeZone } from '../lib/timezone';
import { gatherNotifications, prefsOf } from '../services/notifications';
import { sendToChannel, type NotificationChannel } from '../services/notifier';
import { vapidPublicKey } from '../services/webpush';

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
