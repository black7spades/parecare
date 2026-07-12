import webpush from 'web-push';
import { db } from '../config/database';
import { env } from '../config/env';

/**
 * Web push: real notifications delivered to a browser or phone even when
 * PareCare is closed. VAPID keys identify this server to push services;
 * they come from the environment when set, otherwise a pair is generated
 * on first boot and kept in app_settings so it survives restarts (a
 * changed key would orphan every existing subscription).
 */

let configured = false;
let publicKey: string | null = null;

export async function initWebPush(): Promise<void> {
  let pub = process.env.VAPID_PUBLIC_KEY ?? null;
  let priv = process.env.VAPID_PRIVATE_KEY ?? null;

  if (!pub || !priv) {
    const rows = await db('app_settings').whereIn('key', ['vapid_public_key', 'vapid_private_key']).select('key', 'value');
    const byKey = new Map(rows.map((r) => [r.key, r.value as string | null]));
    pub = (byKey.get('vapid_public_key') as string | null) ?? null;
    priv = (byKey.get('vapid_private_key') as string | null) ?? null;
  }

  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    await db('app_settings')
      .insert([
        { key: 'vapid_public_key', value: JSON.stringify(pub), group: 'notifications' },
        { key: 'vapid_private_key', value: JSON.stringify(priv), group: 'notifications' },
      ])
      .onConflict('key')
      .ignore();
    console.log('Generated web push keys (stored in app_settings).');
  }

  // Values persisted via jsonb come back as parsed JSON strings already;
  // freshly generated ones are plain strings. Normalise both.
  const norm = (v: string) => {
    try {
      const parsed = JSON.parse(v);
      return typeof parsed === 'string' ? parsed : v;
    } catch {
      return v;
    }
  };
  pub = norm(pub);
  priv = norm(priv);

  webpush.setVapidDetails(`mailto:admin@${new URL(env.APP_URL).hostname}`, pub, priv);
  publicKey = pub;
  configured = true;
}

export function vapidPublicKey(): string | null {
  return publicKey;
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Send one push message. Returns false when the subscription is gone
 * (unsubscribed or expired), so the caller can disable the channel.
 */
export async function sendPush(
  subscription: PushSubscription,
  payload: { title: string; body: string; url: string }
): Promise<boolean> {
  if (!configured) return true;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return false;
    throw err;
  }
}
