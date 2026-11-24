import { format as fnsFormat } from 'date-fns';

/**
 * Dates as the person's country writes them. Every screen formats dates
 * through here, written day first ("25 Nov 2026, 14:30"); where the country
 * writes the month first and uses a 12 hour clock, as in the United States,
 * the same pattern comes out as "Nov 25, 2026, 2:30 PM". Number-only dates
 * (MM/yyyy on a card) are left as they are.
 */

let order: 'dmy' | 'mdy' = 'dmy';
let clock: '24h' | '12h' = '24h';

export function setDateCountry(dateOrder: 'dmy' | 'mdy', clockKind: '24h' | '12h'): void {
  order = dateOrder;
  clock = clockKind;
}

/** A day-first pattern as the country writes it. */
export function localPattern(pattern: string): string {
  let p = pattern;
  if (order === 'mdy') {
    // "EEE d MMM yyyy" -> "EEE, MMM d, yyyy"; "d MMMM" -> "MMMM d".
    p = p.replace(/\b(EEEE|EEE) d (MMMM|MMM)( yyyy)?/g, (_m, day: string, month: string, year?: string) => `${day}, ${month} d${year ? `,${year}` : ''}`);
    p = p.replace(/(^|[^E] |^)d (MMMM|MMM)( yyyy)?/g, (_m, lead: string, month: string, year?: string) => `${lead}${month} d${year ? `,${year}` : ''}`);
  }
  if (clock === '12h') p = p.replace(/HH:mm:ss/g, 'h:mm:ss a').replace(/HH:mm/g, 'h:mm a');
  return p;
}

export function format(date: Date | number, pattern: string): string {
  return fnsFormat(date, localPattern(pattern));
}
