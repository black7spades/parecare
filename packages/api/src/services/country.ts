import crypto from 'crypto';
import type { Knex } from 'knex';
import { db } from '../config/database';
import { env } from '../config/env';
import {
  COUNTRY_LIST,
  PRESETS_CHECKED_ON,
  SERVICE_KINDS,
  fundingScheme,
  inferCountry,
  isCountryCode,
  isServiceKind,
  preset,
  serviceKindLabel,
  type CountryCode,
  type ServiceDetails,
} from '../lib/countries';
import { ID_FIELDS } from './identifierFields';
import { setPhoneCountry } from '../lib/phoneText';

type Conn = Knex | Knex.Transaction;

/** Today on the server's own calendar, YYYY-MM-DD, never the UTC date. */
const localToday = (): string => new Date().toLocaleDateString('en-CA');

/**
 * Which country PareCare is used in, and the services people are sent to
 * there. Whoever runs PareCare picks the country once (a good guess is
 * offered from the server's clock and their browser); an account may pick
 * its own. On top of the built-in services, whoever runs PareCare can
 * change or add one for everyone, and an account owner for their own
 * account. "Back to the original" removes the change.
 */

// ---------------------------------------------------------------- country

interface CountrySettingsRow {
  id: number;
  country: string | null;
  confirmed_at: Date | null;
  confirmed_by_account_id: string | null;
  services_checked_on: string | Date | null;
  check_emailed_on: string | Date | null;
}

let cached: { at: number; row: CountrySettingsRow | null } | null = null;
const STALE_MS = 30_000;

const ymd = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
};

/** Read the country settings into memory; done at boot and after each change. */
export async function loadCountrySettings(conn: Conn = db): Promise<CountrySettingsRow | null> {
  try {
    const row = ((await conn('country_settings').where({ id: 1 }).first()) as CountrySettingsRow | undefined) ?? null;
    cached = { at: Date.now(), row };
    // Phone numbers in notes and steps are read the way this country writes them.
    setPhoneCountry(isCountryCode(row?.country) ? row!.country : guessedCountry());
    return row;
  } catch (err) {
    // Before migrations have run there is no table to read yet.
    if ((err as { code?: string }).code === '42P01') {
      cached = { at: Date.now(), row: null };
      return null;
    }
    // Any other failure keeps the last good answer, so a database hiccup
    // never switches the country, its currency or its services.
    throw err;
  }
}

/** The server's own guess, used until a country has been picked. */
export function guessedCountry(): CountryCode {
  const fromEnv = String(env.COUNTRY ?? '').toUpperCase();
  if (isCountryCode(fromEnv)) return fromEnv;
  let zone: string | undefined;
  try {
    zone = process.env['TZ'] || Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    zone = undefined;
  }
  return inferCountry(zone, process.env['LANG'] ?? null);
}

/** The country this PareCare is set to, for everyone without their own. */
export function systemCountry(): CountryCode {
  if (!cached || Date.now() - cached.at > STALE_MS) void loadCountrySettings().catch((err) => console.warn('Country settings could not be read; keeping the last ones:', (err as Error).message));
  const c = cached?.row?.country;
  return isCountryCode(c) ? c : guessedCountry();
}

export async function systemCountryNow(conn: Conn = db): Promise<CountryCode> {
  const row = await loadCountrySettings(conn);
  return isCountryCode(row?.country) ? (row!.country as CountryCode) : guessedCountry();
}

export async function setSystemCountry(conn: Conn, country: CountryCode, actorId: string | null): Promise<void> {
  const before = await systemCountryNow(conn);
  const today = localToday();
  const existing = await conn('country_settings').where({ id: 1 }).first('id', 'services_checked_on');
  const cols = { country, confirmed_at: conn.fn.now(), confirmed_by_account_id: actorId, updated_at: conn.fn.now() };
  if (existing) await conn('country_settings').where({ id: 1 }).update(cols);
  // The details shipped were checked when this release was made, so the first
  // yearly check falls a year from picking the country.
  else await conn('country_settings').insert({ id: 1, ...cols, services_checked_on: today });
  if (before !== country) {
    const accounts = (await conn('accounts').whereNull('country').pluck('id')) as string[];
    await renameCountryWords(conn, accounts, before, country);
  }
  await loadCountrySettings(conn);
}

export async function accountCountry(conn: Conn, accountId: string | null | undefined): Promise<CountryCode> {
  if (accountId) {
    const row = (await conn('accounts').where({ id: accountId }).first('country')) as { country: string | null } | undefined;
    if (isCountryCode(row?.country)) return row!.country as CountryCode;
  }
  return systemCountry();
}

/** The country of whoever holds a person's profile: everything about them follows it. */
export async function profileCountry(conn: Conn, profileId: string): Promise<CountryCode> {
  const row = (await conn('care_profiles as p').leftJoin('accounts as a', 'a.id', 'p.account_id').where('p.id', profileId).first('a.country')) as
    | { country: string | null }
    | undefined;
  return isCountryCode(row?.country) ? (row!.country as CountryCode) : systemCountry();
}

export async function profileAccountId(conn: Conn, profileId: string): Promise<string | null> {
  const row = (await conn('care_profiles').where({ id: profileId }).first('account_id')) as { account_id: string | null } | undefined;
  return row?.account_id ?? null;
}

/** An account picks its own country, or goes back to the one PareCare is set to. */
export async function setAccountCountry(conn: Conn, accountId: string, country: CountryCode | null): Promise<void> {
  const before = await accountCountry(conn, accountId);
  await conn('accounts').where({ id: accountId }).update({ country, updated_at: conn.fn.now() });
  const after = country ?? systemCountry();
  if (before !== after) await renameCountryWords(conn, [accountId], before, after);
}

/**
 * Built-in names that differ by country, such as the document category for
 * an advance care directive, follow a change of country unless someone has
 * renamed them.
 */
async function renameCountryWords(conn: Conn, accountIds: string[], from: CountryCode, to: CountryCode): Promise<void> {
  if (!accountIds.length) return;
  // Referral end dates worked out by the old country's rule are worked out again, or cleared.
  if (!!preset(from).referral !== !!preset(to).referral || preset(from).referral?.gp_months !== preset(to).referral?.gp_months) {
    const { refreshReferrals } = await import('./documentDates');
    for (let i = 0; i < accountIds.length; i += 500) {
      const profiles = (await conn('care_profiles').whereIn('account_id', accountIds.slice(i, i + 500)).pluck('id')) as string[];
      for (const pid of profiles) await refreshReferrals(conn, pid);
    }
  }
  // Open "ask for a progress report" tasks name the review the new country's way.
  for (let i = 0; i < accountIds.length; i += 500) {
    const open = (await conn('reminders as r')
      .join('funding_plans as fp', 'fp.id', 'r.funding_plan_id')
      .join('care_profiles as cp', 'cp.id', 'r.care_profile_id')
      .whereIn('cp.account_id', accountIds.slice(i, i + 500))
      .where('r.completed', false)
      .select('r.id', 'r.title', 'fp.scheme')) as Array<{ id: string; title: string; scheme: string }>;
    for (const t of open) {
      const m = /^Ask (.+) for a progress report for the .+ review$/.exec(t.title);
      if (!m) continue;
      const title = `Ask ${m[1]} for a progress report for the ${fundingScheme(to, t.scheme).review_word} review`;
      if (title !== t.title) await conn('reminders').where({ id: t.id }).update({ title: title.slice(0, 255) });
    }
  }
  const was = preset(from).words.advance_directive;
  const now = preset(to).words.advance_directive;
  if (was === now) return;
  for (let i = 0; i < accountIds.length; i += 500) {
    await conn('document_categories')
      .whereIn('account_id', accountIds.slice(i, i + 500))
      .where({ system_key: 'advance_care_directive', name: was })
      .update({ name: now });
  }
}

// ---------------------------------------------------------------- services

export type ServiceSource = 'original' | 'everyone' | 'own';

export interface EffectiveService extends ServiceDetails {
  kind: string;
  /** What it is for: "Support for carers". */
  label: string;
  /** Where the details come from: built in, changed for everyone, or changed for this account. */
  source: ServiceSource;
  /** Whether there is a built-in version to go back to. */
  has_original: boolean;
  /** Added by someone, not one of the built-in kinds. */
  added: boolean;
  /** The last day someone checked these details were right. */
  checked_on: string | null;
  /** Nothing to call or open yet. */
  missing: boolean;
}

interface ServiceRow {
  id: string;
  account_id: string | null;
  country: string;
  kind: string;
  label: string | null;
  is_own: boolean;
  name: string | null;
  phone: string | null;
  website: string | null;
  checked_on: string | Date | null;
}

const later = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Every service for a country, as one account sees it: the built-in
 * details, then anything changed for everyone, then anything the account
 * changed for itself. With no account, what everyone sees.
 */
export async function effectiveServices(conn: Conn, country: CountryCode, accountId: string | null): Promise<EffectiveService[]> {
  const rows = (await conn('country_services')
    .where({ country })
    .where((w) => {
      w.whereNull('account_id');
      if (accountId) w.orWhere('account_id', accountId);
    })
    .select('*')) as ServiceRow[];
  const everyone = new Map(rows.filter((r) => !r.account_id).map((r) => [r.kind, r]));
  const mine = new Map(rows.filter((r) => r.account_id).map((r) => [r.kind, r]));
  const builtIn = preset(country).services;
  const out: EffectiveService[] = [];
  const kinds = [
    ...SERVICE_KINDS.map((k) => k.key as string),
    ...rows.filter((r) => !isServiceKind(r.kind)).map((r) => r.kind).filter((k, i, a) => a.indexOf(k) === i),
  ];
  for (const kind of kinds) {
    const original = isServiceKind(kind) ? builtIn[kind] ?? null : null;
    const hasOriginal = !!original && !!(original.name || original.phone || original.website);
    const e = everyone.get(kind);
    const m = mine.get(kind);
    let details: ServiceDetails = original ?? { name: null, phone: null, website: null };
    let source: ServiceSource = 'original';
    let checked: string | null = hasOriginal ? PRESETS_CHECKED_ON : null;
    if (e) {
      if (e.is_own) {
        details = { name: e.name, phone: e.phone, website: e.website };
        source = 'everyone';
        checked = ymd(e.checked_on);
      } else checked = later(checked, ymd(e.checked_on));
    }
    if (m) {
      if (m.is_own) {
        details = { name: m.name, phone: m.phone, website: m.website };
        source = 'own';
        checked = ymd(m.checked_on);
      } else checked = later(checked, ymd(m.checked_on));
    }
    const label = isServiceKind(kind) ? serviceKindLabel(kind) : (m?.label ?? e?.label ?? 'Service');
    out.push({
      kind,
      label,
      ...details,
      source,
      has_original: hasOriginal,
      added: !isServiceKind(kind),
      checked_on: checked,
      missing: !(details.phone || details.website),
    });
  }
  return out;
}

/** One kind of service for a person, where they live, as their account sees it. */
export async function serviceForProfile(conn: Conn, profileId: string, kind: string): Promise<EffectiveService | null> {
  const country = await profileCountry(conn, profileId);
  const accountId = await profileAccountId(conn, profileId);
  return (await effectiveServices(conn, country, accountId)).find((s) => s.kind === kind) ?? null;
}

/** Every service for a person, by kind, for a page that shows several. */
export async function servicesForProfile(conn: Conn, profileId: string): Promise<Map<string, EffectiveService>> {
  const country = await profileCountry(conn, profileId);
  const accountId = await profileAccountId(conn, profileId);
  return new Map((await effectiveServices(conn, country, accountId)).map((s) => [s.kind, s]));
}

export class ServiceProblem extends Error {}

const clean = (v: string | null | undefined, max: number): string | null => {
  const t = String(v ?? '').trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
};

/** "www.quit.org.au" is https://www.quit.org.au; anything that is not a web address is refused. */
export function websiteOf(v: string | null | undefined): string | null | 'bad' {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!/\./.test(u.hostname)) return 'bad';
    return u.toString();
  } catch {
    return 'bad';
  }
}

export interface ServiceInput {
  name?: string | null;
  phone?: string | null;
  website?: string | null;
  label?: string | null;
}

function checkInput(input: ServiceInput, needLabel: boolean): { name: string | null; phone: string | null; website: string | null; label: string | null } {
  const name = clean(input.name, 160);
  const phone = clean(input.phone, 50);
  const site = websiteOf(input.website);
  const label = clean(input.label, 160);
  const missing: string[] = [];
  if (needLabel && !label) missing.push('What it is for');
  if (!name) missing.push('Name');
  if (!phone && (!site || site === 'bad')) missing.push('Phone or Website');
  if (missing.length) throw new ServiceProblem(`Fill in ${missing.join(' and ')}.`);
  if (site === 'bad') throw new ServiceProblem('That website does not look right. Type it as it shows in the address bar, such as www.example.org.');
  if (phone && !/\d/.test(phone)) throw new ServiceProblem('That phone number has no digits in it.');
  return { name, phone, website: site, label };
}

type Scope = { accountId: string | null; country: CountryCode };

/** A service someone added for everyone, which is not one of the built-in kinds. */
const addedForEveryone = (conn: Conn, country: CountryCode, kind: string) =>
  conn('country_services').whereNull('account_id').where({ country, kind, is_own: true }).first('id', 'label');

const scoped = (conn: Conn, s: Scope, kind: string) => {
  const q = conn('country_services').where({ country: s.country, kind });
  return s.accountId ? q.where({ account_id: s.accountId }) : q.whereNull('account_id');
};

/** Change a service's details, for everyone or for one account. Today counts as checked. */
export async function saveService(conn: Conn, s: Scope & { kind: string; actorId: string | null; input: ServiceInput }): Promise<void> {
  // A built-in kind, or one added for everyone that an account changes for itself.
  const known = isServiceKind(s.kind) || (!!s.accountId && !!(await addedForEveryone(conn, s.country, s.kind)));
  const existing = (await scoped(conn, s, s.kind).first()) as ServiceRow | undefined;
  if (!known && !existing) throw new ServiceProblem('That service was not found.');
  const v = checkInput(s.input, !known && !existing?.label && !s.input.label);
  const today = localToday();
  const cols = {
    is_own: true,
    name: v.name,
    phone: v.phone,
    website: v.website,
    checked_on: today,
    updated_by_account_id: s.actorId,
    updated_at: conn.fn.now(),
    ...(known ? {} : { label: v.label ?? existing?.label ?? null }),
  };
  if (existing) await conn('country_services').where({ id: existing.id }).update(cols);
  else await conn('country_services').insert({ account_id: s.accountId, country: s.country, kind: s.kind, ...cols });
}

/** Add a service that is not built in. */
export async function addService(conn: Conn, s: Scope & { actorId: string | null; input: ServiceInput }): Promise<string> {
  const v = checkInput(s.input, true);
  const kind = `own_${crypto.randomBytes(6).toString('hex')}`;
  await conn('country_services').insert({
    account_id: s.accountId,
    country: s.country,
    kind,
    label: v.label,
    is_own: true,
    name: v.name,
    phone: v.phone,
    website: v.website,
    checked_on: localToday(),
    updated_by_account_id: s.actorId,
  });
  return kind;
}

/**
 * Back to the original: the change is removed and the built-in details
 * show again. An added service is removed. Returns what was there, so the
 * screen can offer Undo.
 */
export async function resetService(conn: Conn, s: Scope & { kind: string }): Promise<ServiceInput | null> {
  const existing = (await scoped(conn, s, s.kind).first()) as ServiceRow | undefined;
  if (!existing) return null;
  await conn('country_services').where({ id: existing.id }).delete();
  return { name: existing.name, phone: existing.phone, website: existing.website, label: existing.label };
}

/** Still right: today counts as checked, and nothing else changes. */
export async function markServiceChecked(conn: Conn, s: Scope & { kind: string; actorId: string | null }): Promise<void> {
  const existing = (await scoped(conn, s, s.kind).first()) as ServiceRow | undefined;
  const today = localToday();
  if (existing) await conn('country_services').where({ id: existing.id }).update({ checked_on: today, updated_by_account_id: s.actorId, updated_at: conn.fn.now() });
  else if (isServiceKind(s.kind) || (s.accountId && (await addedForEveryone(conn, s.country, s.kind))))
    await conn('country_services').insert({ account_id: s.accountId, country: s.country, kind: s.kind, is_own: false, checked_on: today, updated_by_account_id: s.actorId });
  else throw new ServiceProblem('That service was not found.');
}

// ---------------------------------------------------------------- the yearly check

export interface CheckTask {
  title: string;
  /** The day the check is due. */
  due_on: string;
  /** Due now or overdue. */
  due: boolean;
  last_done_on: string | null;
}

const addYear = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y + 1, m - 1, d));
  return t.toISOString().slice(0, 10);
};

/** "Check these services are still right": once a year, for whoever runs PareCare. */
export async function checkTask(conn: Conn = db): Promise<CheckTask> {
  const row = await loadCountrySettings(conn);
  const today = localToday();
  const last = ymd(row?.services_checked_on) ?? ymd(row?.confirmed_at as Date | null) ?? PRESETS_CHECKED_ON;
  const due_on = addYear(last);
  return { title: 'Check these services are still right', due_on, due: due_on <= today, last_done_on: ymd(row?.services_checked_on) };
}

/** The yearly check is done: every service counts as checked today. */
export async function finishCheck(conn: Conn, actorId: string | null): Promise<void> {
  const country = await systemCountryNow(conn);
  for (const k of SERVICE_KINDS) await markServiceChecked(conn, { accountId: null, country, kind: k.key, actorId });
  const added = (await conn('country_services').whereNull('account_id').where({ country }).pluck('kind')) as string[];
  for (const kind of added.filter((k) => !isServiceKind(k))) await markServiceChecked(conn, { accountId: null, country, kind, actorId });
  const today = localToday();
  const existing = await conn('country_settings').where({ id: 1 }).first('id');
  if (existing) await conn('country_settings').where({ id: 1 }).update({ services_checked_on: today, check_emailed_on: null, updated_at: conn.fn.now() });
  else await conn('country_settings').insert({ id: 1, country, services_checked_on: today });
  await loadCountrySettings(conn);
}

/**
 * Once a day: when the yearly check falls due, tell whoever runs PareCare
 * by email, once, with a link to the check. The task also shows on their
 * home page until it is done.
 */
export async function remindYearlyCheck(): Promise<void> {
  const task = await checkTask();
  if (!task.due) return;
  const row = await loadCountrySettings();
  if (row && ymd(row.check_emailed_on) && ymd(row.check_emailed_on)! >= task.due_on) return;
  const admin = (await db('accounts').where({ role: 'super_admin' }).orderBy('created_at', 'asc').first('email')) as { email: string | null } | undefined;
  if (!admin?.email) return;
  const { sendNotificationEmail } = await import('./email');
  try {
    await sendNotificationEmail(admin.email, 'Check the services in PareCare are still right', [
      { text: 'Once a year, check the national services PareCare sends people to: their names, numbers and websites.', url: `${env.APP_URL}/system/country` },
    ]);
  } catch (err) {
    // Not sent, so not recorded: it is tried again tomorrow. The task still shows on their home page.
    console.warn('Yearly services check email failed:', (err as Error).message);
    return;
  }
  const today = localToday();
  if (row) await db('country_settings').where({ id: 1 }).update({ check_emailed_on: today });
  else await db('country_settings').insert({ id: 1, check_emailed_on: today });
  await loadCountrySettings();
}

let timer: NodeJS.Timeout | null = null;
export function startCountryScheduler(): void {
  if (timer) return;
  void loadCountrySettings();
  const tick = () => remindYearlyCheck().catch((err) => console.warn('Yearly services check:', (err as Error).message));
  setTimeout(tick, 60_000).unref();
  timer = setInterval(tick, 24 * 3600_000);
  timer.unref();
}

// ---------------------------------------------------------------- for the screen

/** What the web app needs to speak and format for a country. */
export function countryConfig(code: CountryCode) {
  const p = preset(code);
  return {
    code: p.code,
    name: p.name,
    locale: p.locale,
    date_order: p.date_order,
    clock: p.clock,
    dial_code: p.dial_code,
    phone_example: p.phone_example,
    currency: p.currency,
    id_groups: p.id_groups.map((g) => ({
      legend: g.legend,
      fields: g.fields.map((f) => {
        const def = ID_FIELDS[f.key];
        return { key: f.key, label: f.label ?? def.label, kind: def.kind, hint: def.hint ?? null, placeholder: def.placeholder ?? null, numeric: !!def.numeric, options: def.options ?? null };
      }),
    })),
    funding: p.funding,
    cost_sources: p.cost_sources,
    has_referral_rule: !!p.referral,
    words: p.words,
    sample_address: p.sample_address,
  };
}
export type CountryConfig = ReturnType<typeof countryConfig>;

export const countryChoices = () => COUNTRY_LIST;
