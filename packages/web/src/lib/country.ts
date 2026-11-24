import { Fragment, createElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { setDateCountry } from './dateFormat';
import { setPhoneCountry } from './phoneText';
import { setDirectiveTerm } from './careTerms';

/**
 * The country PareCare is used in, as the server describes it: its ID
 * numbers, funding schemes, words and formats, and the national services
 * people are sent to. The API keeps the presets in lib/countries.ts; this
 * is only what the screens need. Nothing here is Australian by default
 * except the fallback used for the moment before the first answer.
 */

export interface IdFieldConfig {
  key: string;
  label: string;
  kind: 'text' | 'month' | 'select' | 'position';
  hint: string | null;
  placeholder: string | null;
  numeric: boolean;
  options: Array<{ value: string; label: string }> | null;
}

export interface FundingSchemeConfig {
  key: 'ndis' | 'support_at_home' | 'home_care_package' | 'other';
  label: string;
  review_word: string;
  management: { agency: string; plan: string; self: string } | null;
  area_coordinator: string | null;
  progress_report: string | null;
}

export interface CountryConfig {
  code: string;
  name: string;
  locale: string;
  date_order: 'dmy' | 'mdy';
  clock: '24h' | '12h';
  dial_code: string;
  phone_example: string;
  currency: string;
  id_groups: Array<{ legend: string; fields: IdFieldConfig[] }>;
  funding: FundingSchemeConfig[];
  cost_sources: Record<'self' | 'ndis' | 'private_health' | 'medicare' | 'government' | 'other', string>;
  has_referral_rule: boolean;
  words: {
    advance_directive: string;
    advance_directive_meaning: string;
    health_fund: string;
    health_fund_example: string;
    member_number: string;
    care_standards: string;
    suburb: string;
    state: string;
    postcode: string;
  };
  sample_address: { line1: string; suburb: string; state: string; postcode: string; country: string };
}

export interface Service {
  kind: string;
  label: string;
  name: string | null;
  phone: string | null;
  website: string | null;
  source: 'original' | 'everyone' | 'own';
  has_original: boolean;
  added: boolean;
  checked_on: string | null;
  missing: boolean;
}

export interface CountryResponse {
  config: CountryConfig;
  system_country: { code: string; name: string };
  own_country: string | null;
  choices: Array<{ code: string; name: string }>;
  services: Service[];
}

/** Used only until the server answers. */
const FALLBACK: CountryConfig = {
  code: 'AU',
  name: 'Australia',
  locale: 'en-AU',
  date_order: 'dmy',
  clock: '24h',
  dial_code: '61',
  phone_example: '0400 000 000',
  currency: 'AUD',
  id_groups: [],
  funding: [{ key: 'other', label: 'Other funding', review_word: 'funding', management: null, area_coordinator: null, progress_report: null }],
  cost_sources: { self: 'Self funded', ndis: 'Funding plan', private_health: 'Private health', medicare: 'Public health system', government: 'Government', other: 'Other' },
  has_referral_rule: false,
  words: {
    advance_directive: 'Advance care directive',
    advance_directive_meaning: 'An advance care directive writes down the care wanted if the person cannot say.',
    health_fund: 'Health fund',
    health_fund_example: '',
    member_number: 'Member number',
    care_standards: '',
    suburb: 'Suburb',
    state: 'State',
    postcode: 'Postcode',
  },
  sample_address: { line1: '1 Main St', suburb: '', state: '', postcode: '', country: '' },
};

/** The signed-in account's country, its words and its services. */
export function useCountry() {
  const q = useQuery({
    queryKey: ['country'],
    queryFn: () => api.get<CountryResponse>('/country'),
    staleTime: 5 * 60 * 1000,
  });
  return { ...q, config: q.data?.config ?? FALLBACK, services: q.data?.services ?? [] };
}

/** A person's country, which follows whoever set up their profile. */
export function useProfileCountry(profileId: string | null | undefined) {
  const q = useQuery({
    queryKey: ['country', profileId],
    queryFn: () => api.get<{ config: CountryConfig; services: Service[] }>(`/care-profiles/${profileId}/country`),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const fallback = useCountry();
  return { ...q, config: q.data?.config ?? fallback.config, services: q.data?.services ?? fallback.services };
}

/** Lowercase a built-in term inside a sentence: "the advance decision". */
export const inSentence = (term: string): string => term.charAt(0).toLowerCase() + term.slice(1);

/**
 * Built-in words in the country's terms, the same rule the server uses:
 * "advance care directive" becomes "advance decision" in the UK.
 */
export function localiseCareWords(text: string, config: CountryConfig): string {
  if (config.code === 'AU' || !text) return text;
  if (text === 'Book the over seventy five health assessment') return 'Book a yearly health check';
  return text.replace(/advance care directives?/gi, (m) => {
    const plural = /s$/i.test(m);
    const term = config.words.advance_directive + (plural ? 's' : '');
    if (m === m.toUpperCase()) return term.toUpperCase();
    const sample = m.split(' ');
    return term
      .split(' ')
      .map((w, i) => (/^[A-Z]/.test(sample[Math.min(i, sample.length - 1)] ?? '') ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase()))
      .join(' ');
  });
}

/** Built-in words for a person, in their country's terms: words('Advance care directive'). */
export function useCareWords(profileId: string | null | undefined): (text: string) => string {
  const { config } = useProfileCountry(profileId);
  return (text: string) => localiseCareWords(text, config);
}

/** A funding scheme as the country names it, or its own funding when the country has no such scheme. */
export function schemeFor(config: CountryConfig, key: string | null | undefined): FundingSchemeConfig {
  return config.funding.find((f) => f.key === key) ?? config.funding.find((f) => f.key === 'other') ?? FALLBACK.funding[0]!;
}

/**
 * Sets the date order and the phone shapes for the whole app once the
 * account's country is known, before anything inside is drawn. Wraps the
 * shell's pages; they are drawn again once if the country changes the
 * formats, so every date on screen follows it.
 */
export function CountryScope({ children }: { children: ReactNode }) {
  const { data } = useCountry();
  const config = data?.config;
  if (config) {
    setDateCountry(config.date_order, config.clock);
    setPhoneCountry(config.code);
    setDirectiveTerm(config.words.advance_directive);
  }
  // Only a change of format redraws: most countries write dates as the fallback does.
  return createElement(Fragment, { key: config ? `${config.date_order}-${config.clock}` : 'dmy-24h' }, children);
}
