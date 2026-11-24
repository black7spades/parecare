import { format } from './dateFormat';

/**
 * The browser's IANA time zone (e.g. "Australia/Sydney"). Sent with every
 * message to Pare so the times it records land on the user's own clock:
 * "11am this morning" is stored as 11am where they are, and read back the
 * same way. Returns undefined if the runtime cannot report a zone.
 */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Date-only values (a date of birth, a date of death, a repeat due) are plain
 * calendar days, "1943-02-19", with no time and no time zone. Read through
 * `new Date("1943-02-19")` they become midnight UTC, which is the day before
 * anywhere west of Greenwich. These read and write them as the local day.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Today as YYYY-MM-DD on this device's own calendar, never the UTC date. */
export function todayDateOnly(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A date-only value shown as "19 Feb 1943", or '' when there is none. */
export function formatDateOnly(value: string | null | undefined, pattern = 'd MMM yyyy'): string {
  const d = parseDateOnly(value);
  return d ? format(d, pattern) : '';
}
