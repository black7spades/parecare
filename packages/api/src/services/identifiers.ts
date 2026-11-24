import type { Knex } from 'knex';
import { db } from '../config/database';
import { resolveOptions } from '../routes/optionCatalogue';

type Conn = Knex | Knex.Transaction;

/**
 * A person's ID numbers, each its own field. Every number is checked against
 * the shape it should have. A number that fails is not saved and says what it
 * should look like; the rest of the numbers still save.
 */
export interface Identifiers {
  medicare_number: string | null;
  medicare_irn: number | null;
  /** The last day of the month printed on the card, YYYY-MM-DD. */
  medicare_valid_to: string | null;
  ihi_number: string | null;
  dva_number: string | null;
  dva_card_colour: 'gold' | 'white' | 'orange' | null;
  ndis_number: string | null;
  health_fund_name: string | null;
  health_fund_member_number: string | null;
  my_aged_care_number: string | null;
}

export const IDENTIFIER_FIELDS = [
  'medicare_number', 'medicare_irn', 'medicare_valid_to', 'ihi_number', 'dva_number', 'dva_card_colour',
  'ndis_number', 'health_fund_name', 'health_fund_member_number', 'my_aged_care_number',
] as const;
export type IdentifierField = (typeof IDENTIFIER_FIELDS)[number];

export const EMPTY_IDENTIFIERS: Identifiers = {
  medicare_number: null, medicare_irn: null, medicare_valid_to: null, ihi_number: null, dva_number: null,
  dva_card_colour: null, ndis_number: null, health_fund_name: null, health_fund_member_number: null, my_aged_care_number: null,
};

export const DVA_CARD_COLOURS = ['gold', 'white', 'orange'] as const;

const digitsOnly = (v: string) => v.replace(/[\s-]/g, '');

/** Medicare: 10 digits, the first 2 to 6, the 9th a check digit over the first 8. */
export function medicareProblem(raw: string): string | null {
  const n = digitsOnly(raw);
  const shape = 'That Medicare number does not look right. It has 10 digits.';
  if (!/^\d{10}$/.test(n)) return shape;
  if (!/^[2-6]/.test(n)) return 'That Medicare number does not look right. It starts with a 2, 3, 4, 5 or 6.';
  const weights = [1, 3, 7, 9, 1, 3, 7, 9];
  const sum = weights.reduce((s, w, i) => s + w * Number(n[i]), 0);
  if (sum % 10 !== Number(n[8])) return 'That Medicare number does not look right. Check each digit against the card.';
  return null;
}

const luhnOk = (n: string): boolean => {
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

/** IHI: 16 digits starting 800360, with a Luhn check. */
export function ihiProblem(raw: string): string | null {
  const n = digitsOnly(raw);
  if (!/^\d{16}$/.test(n) || !n.startsWith('800360')) return 'That Individual Healthcare Identifier does not look right. It has 16 digits and starts with 8003.';
  if (!luhnOk(n)) return 'That Individual Healthcare Identifier does not look right. Check each digit against My Health Record.';
  return null;
}

export function ndisProblem(raw: string): string | null {
  const n = digitsOnly(raw);
  return /^43\d{7}$/.test(n) ? null : 'That NDIS number does not look right. It has 9 digits and starts with 43.';
}

export function myAgedCareProblem(raw: string): string | null {
  const n = digitsOnly(raw).toUpperCase();
  return /^AC\d{8,9}$/.test(n) ? null : 'That My Aged Care number does not look right. It starts with AC, then 8 or 9 digits.';
}

export function dvaProblem(raw: string): string | null {
  const n = digitsOnly(raw).toUpperCase();
  return /^[A-Z0-9]{1,9}$/.test(n) ? null : 'That DVA file number does not look right. It has up to 9 letters and digits, such as NX123456.';
}

/** "2027-08", "08/2027", "8/27" or a full date, as the last day of that month. */
export function validToDate(raw: string): string | null {
  const t = raw.trim();
  let year: number | null = null;
  let month: number | null = null;
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(t);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
  } else if ((m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(t))) {
    month = Number(m[1]);
    year = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  }
  if (!year || !month || month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** The input for a save: any field, as typed. Empty clears it. */
export type IdentifierInput = Partial<Record<IdentifierField, string | number | null>>;

/**
 * Check each number given. Returns the columns to write, and a plain
 * sentence for each number that could not be used.
 */
export function checkIdentifiers(input: IdentifierInput): { values: Partial<Identifiers>; problems: Partial<Record<IdentifierField, string>> } {
  const values: Partial<Identifiers> = {};
  const problems: Partial<Record<IdentifierField, string>> = {};
  const text = (k: IdentifierField): string | null | undefined => {
    if (!(k in input)) return undefined;
    const v = input[k];
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };
  const take = (k: IdentifierField, problem: (s: string) => string | null, clean: (s: string) => string) => {
    const s = text(k);
    if (s === undefined) return;
    if (s === null) {
      (values as Record<string, unknown>)[k] = null;
      return;
    }
    const p = problem(s);
    if (p) problems[k] = p;
    else (values as Record<string, unknown>)[k] = clean(s);
  };
  take('medicare_number', medicareProblem, digitsOnly);
  take('ihi_number', ihiProblem, digitsOnly);
  take('ndis_number', ndisProblem, digitsOnly);
  take('my_aged_care_number', myAgedCareProblem, (s) => digitsOnly(s).toUpperCase());
  take('dva_number', dvaProblem, (s) => digitsOnly(s).toUpperCase());
  const irn = text('medicare_irn');
  if (irn !== undefined) {
    if (irn === null) values.medicare_irn = null;
    else if (/^[1-9]$/.test(irn)) values.medicare_irn = Number(irn);
    else problems.medicare_irn = 'The position on the card is one number from 1 to 9, printed beside the name.';
  }
  const validTo = text('medicare_valid_to');
  if (validTo !== undefined) {
    if (validTo === null) values.medicare_valid_to = null;
    else {
      const d = validToDate(validTo);
      if (d) values.medicare_valid_to = d;
      else problems.medicare_valid_to = 'The valid to date is a month and year, such as 08/2027.';
    }
  }
  const colour = text('dva_card_colour');
  if (colour !== undefined) {
    const c = colour?.toLowerCase() ?? null;
    if (c === null) values.dva_card_colour = null;
    else if ((DVA_CARD_COLOURS as readonly string[]).includes(c)) values.dva_card_colour = c as Identifiers['dva_card_colour'];
    else problems.dva_card_colour = 'The DVA card is gold, white or orange.';
  }
  const fund = text('health_fund_name');
  if (fund !== undefined) {
    if (fund && fund.length > 120) problems.health_fund_name = 'That health fund name is too long.';
    else values.health_fund_name = fund;
  }
  const member = text('health_fund_member_number');
  if (member !== undefined) {
    if (member && member.length > 30) problems.health_fund_member_number = 'That member number is too long. It has at most 30 letters and digits.';
    else values.health_fund_member_number = member ? member.replace(/\s+/g, ' ') : null;
  }
  return { values, problems };
}

const dateText = (v: unknown): string | null => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);

export async function identifiersFor(profileId: string, conn: Conn = db): Promise<Identifiers & { updated_at: string | null }> {
  const row = (await conn('profile_identifiers').where({ care_profile_id: profileId }).first()) as Record<string, unknown> | undefined;
  if (!row) return { ...EMPTY_IDENTIFIERS, updated_at: null };
  const out = { ...EMPTY_IDENTIFIERS } as Record<string, unknown>;
  for (const k of IDENTIFIER_FIELDS) out[k] = row[k] ?? null;
  out['medicare_valid_to'] = dateText(row['medicare_valid_to']);
  out['medicare_irn'] = row['medicare_irn'] == null ? null : Number(row['medicare_irn']);
  return { ...(out as unknown as Identifiers), updated_at: row['updated_at'] ? new Date(row['updated_at'] as string).toISOString() : null };
}

/**
 * Save the numbers that check out, leave the rest as they were, and say
 * which could not be used. Used by Edit profile and by Pare.
 */
export async function saveIdentifiers(
  profileId: string,
  accountId: string | null,
  input: IdentifierInput,
  conn: Conn = db
): Promise<{ identifiers: Identifiers; problems: Partial<Record<IdentifierField, string>>; saved: IdentifierField[] }> {
  const { values, problems } = checkIdentifiers(input);
  const saved = Object.keys(values) as IdentifierField[];
  if (saved.length) {
    const exists = await conn('profile_identifiers').where({ care_profile_id: profileId }).first('care_profile_id');
    const row = { ...values, updated_at: conn.fn.now(), updated_by_account_id: accountId };
    if (exists) await conn('profile_identifiers').where({ care_profile_id: profileId }).update(row);
    else await conn('profile_identifiers').insert({ care_profile_id: profileId, ...row });
    if (values.health_fund_name) await resolveOptions('health_fund', [values.health_fund_name], accountId ?? undefined);
  }
  const { updated_at: _u, ...identifiers } = await identifiersFor(profileId, conn);
  void _u;
  return { identifiers, problems, saved };
}

/** Each number with its plain label, in the order the sheet shows them. */
export const IDENTIFIER_LABELS: Record<IdentifierField, string> = {
  medicare_number: 'Medicare number',
  medicare_irn: 'Position on the card',
  medicare_valid_to: 'Valid to',
  ihi_number: 'Individual Healthcare Identifier',
  dva_number: 'DVA file number',
  dva_card_colour: 'DVA card colour',
  ndis_number: 'NDIS number',
  health_fund_name: 'Health fund',
  health_fund_member_number: 'Member number',
  my_aged_care_number: 'My Aged Care number',
};
