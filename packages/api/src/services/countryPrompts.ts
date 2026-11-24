import { COST_SOURCES, preset, type CountryCode } from '../lib/countries';
import { ID_FIELDS } from './identifierFields';
import { identifierKeysFor } from './identifiers';

/**
 * The parts of Pare's instructions that change with the country: which ID
 * numbers there are and what they look like, what the funding schemes and
 * cost sources are called. Pare sees the stored keys with their local names,
 * so "a personal budget" in the UK is still the scheme "ndis".
 */

const NOTES: Partial<Record<string, string>> = {
  medicare_number: '10 digits',
  medicare_irn: 'the position on the card, 1 to 9',
  medicare_valid_to: 'YYYY-MM',
  ihi_number: '16 digits',
  dva_card_colour: 'gold | white | orange',
  ndis_number: '9 digits starting 43',
  my_aged_care_number: 'AC then 8 or 9 digits',
  nhs_number: '10 digits',
  nhi_number: '3 letters then 4 digits, or 2 digits and 2 letters',
  pps_number: '7 digits and 1 or 2 letters',
  health_card_province: 'two-letter province code, such as ON',
  medicare_mbi: '11 letters and digits',
};

/** `"medicare_number" (10 digits), "medicare_irn" (...)` for the person's country. */
export function idFieldList(country: CountryCode): string {
  return identifierKeysFor(country)
    .map((k) => {
      const note = NOTES[k] ?? null;
      const label = ID_FIELDS[k].label;
      return `"${k}"${note ? ` (${note})` : ''}${label ? ` [${label}]` : ''}`;
    })
    .join(', ');
}

/** The ID numbers the person's country uses, by name: "Medicare, DVA, NDIS". */
export const idCardWords = (country: CountryCode): string => preset(country).id_groups.map((g) => g.legend).join(', ');

/** `ndis (NDIS plan) | support_at_home (Support at Home) | ...` */
export function schemeList(country: CountryCode): string {
  return preset(country).funding.map((f) => `${f.key} (${f.label})`).join(' | ');
}

/** "an NDIS plan, Support at Home or a Home Care Package" */
export function schemeWords(country: CountryCode): string {
  const names = preset(country).funding.filter((f) => f.key !== 'other').map((f) => f.label);
  if (names.length <= 1) return names[0] ?? 'a funding plan';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** `self (Self funded) | ndis (NDIS) | ...` */
export function costSourceList(country: CountryCode): string {
  const p = preset(country);
  return COST_SOURCES.map((k) => `${k} (${p.cost_sources[k]})`).join(' | ');
}

/** The local coordinator, where the scheme has one. */
export function coordinatorWord(country: CountryCode): string {
  return preset(country).funding.find((f) => f.key === 'ndis')?.area_coordinator ?? 'local coordinator';
}
