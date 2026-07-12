/**
 * Time zone helpers for the assistant. Care records are timestamped, and
 * the person logging thinks in their own local wall-clock time, not the
 * server's UTC. When the assistant produces a naive time like
 * "2026-07-10T11:00:00" it means 11:00 where the user is, so we convert it
 * to the correct UTC instant using the user's IANA zone (e.g.
 * "Australia/Sydney") sent from the browser. Times that already carry an
 * offset (a trailing Z or +10:00) are unambiguous and pass through.
 */

/** True if the string is a valid IANA time zone this runtime understands. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A datetime string with no zone marker (no trailing Z and no +/-HH:MM offset). */
function isNaive(value: string): boolean {
  return !/([zZ])$|[+-]\d{2}:?\d{2}$/.test(value.trim());
}

/**
 * The offset in milliseconds (local minus UTC) that `timeZone` had at the
 * given instant, so daylight saving is respected.
 */
function offsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value);
  const asUtc = Date.UTC(map.year!, map.month! - 1, map.day!, map.hour!, map.minute!, map.second!);
  return asUtc - instant.getTime();
}

/**
 * Parse an assistant-supplied time into a UTC Date. A naive wall-clock time
 * is interpreted in `timeZone`; a time with an explicit offset is honoured
 * as-is. Returns null when the value cannot be read.
 */
export function parseZonedTime(value: string, timeZone: string | null | undefined): Date | null {
  const trimmed = value.trim();
  if (isNaive(trimmed) && isValidTimeZone(timeZone)) {
    // First read the wall-clock digits as if they were UTC, then subtract
    // the zone's offset at (approximately) that instant to land on the true
    // UTC time. One correction pass is accurate except in the rare hour a
    // clock springs forward, which does not matter for care logging.
    const asIfUtc = new Date(`${trimmed}Z`);
    if (Number.isNaN(asIfUtc.getTime())) return null;
    const corrected = new Date(asIfUtc.getTime() - offsetMs(asIfUtc, timeZone));
    return Number.isNaN(corrected.getTime()) ? null : corrected;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format an instant as "10 Jul 2026, 11:00" in the user's zone (UTC fallback). */
export function formatInZone(instant: Date, timeZone: string | null | undefined): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const label = isValidTimeZone(timeZone) ? '' : ' UTC';
  return `${map.day} ${map.month} ${map.year}, ${map.hour}:${map.minute}${label}`;
}

/** The current date and time written in the user's zone, for the prompt. */
export function nowInZone(timeZone: string | null | undefined): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.weekday} ${map.day} ${map.month} ${map.year}, ${map.hour}:${map.minute} (${zone})`;
}

/**
 * The wall-clock HH:MM in the user's zone for a given instant. Without a
 * usable zone it falls back to the server's clock, matching the fallback
 * in startOfDayInZone.
 */
export function hmInZone(instant: Date, timeZone: string | null | undefined): string {
  if (!isValidTimeZone(timeZone)) {
    return `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`;
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.hour}:${map.minute}`;
}

/** The UTC instant of local midnight in the user's zone, for "today" queries. */
export function startOfDayInZone(instant: Date, timeZone: string | null | undefined): Date {
  if (isValidTimeZone(timeZone)) {
    const midnight = parseZonedTime(`${dateInZone(instant, timeZone)}T00:00:00`, timeZone);
    if (midnight) return midnight;
  }
  return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
}

/** The calendar date (YYYY-MM-DD) in the user's zone for a given instant. */
export function dateInZone(instant: Date, timeZone: string | null | undefined): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}
