import type { IdFieldKey } from '../lib/countries';

/**
 * Every ID number PareCare can hold, each its own field, with what it is
 * called, what it looks like and how it is checked. Which ones a person is
 * asked for comes from their country (lib/countries.ts).
 */

export interface IdFieldDef {
  label: string;
  /** text: a box; month: a month and year; select: a fixed choice; position: one digit. */
  kind: 'text' | 'month' | 'select' | 'position';
  hint?: string;
  placeholder?: string;
  numeric?: boolean;
  options?: Array<{ value: string; label: string }>;
  max: number;
  /** A plain sentence when the value does not look right. */
  problem?: (v: string) => string | null;
  clean?: (v: string) => string;
  /** How the emergency sheet writes it. */
  sheet?: (v: string) => string;
}

const digitsOnly = (v: string) => v.replace(/[\s-]/g, '');
const upper = (v: string) => digitsOnly(v).toUpperCase();

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

/** Medicare: 10 digits, the first 2 to 6, the 9th a check digit over the first 8. */
export function medicareProblem(raw: string): string | null {
  const n = digitsOnly(raw);
  if (!/^\d{10}$/.test(n)) return 'That Medicare number does not look right. It has 10 digits.';
  if (!/^[2-6]/.test(n)) return 'That Medicare number does not look right. It starts with a 2, 3, 4, 5 or 6.';
  const weights = [1, 3, 7, 9, 1, 3, 7, 9];
  const sum = weights.reduce((s, w, i) => s + w * Number(n[i]), 0);
  if (sum % 10 !== Number(n[8])) return 'That Medicare number does not look right. Check each digit against the card.';
  return null;
}

/** IHI: 16 digits starting 800360, with a Luhn check. */
export function ihiProblem(raw: string): string | null {
  const n = digitsOnly(raw);
  if (!/^\d{16}$/.test(n) || !n.startsWith('800360')) return 'That Individual Healthcare Identifier does not look right. It has 16 digits and starts with 8003.';
  if (!luhnOk(n)) return 'That Individual Healthcare Identifier does not look right. Check each digit against My Health Record.';
  return null;
}

/** NHS number: 10 digits, the last a check digit (modulus 11). */
export function nhsProblem(raw: string): string | null {
  const n = digitsOnly(raw);
  if (!/^\d{10}$/.test(n)) return 'That NHS number does not look right. It has 10 digits, such as 943 476 5919.';
  const sum = [...n.slice(0, 9)].reduce((s, d, i) => s + Number(d) * (10 - i), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10 || check !== Number(n[9])) return 'That NHS number does not look right. Check each digit against a letter from the NHS.';
  return null;
}

const PROVINCES = [
  { value: 'AB', label: 'Alberta' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'MB', label: 'Manitoba' },
  { value: 'NB', label: 'New Brunswick' },
  { value: 'NL', label: 'Newfoundland and Labrador' },
  { value: 'NS', label: 'Nova Scotia' },
  { value: 'NT', label: 'Northwest Territories' },
  { value: 'NU', label: 'Nunavut' },
  { value: 'ON', label: 'Ontario' },
  { value: 'PE', label: 'Prince Edward Island' },
  { value: 'QC', label: 'Quebec' },
  { value: 'SK', label: 'Saskatchewan' },
  { value: 'YT', label: 'Yukon' },
];

export const DVA_CARD_COLOURS = ['gold', 'white', 'orange'] as const;

/** Letters and digits, with spaces and dashes taken out, up to a length. */
const loose = (name: string, max: number) => (raw: string) =>
  /^[A-Z0-9]{1,}$/i.test(digitsOnly(raw)) && digitsOnly(raw).length <= max ? null : `That ${name} does not look right. It has up to ${max} letters and digits.`;

export const ID_FIELDS: Record<IdFieldKey, IdFieldDef> = {
  medicare_number: {
    label: 'Medicare number',
    kind: 'text',
    placeholder: '2123 45670 1',
    numeric: true,
    max: 10,
    problem: medicareProblem,
    clean: digitsOnly,
    sheet: (v) => v.replace(/^(\d{4})(\d{5})(\d)$/, '$1 $2 $3'),
  },
  medicare_irn: { label: 'Position on the card', kind: 'position', placeholder: '1', numeric: true, hint: 'The number beside their name.', max: 1 },
  medicare_valid_to: { label: 'Valid to', kind: 'month', placeholder: 'MM/YYYY', max: 10 },
  ihi_number: {
    label: 'Individual Healthcare Identifier',
    kind: 'text',
    hint: '16 digits, starts with 8003. It is on My Health Record.',
    numeric: true,
    max: 16,
    problem: ihiProblem,
    clean: digitsOnly,
    sheet: (v) => v.replace(/(\d{4})(?=\d)/g, '$1 '),
  },
  dva_number: {
    label: 'DVA file number',
    kind: 'text',
    placeholder: 'NX123456',
    max: 9,
    problem: (raw) => (/^[A-Z0-9]{1,9}$/.test(upper(raw)) ? null : 'That DVA file number does not look right. It has up to 9 letters and digits, such as NX123456.'),
    clean: upper,
  },
  dva_card_colour: {
    label: 'DVA card colour',
    kind: 'select',
    options: [
      { value: 'gold', label: 'Gold' },
      { value: 'white', label: 'White' },
      { value: 'orange', label: 'Orange' },
    ],
    max: 10,
  },
  ndis_number: {
    label: 'NDIS number',
    kind: 'text',
    hint: '9 digits, starts with 43.',
    numeric: true,
    max: 9,
    problem: (raw) => (/^43\d{7}$/.test(digitsOnly(raw)) ? null : 'That NDIS number does not look right. It has 9 digits and starts with 43.'),
    clean: digitsOnly,
  },
  my_aged_care_number: {
    label: 'My Aged Care number',
    kind: 'text',
    hint: 'Starts with AC.',
    placeholder: 'AC12345678',
    max: 12,
    problem: (raw) => (/^AC\d{8,9}$/.test(upper(raw)) ? null : 'That My Aged Care number does not look right. It starts with AC, then 8 or 9 digits.'),
    clean: upper,
  },
  health_fund_name: { label: 'Health fund', kind: 'text', max: 120 },
  health_fund_member_number: { label: 'Member number', kind: 'text', max: 30 },
  nhs_number: {
    label: 'NHS number',
    kind: 'text',
    hint: '10 digits. It is on letters from the NHS and in the NHS App.',
    placeholder: '943 476 5919',
    numeric: true,
    max: 10,
    problem: nhsProblem,
    clean: digitsOnly,
    sheet: (v) => v.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3'),
  },
  nhi_number: {
    label: 'NHI number',
    kind: 'text',
    hint: 'Three letters, then four digits or two digits and two letters.',
    placeholder: 'ABC1234',
    max: 7,
    problem: (raw) => (/^[A-HJ-NP-Z]{3}(\d{4}|\d{2}[A-HJ-NP-Z]{2})$/.test(upper(raw)) ? null : 'That NHI number does not look right. It has three letters, then four digits or two digits and two letters.'),
    clean: upper,
  },
  pps_number: {
    label: 'PPS number',
    kind: 'text',
    hint: 'Seven digits and one or two letters.',
    placeholder: '1234567T',
    max: 9,
    problem: (raw) => (/^\d{7}[A-W][A-IW]?$/.test(upper(raw)) ? null : 'That PPS number does not look right. It has seven digits and one or two letters, such as 1234567T.'),
    clean: upper,
  },
  medical_card_number: { label: 'Medical card number', kind: 'text', max: 20, problem: loose('medical card number', 20), clean: upper },
  health_card_province: { label: 'Province or territory', kind: 'select', options: PROVINCES, max: 2 },
  health_card_number: { label: 'Health card number', kind: 'text', numeric: false, max: 20, problem: loose('health card number', 20), clean: upper },
  health_card_version: {
    label: 'Version code',
    kind: 'text',
    hint: 'The letters after the number, on cards that have them.',
    max: 4,
    problem: (raw) => (/^[A-Z]{1,4}$/.test(upper(raw)) ? null : 'The version code is up to four letters, printed after the number.'),
    clean: upper,
  },
  medicare_mbi: {
    label: 'Medicare number',
    kind: 'text',
    hint: '11 letters and digits, on the red, white and blue card.',
    placeholder: '1EG4-TE5-MK73',
    max: 11,
    problem: (raw) =>
      /^[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d[AC-HJKMNP-RT-Y]{2}\d{2}$/.test(upper(raw))
        ? null
        : 'That Medicare number does not look right. It has 11 letters and digits, such as 1EG4-TE5-MK73.',
    clean: upper,
    sheet: (v) => v.replace(/^(.{4})(.{3})(.{4})$/, '$1-$2-$3'),
  },
  medicaid_number: { label: 'Medicaid number', kind: 'text', max: 20, problem: loose('Medicaid number', 20), clean: upper },
};

export const ID_FIELD_KEYS = Object.keys(ID_FIELDS) as IdFieldKey[];
