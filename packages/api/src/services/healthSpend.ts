import { Knex } from 'knex';
import { getHealthCurrency } from '../config/settings';

/**
 * The health spend ledger. Every amount actually spent on someone's care is a
 * dated entry; spend over any period is just the entries in that window. Only
 * confirmed entries count as spend. An appointment booked with an estimate is
 * kept as a pending entry until the real amount is confirmed afterwards, so the
 * spend total stays truthful.
 */

export type SpendCategory = 'medication' | 'appointment' | 'other';
export type SpendStatus = 'confirmed' | 'estimated';

export const SPEND_CATEGORIES: readonly SpendCategory[] = ['medication', 'appointment', 'other'];

// Who the money is (or will be) reimbursed by, and where a claim is up to.
export const FUNDING_SOURCES = ['self', 'ndis', 'private_health', 'medicare', 'government', 'other'] as const;
export const CLAIM_STATUSES = ['none', 'unclaimed', 'submitted', 'reimbursed'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const CURRENCY_SYMBOLS: Record<string, string> = {
  AUD: '$',
  USD: '$',
  GBP: '£',
  EUR: '€',
  NZD: '$',
  CAD: '$',
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? '$';
}

export const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface SpendEntry {
  id: string;
  care_profile_id: string;
  amount: number;
  spent_on: string;
  category: SpendCategory;
  status: SpendStatus;
  medication_id: string | null;
  appointment_id: string | null;
  description: string | null;
  /** A friendly label for what the spend was on, joined for display. */
  item_name?: string | null;
}

const dateOnly = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** Serialise a raw ledger row: money columns as numbers, date as YYYY-MM-DD. */
export function serializeEntry<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    amount: toNum(row['amount']) ?? 0,
    spent_on: dateOnly(row['spent_on']),
    tax_amount: toNum(row['tax_amount']),
    claimable_amount: toNum(row['claimable_amount']),
    reimbursed_amount: toNum(row['reimbursed_amount']),
  };
}

/**
 * The financial-year window containing a reference date, given the month the
 * year starts in (1 to 12). For a July start, a date in August 2026 is in the
 * year 1 Jul 2026 to 30 Jun 2027; a date in March 2026 is in 1 Jul 2025 to
 * 30 Jun 2026.
 */
export function financialYearRange(startMonth: number, ref: Date = new Date()): { from: string; to: string } {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth() + 1; // 1-12
  const startYear = m >= startMonth ? y : y - 1;
  const from = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  // The day before the same start next year.
  const endExclusive = new Date(Date.UTC(startYear + 1, startMonth - 1, 1));
  const end = new Date(endExclusive.getTime() - 24 * 3600 * 1000);
  const to = end.toISOString().slice(0, 10);
  return { from, to };
}

export interface SpendSummary {
  currency: string;
  currency_symbol: string;
  from: string | null;
  to: string | null;
  /** Confirmed spend, by category and combined. */
  by_category: Record<SpendCategory, number>;
  total: number;
  /** Estimated spend awaiting confirmation, not part of the total. */
  pending_total: number;
  /** The tax (GST/VAT) component within the confirmed total. */
  tax_total: number;
  /** How much of the confirmed spend is claimable back. */
  claimable_total: number;
  /** How much has actually been reimbursed. */
  reimbursed_total: number;
  /** Claimable but not yet reimbursed (unclaimed or submitted claims). */
  outstanding_total: number;
  /** Confirmed spend less what has been reimbursed: the real out-of-pocket. */
  net_total: number;
}

interface SpendRow {
  category: SpendCategory;
  status: SpendStatus;
  amount: unknown;
  tax_amount: unknown;
  claimable_amount: unknown;
  reimbursed_amount: unknown;
  claim_status: ClaimStatus;
}

function emptyByCategory(): Record<SpendCategory, number> {
  return { medication: 0, appointment: 0, other: 0 };
}

/**
 * Roll up one person's spend over an optional date range: confirmed amounts by
 * category and combined, plus the pending (estimated) total kept separate.
 */
export async function summarizeSpend(
  profileId: string,
  range: { from: string | null; to: string | null },
  db: Knex
): Promise<SpendSummary> {
  const currency = getHealthCurrency();
  let query = db<SpendRow>('health_spend_entries').where('care_profile_id', profileId);
  if (range.from) query = query.where('spent_on', '>=', range.from);
  if (range.to) query = query.where('spent_on', '<=', range.to);
  const rows = await query.select('category', 'status', 'amount', 'tax_amount', 'claimable_amount', 'reimbursed_amount', 'claim_status');

  const byCategory = emptyByCategory();
  let total = 0;
  let pending = 0;
  let taxTotal = 0;
  let claimableTotal = 0;
  let reimbursedTotal = 0;
  let outstanding = 0;
  for (const r of rows) {
    const amt = toNum(r.amount) ?? 0;
    if (r.status === 'confirmed') {
      byCategory[r.category] = round2((byCategory[r.category] ?? 0) + amt);
      total = round2(total + amt);
      taxTotal = round2(taxTotal + (toNum(r.tax_amount) ?? 0));
      const claimable = toNum(r.claimable_amount) ?? 0;
      const reimbursed = toNum(r.reimbursed_amount) ?? 0;
      claimableTotal = round2(claimableTotal + claimable);
      reimbursedTotal = round2(reimbursedTotal + reimbursed);
      // Outstanding: a claim that is claimable and not yet fully reimbursed.
      if (r.claim_status === 'unclaimed' || r.claim_status === 'submitted') {
        outstanding = round2(outstanding + Math.max(0, claimable - reimbursed));
      }
    } else {
      pending = round2(pending + amt);
    }
  }

  return {
    currency,
    currency_symbol: currencySymbol(currency),
    from: range.from,
    to: range.to,
    by_category: byCategory,
    total,
    pending_total: pending,
    tax_total: taxTotal,
    claimable_total: claimableTotal,
    reimbursed_total: reimbursedTotal,
    outstanding_total: outstanding,
    net_total: round2(total - reimbursedTotal),
  };
}
