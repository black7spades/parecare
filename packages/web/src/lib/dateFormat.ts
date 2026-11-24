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
  // Values for date and time boxes ("yyyy-MM-dd'T'HH:mm", "HH:mm") are what
  // the browser reads, never shown as written, so they are left exactly as given.
  if (/yyyy-MM-dd|'T'/.test(p) || /^HH:mm(:ss)?$/.test(p)) return p;
  if (order === 'mdy') {
    // Numbers only: "dd/MM/yyyy" is "MM/dd/yyyy".
    p = p.replace(/\b(dd?)\/(MM?)\/(yy(?:yy)?)\b/g, '$2/$1/$3').replace(/\b(dd?)\/(MM?)\b(?!\/)/g, '$2/$1');
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
