import { db } from '../config/database';
import { env } from '../config/env';
import { sendNotificationEmail } from './email';
import { sendPush, type PushSubscription } from './webpush';
import { gatherNotifications, notificationPath, notificationText, type NotificationItem } from './notifications';
import type { Account } from '../types';

/**
 * Outbound notification delivery. Every minute, each enabled channel is
 * brought up to date: urgent alerts go out the moment they arise (when the
 * channel asks for that), everything else is bundled into a digest at the
 * channel's chosen rhythm. notification_deliveries records what each
 * channel has been sent, so nothing ever goes out twice.
 *
 * Channels: email, web push (a browser or phone), a Discord webhook, a
 * Telegram chat, or a generic webhook. The generic webhook receives plain
 * JSON, so anything that can accept an HTTP POST (Slack, Matrix bridges,
 * WhatsApp gateways like Twilio, home automation) can be wired up.
 */

export interface NotificationChannel {
  id: string;
  account_id: string;
  kind: 'email' | 'webpush' | 'discord' | 'telegram' | 'webhook';
  label: string;
  config: Record<string, unknown>;
  urgent_instantly: boolean;
  digest: 'off' | 'daily' | 'weekly' | 'monthly';
  enabled: boolean;
  last_digest_at: string | Date | null;
}

const DIGEST_MS: Record<string, number> = {
  daily: 24 * 3600 * 1000,
  weekly: 7 * 24 * 3600 * 1000,
  monthly: 30 * 24 * 3600 * 1000,
};

const linkOf = (item: NotificationItem) => `${env.APP_URL}${notificationPath(item)}`;

/** Deliver a batch of items over one channel. Throws on a hard failure. */
export async function sendToChannel(
  channel: NotificationChannel,
  account: Pick<Account, 'email' | 'display_name'>,
  items: NotificationItem[],
  heading: string
): Promise<void> {
  const lines = items.map((i) => ({ text: notificationText(i), url: linkOf(i) }));

  switch (channel.kind) {
    case 'email': {
      const to = (channel.config['address'] as string) || account.email;
      await sendNotificationEmail(to, heading, lines);
      return;
    }
    case 'webpush': {
      const subscription = channel.config['subscription'] as PushSubscription | undefined;
      if (!subscription) throw new Error('This device subscription is incomplete.');
      // One push per item so each notification opens its own page; push
      // payloads are small and per-item is how phones display them anyway.
      for (const item of items) {
        const alive = await sendPush(subscription, {
          title: item.urgent ? 'PareCare: urgent' : 'PareCare',
          body: notificationText(item),
          url: linkOf(item),
        });
        if (!alive) {
          // The browser unsubscribed (cleared data, revoked permission).
          await db('notification_channels').where({ id: channel.id }).update({ enabled: false, updated_at: db.fn.now() });
          throw new Error('This device is no longer subscribed to push.');
        }
      }
      return;
    }
    case 'discord': {
      const url = channel.config['webhook_url'] as string | undefined;
      if (!url) throw new Error('The Discord webhook URL is missing.');
      const content = [`**${heading}**`, ...lines.map((l) => `- ${l.text} ${l.url}`)].join('\n').slice(0, 1900);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Discord rejected the message (${res.status}).`);
      return;
    }
    case 'telegram': {
      const token = channel.config['bot_token'] as string | undefined;
      const chatId = channel.config['chat_id'] as string | undefined;
      if (!token || !chatId) throw new Error('The Telegram bot token or chat id is missing.');
      const text = [heading, ...lines.map((l) => `- ${l.text} ${l.url}`)].join('\n').slice(0, 4000);
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) throw new Error(`Telegram rejected the message (${res.status}).`);
      return;
    }
    case 'webhook': {
      const url = channel.config['url'] as string | undefined;
      if (!url) throw new Error('The webhook URL is missing.');
      const secret = channel.config['secret'] as string | undefined;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'X-PareCare-Secret': secret } : {}),
        },
        body: JSON.stringify({
          source: 'parecare',
          event: 'notifications',
          heading,
          items: items.map((i) => ({
            key: i.key,
            kind: i.kind,
            urgent: i.urgent,
            text: notificationText(i),
            url: linkOf(i),
            profile_id: i.profile_id,
            created_at: i.created_at,
          })),
        }),
      });
      if (!res.ok) throw new Error(`The webhook endpoint rejected the message (${res.status}).`);
      return;
    }
  }
}

/** Record what a channel has been sent, so it is never sent again. */
async function markDelivered(channelId: string, items: NotificationItem[]): Promise<void> {
  if (items.length === 0) return;
  await db('notification_deliveries')
    .insert(items.map((i) => ({ channel_id: channelId, item_key: i.key })))
    .onConflict(['channel_id', 'item_key'])
    .ignore();
}

async function deliverForAccount(account: Account, channels: NotificationChannel[]): Promise<void> {
  const items = await gatherNotifications(account);
  if (items.length === 0) return;

  for (const channel of channels) {
    const delivered = new Set(
      (
        await db('notification_deliveries')
          .where({ channel_id: channel.id })
          .whereIn('item_key', items.map((i) => i.key))
          .select('item_key')
      ).map((r) => r.item_key as string)
    );
    const unsent = items.filter((i) => !delivered.has(i.key));
    if (unsent.length === 0) continue;

    try {
      if (channel.urgent_instantly) {
        const urgent = unsent.filter((i) => i.urgent);
        if (urgent.length > 0) {
          await sendToChannel(channel, account, urgent, urgent.length === 1 ? 'Urgent care alert' : `${urgent.length} urgent care alerts`);
          await markDelivered(channel.id, urgent);
        }
      }

      if (channel.digest !== 'off') {
        const period = DIGEST_MS[channel.digest] ?? DIGEST_MS['daily'];
        const last = channel.last_digest_at ? new Date(channel.last_digest_at).getTime() : 0;
        if (Date.now() - last >= period) {
          const remaining = unsent.filter((i) => !(channel.urgent_instantly && i.urgent));
          if (remaining.length > 0) {
            await sendToChannel(
              channel,
              account,
              remaining,
              `Your PareCare ${channel.digest} digest: ${remaining.length} ${remaining.length === 1 ? 'update' : 'updates'}`
            );
            await markDelivered(channel.id, remaining);
          }
          await db('notification_channels').where({ id: channel.id }).update({ last_digest_at: db.fn.now(), updated_at: db.fn.now() });
        }
      }
    } catch (err) {
      console.warn(`Notification delivery failed for channel ${channel.id} (${channel.kind}):`, (err as Error).message);
    }
  }
}

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const channels = (await db('notification_channels').where({ enabled: true })) as NotificationChannel[];
    if (channels.length === 0) return;
    const byAccount = new Map<string, NotificationChannel[]>();
    for (const c of channels) {
      const arr = byAccount.get(c.account_id) ?? [];
      arr.push(c);
      byAccount.set(c.account_id, arr);
    }
    const accounts = (await db<Account>('accounts').whereIn('id', [...byAccount.keys()]).whereNull('disabled_at')) as Account[];
    for (const account of accounts) {
      await deliverForAccount(account, byAccount.get(account.id) ?? []).catch((err) =>
        console.warn(`Notification delivery failed for account ${account.id}:`, (err as Error).message)
      );
    }
  } finally {
    running = false;
  }
}

export function startNotificationScheduler(): void {
  const run = () => {
    void tick()
      .catch((err) => console.error('Notification scheduler error:', (err as Error).message))
      .finally(() => setTimeout(run, 60_000));
  };
  setTimeout(run, 10_000);
  console.log('Notification delivery scheduler running (every 60s).');
}
