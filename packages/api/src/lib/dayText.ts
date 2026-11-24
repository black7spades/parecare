import { preset, type CountryCode } from './countries';
import { systemCountry } from '../services/country';

/**
 * Dates and times written into sentences by the server ("runs out on 25
 * November 2026"), in the way the person's country writes them: day first
 * in Australia and the UK, month first in the United States.
 */

/** A calendar day, YYYY-MM-DD: "25 Nov 2026", or "25 November 2026" when long. */
export function dayText(day: string, country: CountryCode | null = null, style: 'short' | 'long' = 'short'): string {
  return new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString(preset(country ?? systemCountry()).locale, {
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A moment's day where someone is: "Wed 25 Nov 2026". */
export function weekdayText(at: Date, timeZone: string | undefined, country: CountryCode | null = null): string {
  return new Intl.DateTimeFormat(preset(country ?? systemCountry()).locale, { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(at);
}

/** A moment's time where someone is: "14:30", or "2:30 PM" where the clock is 12 hour. */
export function timeText(at: Date, timeZone: string | undefined, country: CountryCode | null = null): string {
  const p = preset(country ?? systemCountry());
  return new Intl.DateTimeFormat(p.locale, { timeZone, hour: p.clock === '12h' ? 'numeric' : '2-digit', minute: '2-digit', hour12: p.clock === '12h' }).format(at);
}
