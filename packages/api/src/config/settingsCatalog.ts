import { z } from 'zod';

/**
 * The single source of truth for every setting that can be moved out of the
 * environment and edited at runtime by a super admin. The database only ever
 * stores overrides; this catalog defines the shape, validation, the env var
 * each key falls back to, and whether the value is a secret.
 *
 * Adding or removing a movable setting is a change here, not a data migration.
 */

export type SettingGroup = 'ai' | 'email' | 'oauth' | 'storage' | 'stripe' | 'scheduler' | 'health';
export type SettingType = 'string' | 'number' | 'enum';

export interface SettingEntry {
  key: string;
  group: SettingGroup;
  label: string;
  type: SettingType;
  enumValues?: readonly string[];
  secret: boolean;
  /** Environment variable this key falls back to when there is no DB override. */
  envKey: string;
  help?: string;
  /** Optional "how to get this" link shown next to the field. */
  helpLink?: { label: string; url: string };
  /** Validates an incoming value on write (after light coercion). */
  zod: z.ZodTypeAny;
}

const str = () => z.string();
const num = () => z.coerce.number();
const enom = (values: readonly [string, ...string[]]) => z.enum(values);

const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'ollama', 'lmstudio', 'openai-compatible'] as const;
const ON_OFF = ['on', 'off'] as const;
const EMAIL_PROVIDERS = ['smtp', 'sendgrid', 'resend'] as const;
const STORAGE_PROVIDERS = ['local', 's3'] as const;
// One currency for the whole account; every price is shown with its symbol.
const CURRENCIES = ['AUD', 'USD', 'GBP', 'EUR', 'NZD', 'CAD'] as const;

export const SETTINGS_CATALOG: readonly SettingEntry[] = [
  // AI assistant
  { key: 'ai.provider', group: 'ai', label: 'Provider', type: 'enum', enumValues: AI_PROVIDERS, secret: false, envKey: 'AI_PROVIDER', help: 'ollama and lmstudio are local OpenAI-compatible servers.', zod: enom(AI_PROVIDERS) },
  { key: 'ai.anthropic_api_key', group: 'ai', label: 'Anthropic API key', type: 'string', secret: true, envKey: 'ANTHROPIC_API_KEY', help: 'Starts with sk-ant-. Used when the provider is Anthropic.', helpLink: { label: 'Get an Anthropic key', url: 'https://console.anthropic.com/settings/keys' }, zod: str() },
  { key: 'ai.api_key', group: 'ai', label: 'API key (OpenAI / Gemini / compatible)', type: 'string', secret: true, envKey: 'AI_API_KEY', help: 'Used for every provider except Anthropic; optional for local servers. OpenAI keys start with sk-; Gemini keys come from Google AI Studio.', helpLink: { label: 'OpenAI keys', url: 'https://platform.openai.com/api-keys' }, zod: str() },
  { key: 'ai.base_url', group: 'ai', label: 'Base URL', type: 'string', secret: false, envKey: 'AI_BASE_URL', help: 'For self-hosted / compatible endpoints, ending in /v1.', zod: str() },
  { key: 'ai.model', group: 'ai', label: 'Model', type: 'string', secret: false, envKey: 'AI_MODEL', help: 'Leave blank to use the provider default.', zod: str() },
  { key: 'ai.mediation_model', group: 'ai', label: 'Mediation model', type: 'string', secret: false, envKey: 'AI_MEDIATION_MODEL', help: 'Optional stronger model for dispute mediation.', zod: str() },
  { key: 'ai.tokens_free', group: 'ai', label: 'Token limit: Free plan', type: 'number', secret: false, envKey: 'AI_TOKENS_FREE', zod: num() },
  { key: 'ai.tokens_family', group: 'ai', label: 'Token limit: Family plan', type: 'number', secret: false, envKey: 'AI_TOKENS_FAMILY', zod: num() },
  { key: 'ai.tokens_professional', group: 'ai', label: 'Token limit: Professional plan', type: 'number', secret: false, envKey: 'AI_TOKENS_PROFESSIONAL', help: '-1 means unlimited.', zod: num() },
  { key: 'messages.tone_guard', group: 'ai', label: 'Message tone guard', type: 'enum', enumValues: ON_OFF, secret: false, envKey: 'MESSAGE_TONE_GUARD', help: 'On by default. Checks each family message for a calm, care-focused tone before it posts, and asks the sender to revise anything hostile, off-topic, or dragging in old grievances. Only super admins and admins can turn this off.', zod: enom(ON_OFF) },

  // Email / SMTP
  { key: 'email.provider', group: 'email', label: 'Email provider', type: 'enum', enumValues: EMAIL_PROVIDERS, secret: false, envKey: 'EMAIL_PROVIDER', help: 'Only smtp is wired up today.', zod: enom(EMAIL_PROVIDERS) },
  { key: 'email.smtp_host', group: 'email', label: 'SMTP host', type: 'string', secret: false, envKey: 'SMTP_HOST', help: 'Leave blank to disable outgoing email.', zod: str() },
  { key: 'email.smtp_port', group: 'email', label: 'SMTP port', type: 'number', secret: false, envKey: 'SMTP_PORT', help: '465 uses TLS; anything else uses STARTTLS.', zod: num() },
  { key: 'email.smtp_user', group: 'email', label: 'SMTP username', type: 'string', secret: false, envKey: 'SMTP_USER', zod: str() },
  { key: 'email.smtp_pass', group: 'email', label: 'SMTP password', type: 'string', secret: true, envKey: 'SMTP_PASS', zod: str() },
  { key: 'email.from', group: 'email', label: 'From address', type: 'string', secret: false, envKey: 'EMAIL_FROM', zod: z.string().email() },

  // Health spend
  { key: 'health.currency', group: 'health', label: 'Currency', type: 'enum', enumValues: CURRENCIES, secret: false, envKey: 'HEALTH_CURRENCY', help: 'The single currency every cost and health-spend total is shown in, across the whole account.', zod: enom(CURRENCIES) },
  { key: 'health.financial_year_start_month', group: 'health', label: 'Financial year starts in', type: 'number', secret: false, envKey: 'HEALTH_FY_START_MONTH', help: 'The month the financial year begins, as a number 1 to 12. Australia is 7 (July); many places use 1 (January). Used by the financial-year view and the accounting export.', zod: z.coerce.number().int().min(1).max(12) },

  // Scheduler
  { key: 'scheduler.reminder_interval_ms', group: 'scheduler', label: 'Reminder check interval (ms)', type: 'number', secret: false, envKey: 'REMINDER_CHECK_INTERVAL_MS', help: '0 or less disables the reminder scheduler.', zod: num() },
  { key: 'mar.retention_months', group: 'scheduler', label: 'MAR retention (months)', type: 'number', secret: false, envKey: 'MAR_RETENTION_MONTHS', help: 'Medication administrations older than this are moved out of the live record into the archive (still viewable, never deleted). Default 12 months.', zod: z.coerce.number().int().min(1).max(120) },

  // OAuth sign-in
  { key: 'oauth.google_client_id', group: 'oauth', label: 'Google client ID', type: 'string', secret: false, envKey: 'GOOGLE_CLIENT_ID', help: 'Create an OAuth 2.0 Client ID (type: Web application) and register the redirect URI shown above.', helpLink: { label: 'Google Cloud credentials', url: 'https://console.cloud.google.com/apis/credentials' }, zod: str() },
  { key: 'oauth.google_client_secret', group: 'oauth', label: 'Google client secret', type: 'string', secret: true, envKey: 'GOOGLE_CLIENT_SECRET', help: 'Shown when you create the OAuth client, next to the client ID.', zod: str() },
  { key: 'oauth.facebook_app_id', group: 'oauth', label: 'Facebook app ID', type: 'string', secret: false, envKey: 'FACEBOOK_APP_ID', help: 'From your Meta app under App settings > Basic. Add the redirect URI under Facebook Login > Settings.', helpLink: { label: 'Meta apps', url: 'https://developers.facebook.com/apps' }, zod: str() },
  { key: 'oauth.facebook_app_secret', group: 'oauth', label: 'Facebook app secret', type: 'string', secret: true, envKey: 'FACEBOOK_APP_SECRET', help: 'App settings > Basic > App secret.', zod: str() },

  // Storage
  { key: 'storage.provider', group: 'storage', label: 'Storage provider', type: 'enum', enumValues: STORAGE_PROVIDERS, secret: false, envKey: 'STORAGE_PROVIDER', zod: enom(STORAGE_PROVIDERS) },
  { key: 'storage.local_path', group: 'storage', label: 'Local upload path', type: 'string', secret: false, envKey: 'STORAGE_LOCAL_PATH', zod: str() },
  { key: 'storage.s3_bucket', group: 'storage', label: 'S3 bucket', type: 'string', secret: false, envKey: 'S3_BUCKET', zod: str() },
  { key: 'storage.s3_region', group: 'storage', label: 'S3 region', type: 'string', secret: false, envKey: 'S3_REGION', zod: str() },
  { key: 'storage.s3_access_key', group: 'storage', label: 'S3 access key', type: 'string', secret: true, envKey: 'S3_ACCESS_KEY', zod: str() },
  { key: 'storage.s3_secret_key', group: 'storage', label: 'S3 secret key', type: 'string', secret: true, envKey: 'S3_SECRET_KEY', zod: str() },
  { key: 'storage.s3_endpoint', group: 'storage', label: 'S3 endpoint', type: 'string', secret: false, envKey: 'S3_ENDPOINT', help: 'For MinIO or other S3-compatible stores.', zod: str() },

  // Stripe billing
  { key: 'stripe.secret_key', group: 'stripe', label: 'Stripe secret key', type: 'string', secret: true, envKey: 'STRIPE_SECRET_KEY', help: 'Starts with sk_live_ (or sk_test_ for test mode).', helpLink: { label: 'Stripe API keys', url: 'https://dashboard.stripe.com/apikeys' }, zod: str() },
  { key: 'stripe.webhook_secret', group: 'stripe', label: 'Stripe webhook secret', type: 'string', secret: true, envKey: 'STRIPE_WEBHOOK_SECRET', help: 'Starts with whsec_. Create a webhook to <your site>/webhooks/stripe and copy its signing secret.', helpLink: { label: 'Stripe webhooks', url: 'https://dashboard.stripe.com/webhooks' }, zod: str() },
  { key: 'stripe.price_family', group: 'stripe', label: 'Family plan price ID', type: 'string', secret: false, envKey: 'STRIPE_PRICE_FAMILY', help: 'Starts with price_. From the product you created for the Family plan.', zod: str() },
  { key: 'stripe.price_professional', group: 'stripe', label: 'Professional plan price ID', type: 'string', secret: false, envKey: 'STRIPE_PRICE_PROFESSIONAL', help: 'Starts with price_. From the Professional plan product.', zod: str() },
] as const;

export const SETTINGS_BY_KEY = new Map(SETTINGS_CATALOG.map((e) => [e.key, e]));

export const SETTING_GROUPS: readonly SettingGroup[] = ['ai', 'health', 'email', 'scheduler', 'oauth', 'storage', 'stripe'];
