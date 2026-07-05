import { db } from './database';
import { env } from './env';
import { redis } from './redis';
import { encryptSecret, decryptSecret } from './secretbox';
import { SETTINGS_CATALOG, SETTINGS_BY_KEY, type SettingEntry } from './settingsCatalog';

/**
 * Effective runtime configuration = database override, then the environment
 * variable, then the catalog/env default. Values are cached in memory and
 * exposed through synchronous group accessors so the existing consumers stay
 * synchronous. The cache is refreshed at boot, whenever a super admin saves
 * (locally and, via Redis pub/sub, on other instances), and by a short TTL
 * backstop so it self-heals even if pub/sub is unavailable.
 */

type Source = 'db' | 'env' | 'default';

const INVALIDATE_CHANNEL = 'settings:invalidate';
const STALE_AFTER_MS = 30_000;

let valueByKey = new Map<string, string | number>();
let sourceByKey = new Map<string, Source>();
let loadedAt = 0;
let onChangeHook: (() => void) | null = null;

function envValue(entry: SettingEntry): string | number | undefined {
  const v = (env as Record<string, unknown>)[entry.envKey];
  if (v === undefined || v === null || v === '') return undefined;
  return v as string | number;
}

interface AppSettingRow {
  key: string;
  value: unknown;
  value_encrypted: string | null;
  is_secret: boolean;
}

export async function loadSettings(): Promise<void> {
  const rows = await db<AppSettingRow>('app_settings').select('*');
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  const nextValues = new Map<string, string | number>();
  const nextSources = new Map<string, Source>();

  for (const entry of SETTINGS_CATALOG) {
    const row = rowByKey.get(entry.key);
    let value: string | number | undefined;
    let source: Source = 'default';

    if (row) {
      try {
        if (entry.secret) {
          value = row.value_encrypted ? decryptSecret(row.value_encrypted) : undefined;
        } else {
          value = (row.value ?? undefined) as string | number | undefined;
        }
        if (value !== undefined && value !== null && value !== '') source = 'db';
      } catch (err) {
        console.warn(`Setting "${entry.key}" could not be read from the database; using environment fallback.`, (err as Error).message);
        value = undefined;
      }
    }

    if (value === undefined || value === null || value === '') {
      const fallback = envValue(entry);
      if (fallback !== undefined) {
        value = fallback;
        source = 'env';
      }
    }

    if (value !== undefined && value !== null && value !== '') {
      nextValues.set(entry.key, value);
      nextSources.set(entry.key, source);
    } else {
      nextSources.set(entry.key, 'default');
    }
  }

  valueByKey = nextValues;
  sourceByKey = nextSources;
  loadedAt = Date.now();
}

function maybeRefresh(): void {
  if (loadedAt === 0) return; // not initialised yet; caller boots it
  if (Date.now() - loadedAt > STALE_AFTER_MS) {
    void loadSettings().catch((err) => console.warn('Settings refresh failed:', (err as Error).message));
  }
}

function str(key: string): string | undefined {
  maybeRefresh();
  const v = valueByKey.get(key);
  return v === undefined ? undefined : String(v);
}

function numOr(key: string, fallback: number): number {
  maybeRefresh();
  const v = valueByKey.get(key);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// --- Group accessors -------------------------------------------------------

export type AiProvider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'lmstudio' | 'openai-compatible';

export function getAiConfig() {
  return {
    provider: (str('ai.provider') ?? 'anthropic') as AiProvider,
    model: str('ai.model'),
    mediationModel: str('ai.mediation_model'),
    baseUrl: str('ai.base_url'),
    anthropicApiKey: str('ai.anthropic_api_key'),
    apiKey: str('ai.api_key'),
    tokensFree: numOr('ai.tokens_free', 0),
    tokensFamily: numOr('ai.tokens_family', 100000),
    tokensProfessional: numOr('ai.tokens_professional', -1),
  };
}

export function getEmailConfig() {
  return {
    provider: str('email.provider') ?? 'smtp',
    smtpHost: str('email.smtp_host'),
    smtpPort: numOr('email.smtp_port', 587),
    smtpUser: str('email.smtp_user'),
    smtpPass: str('email.smtp_pass'),
    from: str('email.from') ?? 'noreply@parecare.app',
  };
}

export function getSchedulerConfig() {
  return {
    reminderIntervalMs: numOr('scheduler.reminder_interval_ms', 60000),
  };
}

export function getOAuthConfig() {
  return {
    googleClientId: str('oauth.google_client_id'),
    googleClientSecret: str('oauth.google_client_secret'),
    facebookAppId: str('oauth.facebook_app_id'),
    facebookAppSecret: str('oauth.facebook_app_secret'),
  };
}

export function getStorageConfig() {
  return {
    provider: (str('storage.provider') ?? 'local') as 'local' | 's3',
    localPath: str('storage.local_path') ?? '/app/uploads',
    s3Bucket: str('storage.s3_bucket'),
    s3Region: str('storage.s3_region') ?? 'us-east-1',
    s3AccessKey: str('storage.s3_access_key'),
    s3SecretKey: str('storage.s3_secret_key'),
    s3Endpoint: str('storage.s3_endpoint'),
  };
}

export function getStripeConfig() {
  return {
    secretKey: str('stripe.secret_key'),
    webhookSecret: str('stripe.webhook_secret'),
    priceFamily: str('stripe.price_family'),
    priceProfessional: str('stripe.price_professional'),
  };
}

// --- Describe (for the settings API; secrets masked) -----------------------

export interface SettingDescriptor {
  key: string;
  group: string;
  label: string;
  type: string;
  enumValues?: readonly string[];
  secret: boolean;
  help?: string;
  helpLink?: { label: string; url: string };
  source: Source;
  value?: string | number | null;
  isSet?: boolean;
}

export function describeSettings(): SettingDescriptor[] {
  maybeRefresh();
  return SETTINGS_CATALOG.map((entry) => {
    const base: SettingDescriptor = {
      key: entry.key,
      group: entry.group,
      label: entry.label,
      type: entry.type,
      enumValues: entry.enumValues,
      secret: entry.secret,
      help: entry.help,
      helpLink: entry.helpLink,
      source: sourceByKey.get(entry.key) ?? 'default',
    };
    if (entry.secret) {
      base.isSet = valueByKey.has(entry.key);
    } else {
      base.value = valueByKey.get(entry.key) ?? null;
    }
    return base;
  });
}

// --- Writes ----------------------------------------------------------------

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400, code: 'BAD_REQUEST' });
}

/**
 * Apply a batch of setting changes. For each key: null or empty string clears
 * the override (reverting to env/default); any other value is validated,
 * (encrypted if secret,) and upserted. Refreshes the local cache, notifies
 * other instances, and re-arms anything that depends on the changed values.
 */
export async function updateSettings(
  entries: Record<string, unknown>,
  actorId: string | null
): Promise<void> {
  const keys = Object.keys(entries);
  if (keys.length === 0) return;

  // Validate everything before writing anything.
  const writes: Array<{ entry: SettingEntry; value: unknown } | { entry: SettingEntry; clear: true }> = [];
  for (const key of keys) {
    const entry = SETTINGS_BY_KEY.get(key);
    if (!entry) throw badRequest(`Unknown setting: ${key}`);
    const raw = entries[key];
    if (raw === null || raw === '') {
      writes.push({ entry, clear: true });
      continue;
    }
    const parsed = entry.zod.safeParse(raw);
    if (!parsed.success) {
      throw badRequest(`Invalid value for ${key}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    }
    writes.push({ entry, value: parsed.data });
  }

  for (const w of writes) {
    if ('clear' in w) {
      await db('app_settings').where({ key: w.entry.key }).del();
      continue;
    }
    const { entry, value } = w;
    const row: Record<string, unknown> = {
      key: entry.key,
      is_secret: entry.secret,
      group: entry.group,
      updated_by: actorId,
      updated_at: db.fn.now(),
    };
    if (entry.secret) {
      row['value'] = null;
      row['value_encrypted'] = encryptSecret(String(value));
    } else {
      row['value'] = db.raw('?::jsonb', [JSON.stringify(value)]);
      row['value_encrypted'] = null;
    }
    await db('app_settings').insert(row).onConflict('key').merge();
  }

  await loadSettings();
  await publishInvalidate();
  onChangeHook?.();
}

// --- Seeding ---------------------------------------------------------------

/**
 * On first boot, copy current environment values into the settings table so
 * the screen shows real values and DB overrides thereafter. Idempotent: only
 * fills keys that have no row yet (also auto-seeds keys added in later releases).
 */
export async function seedSettingsFromEnv(): Promise<void> {
  const existing = new Set((await db('app_settings').select('key')).map((r: { key: string }) => r.key));
  const toInsert: Record<string, unknown>[] = [];
  for (const entry of SETTINGS_CATALOG) {
    if (existing.has(entry.key)) continue;
    const value = envValue(entry);
    if (value === undefined) continue;
    if (entry.secret) {
      toInsert.push({ key: entry.key, value: null, value_encrypted: encryptSecret(String(value)), is_secret: true, group: entry.group });
    } else {
      toInsert.push({ key: entry.key, value: db.raw('?::jsonb', [JSON.stringify(value)]), value_encrypted: null, is_secret: false, group: entry.group });
    }
  }
  if (toInsert.length > 0) {
    await db('app_settings').insert(toInsert).onConflict('key').ignore();
  }
}

// --- Cross-instance invalidation ------------------------------------------

let subscriber: ReturnType<typeof redis.duplicate> | null = null;

export async function subscribeSettingsInvalidation(): Promise<void> {
  try {
    subscriber = redis.duplicate();
    subscriber.on('error', (err) => console.warn('Settings subscriber error:', err.message));
    await subscriber.connect();
    await subscriber.subscribe(INVALIDATE_CHANNEL, () => {
      void loadSettings().catch((err) => console.warn('Settings reload failed:', (err as Error).message));
    });
  } catch (err) {
    console.warn('Could not subscribe to settings invalidation (single-instance is fine):', (err as Error).message);
  }
}

async function publishInvalidate(): Promise<void> {
  try {
    await redis.publish(INVALIDATE_CHANNEL, '1');
  } catch {
    // Redis unavailable; the TTL backstop will pick up the change.
  }
}

/** Register a callback invoked after settings change (e.g. re-arm the scheduler). */
export function onSettingsChange(fn: () => void): void {
  onChangeHook = fn;
}
