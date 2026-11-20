import { isValidTimeZone, parseZonedTime } from './timezone';

/**
 * One list of repeats for tasks and appointments. The rule is the truth;
 * reminder_type is kept in step for older readers. The web app keeps the same
 * list in lib/repeat.ts.
 */
export const REPEAT_CHOICES = [
  { choice: 'once', label: "Doesn't repeat", reminder_type: 'once', rrule: null },
  { choice: 'daily', label: 'Every day', reminder_type: 'daily', rrule: 'FREQ=DAILY' },
  { choice: 'weekly', label: 'Every week', reminder_type: 'weekly', rrule: 'FREQ=WEEKLY' },
  { choice: 'fortnightly', label: 'Every 2 weeks', reminder_type: 'weekly', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { choice: 'monthly', label: 'Every month', reminder_type: 'monthly', rrule: 'FREQ=MONTHLY' },
  { choice: 'three_monthly', label: 'Every 3 months', reminder_type: 'monthly', rrule: 'FREQ=MONTHLY;INTERVAL=3' },
  { choice: 'six_monthly', label: 'Every 6 months', reminder_type: 'monthly', rrule: 'FREQ=MONTHLY;INTERVAL=6' },
  { choice: 'yearly', label: 'Every year', reminder_type: 'yearly', rrule: 'FREQ=YEARLY' },
] as const;

export type RepeatChoice = (typeof REPEAT_CHOICES)[number]['choice'];
export type ReminderType = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export const REPEAT_CHOICE_VALUES = REPEAT_CHOICES.map((c) => c.choice) as [RepeatChoice, ...RepeatChoice[]];

/** The columns a repeat choice is stored as. */
export function repeatColumns(choice: RepeatChoice | string | null | undefined): { reminder_type: ReminderType; rrule: string | null } {
  const hit = REPEAT_CHOICES.find((c) => c.choice === choice) ?? REPEAT_CHOICES[0];
  return { reminder_type: hit.reminder_type, rrule: hit.rrule };
}

function parseRule(rrule: string | null | undefined): { freq: string; interval: number } | null {
  if (!rrule) return null;
  const parts = Object.fromEntries(
    rrule.split(';').map((p) => p.split('=').map((s) => s.trim().toUpperCase()) as [string, string])
  );
  const freq = parts['FREQ'];
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const interval = Math.max(1, Number(parts['INTERVAL'] ?? 1) || 1);
  return { freq, interval };
}

/** The rule for a stored row: its rrule, or one from its older reminder_type. */
export function ruleFor(row: { rrule?: string | null; reminder_type?: string | null }): string | null {
  if (row.rrule && parseRule(row.rrule)) return row.rrule;
  const t = row.reminder_type;
  if (t === 'daily') return 'FREQ=DAILY';
  if (t === 'weekly') return 'FREQ=WEEKLY';
  if (t === 'monthly') return 'FREQ=MONTHLY';
  if (t === 'yearly') return 'FREQ=YEARLY';
  return null;
}

/** The choice a stored row repeats by, for forms and lists. */
export function repeatChoice(row: { rrule?: string | null; reminder_type?: string | null }): RepeatChoice {
  const rule = parseRule(ruleFor(row));
  if (!rule) return 'once';
  const hit = REPEAT_CHOICES.find((c) => {
    const r = parseRule(c.rrule);
    return r && r.freq === rule.freq && r.interval === rule.interval;
  });
  return hit?.choice ?? 'once';
}

export const repeatLabel = (choice: RepeatChoice | string): string =>
  REPEAT_CHOICES.find((c) => c.choice === choice)?.label ?? "Doesn't repeat";

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Wall-clock parts of an instant in a zone (UTC without one). */
function wallClock(instant: Date, timeZone: string | null | undefined) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = Number(p.value);
  return { y: m.year!, mo: m.month! - 1, d: m.day!, h: m.hour!, mi: m.minute!, s: m.second! };
}

/**
 * The next time after `date` by the rule, on the same wall-clock time in the
 * zone. A month that has no such day lands on its last day: the 31st of each
 * month falls on the 30th in April.
 */
export function advance(date: Date, rrule: string | null | undefined, timeZone?: string | null, anchorDay?: number): Date {
  const rule = parseRule(rrule);
  if (!rule) return new Date(date);
  const w = wallClock(date, timeZone);
  let { y, mo, d } = w;
  if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') {
    const step = rule.interval * (rule.freq === 'WEEKLY' ? 7 : 1);
    const next = new Date(Date.UTC(y, mo, d + step));
    y = next.getUTCFullYear(); mo = next.getUTCMonth(); d = next.getUTCDate();
  } else {
    const months = rule.interval * (rule.freq === 'YEARLY' ? 12 : 1);
    const total = mo + months;
    y += Math.floor(total / 12);
    mo = ((total % 12) + 12) % 12;
    d = Math.min(anchorDay ?? d, daysIn(y, mo));
  }
  const naive = `${y}-${pad(mo + 1)}-${pad(d)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`;
  return (isValidTimeZone(timeZone) ? parseZonedTime(naive, timeZone) : null) ?? new Date(`${naive}Z`);
}

/** Roll a due time forward by its rule until it is after `now`. */
export function nextAfter(due: Date, rrule: string | null | undefined, now: Date, timeZone?: string | null): Date {
  if (!parseRule(rrule)) return due;
  const anchor = wallClock(due, timeZone).d;
  let next = new Date(due);
  for (let i = 0; i < 2000 && next <= now; i++) next = advance(next, rrule, timeZone, anchor);
  return next;
}
