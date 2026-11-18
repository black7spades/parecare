import { isValidTimeZone } from './timezone';

/**
 * Which of a day's scheduled times are covered by the doses recorded that
 * day. Each time is its own dose. A dose recorded against a time covers that
 * time; any other dose covers the earliest time still open. So two doses of
 * a three-times-a-day medication leave one still to give.
 *
 * Used by the calendar and the overdue-dose alert, so both always agree.
 */
export function coveredTimes(
  times: string[],
  doses: Array<{ scheduled_for: Date | string | null; administered_at: Date | string }>,
  timeZone: string | null | undefined
): Set<string> {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const hmOf = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const sorted = [...new Set(times)].sort();
  const covered = new Set<string>();
  const loose: unknown[] = [];
  const ordered = [...doses].sort(
    (a, b) => new Date(a.administered_at).getTime() - new Date(b.administered_at).getTime()
  );
  for (const dose of ordered) {
    const hm = dose.scheduled_for ? hmOf(new Date(dose.scheduled_for)) : null;
    if (hm && sorted.includes(hm) && !covered.has(hm)) covered.add(hm);
    else loose.push(dose);
  }
  for (let i = 0; i < loose.length; i++) {
    const open = sorted.find((t) => !covered.has(t));
    if (!open) break;
    covered.add(open);
  }
  return covered;
}

/** The local day a dose belongs to: the day it was due when known, else the day it was recorded. */
export function doseAnchor(dose: { scheduled_for: Date | string | null; administered_at: Date | string }): Date {
  return new Date(dose.scheduled_for ?? dose.administered_at);
}
