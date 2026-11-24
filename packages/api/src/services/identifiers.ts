import type { Knex } from 'knex';
import { db } from '../config/database';
import { resolveOptions } from '../routes/optionCatalogue';
import { preset, type CountryCode, type IdFieldKey } from '../lib/countries';
import { DVA_CARD_COLOURS, ID_FIELDS, ID_FIELD_KEYS, ihiProblem, medicareProblem } from './identifierFields';

export { DVA_CARD_COLOURS, ihiProblem, medicareProblem };

type Conn = Knex | Knex.Transaction;

/**
 * A person's ID numbers, each its own field. Which ones they are asked for
 * comes from their country: Medicare and the IHI in Australia, the NHS
 * number in the UK, and so on (lib/countries.ts). Every number is checked
 * against the shape it should have. A number that fails is not saved and
 * says what it should look like; the rest of the numbers still save.
 */
export type Identifiers = Record<Exclude<IdFieldKey, 'medicare_irn'>, string | null> & { medicare_irn: number | null };

export const IDENTIFIER_FIELDS = ID_FIELD_KEYS;
export type IdentifierField = IdFieldKey;

export const EMPTY_IDENTIFIERS = Object.fromEntries(ID_FIELD_KEYS.map((k) => [k, null])) as unknown as Identifiers;

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
  const values: Record<string, unknown> = {};
  const problems: Partial<Record<IdentifierField, string>> = {};
  for (const k of ID_FIELD_KEYS) {
    if (!(k in input)) continue;
    const raw = input[k];
    const s = raw === null || raw === undefined ? '' : String(raw).trim();
    if (s === '') {
      values[k] = null;
      continue;
    }
    const def = ID_FIELDS[k];
    if (def.kind === 'position') {
      if (/^[1-9]$/.test(s)) values[k] = Number(s);
      else problems[k] = 'The position on the card is one number from 1 to 9, printed beside the name.';
      continue;
    }
    if (def.kind === 'month') {
      const d = validToDate(s);
      if (d) values[k] = d;
      else problems[k] = 'The valid to date is a month and year, such as 08/2027.';
      continue;
    }
    if (def.kind === 'select') {
      const v = def.options!.find((o) => o.value.toLowerCase() === s.toLowerCase() || o.label.toLowerCase() === s.toLowerCase());
      if (v) values[k] = v.value;
      else problems[k] = `The ${def.label.toLowerCase()} is one of ${def.options!.map((o) => o.label).join(', ')}.`;
      continue;
    }
    const p = def.problem?.(s) ?? null;
    if (p) {
      problems[k] = p;
      continue;
    }
    if (s.length > def.max && !def.clean) {
      problems[k] = `That ${def.label.toLowerCase()} is too long. It has at most ${def.max} letters and digits.`;
      continue;
    }
    values[k] = def.clean ? def.clean(s) : s.replace(/\s+/g, ' ');
  }
  return { values: values as Partial<Identifiers>, problems };
}

const dateText = (v: unknown): string | null => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);

export async function identifiersFor(profileId: string, conn: Conn = db): Promise<Identifiers & { updated_at: string | null }> {
  const row = (await conn('profile_identifiers').where({ care_profile_id: profileId }).first()) as Record<string, unknown> | undefined;
  if (!row) return { ...EMPTY_IDENTIFIERS, updated_at: null };
  const out = { ...EMPTY_IDENTIFIERS } as Record<string, unknown>;
  for (const k of ID_FIELD_KEYS) out[k] = row[k] ?? null;
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

/** Each number with its plain label. */
export const IDENTIFIER_LABELS = Object.fromEntries(ID_FIELD_KEYS.map((k) => [k, ID_FIELDS[k].label])) as Record<IdentifierField, string>;

/** A number's label as the person's country names it: "Health fund" in Australia, "Insurer" in Canada. */
export function identifierLabel(country: CountryCode, key: IdentifierField): string {
  for (const g of preset(country).id_groups) {
    const f = g.fields.find((x) => x.key === key);
    if (f) return f.label ?? ID_FIELDS[key].label;
  }
  return ID_FIELDS[key].label;
}

/** The ID numbers the person's country uses, in order, with how the emergency sheet writes each. */
export function identifierLines(country: CountryCode, ids: Identifiers): Array<{ key: IdentifierField; label: string; value: string }> {
  const out: Array<{ key: IdentifierField; label: string; value: string }> = [];
  for (const g of preset(country).id_groups) {
    for (const f of g.fields) {
      const raw = ids[f.key];
      if (raw === null || raw === undefined || raw === '') continue;
      const def = ID_FIELDS[f.key];
      let value = String(raw);
      if (def.kind === 'month') value = `${value.slice(5, 7)}/${value.slice(0, 4)}`;
      else if (def.kind === 'select') value = def.options?.find((o) => o.value === value)?.label ?? value;
      else if (def.sheet) value = def.sheet(value);
      out.push({ key: f.key, label: f.label ?? def.label, value });
    }
  }
  return out;
}

/** The fields a country asks for, for Pare's instructions. */
export function identifierKeysFor(country: CountryCode): IdentifierField[] {
  return preset(country).id_groups.flatMap((g) => g.fields.map((f) => f.key));
}
