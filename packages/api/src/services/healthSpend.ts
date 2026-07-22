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

/** Serialise a raw ledger row: amount as a number, date as YYYY-MM-DD. */
export function serializeEntry<T extends Record<string, unknown>>(row: T): T & { amount: number; spent_on: string } {
  return {
    ...row,
    amount: toNum(row['amount']) ?? 0,
    spent_on: dateOnly(row['spent_on']),
  };
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
}

interface SpendRow {
  category: SpendCategory;
  status: SpendStatus;
  amount: unknown;
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
  const rows = await query.select('category', 'status', 'amount');

  const byCategory = emptyByCategory();
  let total = 0;
  let pending = 0;
  for (const r of rows) {
    const amt = toNum(r.amount) ?? 0;
    if (r.status === 'confirmed') {
      byCategory[r.category] = round2((byCategory[r.category] ?? 0) + amt);
      total = round2(total + amt);
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
  };
}
