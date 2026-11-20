import { Button } from './ui/Button';
import type { OpeningHours } from '../lib/care';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
type Day = OpeningHours[number]['day'];

const TIME =
  'rounded-md border border-border bg-card px-2 py-1 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** A day's row: open or not, and from when to when. */
export interface DayHours {
  open: boolean;
  opens: string;
  closes: string;
}

export type WeekHours = Record<Day, DayHours>;

const closedDay = (): DayHours => ({ open: false, opens: '09:00', closes: '17:00' });

/** The week as rows, from what is stored (one entry per open day). */
export function weekFrom(hours: OpeningHours | null | undefined): WeekHours {
  const week = Object.fromEntries(([1, 2, 3, 4, 5, 6, 7] as Day[]).map((d) => [d, closedDay()])) as WeekHours;
  for (const h of hours ?? []) week[h.day] = { open: true, opens: h.opens, closes: h.closes };
  return week;
}

/** The week as stored: only the open days whose times make sense; null when none. */
export function hoursFrom(week: WeekHours): OpeningHours | null {
  const out: OpeningHours = [];
  for (const d of [1, 2, 3, 4, 5, 6, 7] as Day[]) {
    const r = week[d];
    if (r.open && r.opens && r.closes && r.opens < r.closes) out.push({ day: d, opens: r.opens, closes: r.closes });
  }
  return out.length ? out : null;
}

/** Open days whose closing time is not after the opening time, in words. */
export function badDays(week: WeekHours): string[] {
  return ([1, 2, 3, 4, 5, 6, 7] as Day[]).filter((d) => week[d].open && !(week[d].opens < week[d].closes)).map((d) => DAYS[d - 1]!);
}

/**
 * Opening hours, a row per day: Open, From, To. "Same hours Monday to
 * Friday" copies Monday's hours to the other weekdays.
 */
export function OpeningHoursField({
  value,
  onChange,
  inheritedFrom,
}: {
  value: WeekHours;
  onChange: (next: WeekHours) => void;
  /** Where they are based, when its hours are used while these are empty. */
  inheritedFrom?: string | null;
}) {
  const set = (d: Day, patch: Partial<DayHours>) => onChange({ ...value, [d]: { ...value[d], ...patch } });
  const anyOpen = ([1, 2, 3, 4, 5, 6, 7] as Day[]).some((d) => value[d].open);
  const bad = badDays(value);
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-ink mb-1">Opening hours</legend>
      {!anyOpen && inheritedFrom ? <p className="text-xs text-muted mb-1">Same as {inheritedFrom}.</p> : null}
      <div className="space-y-1">
        {([1, 2, 3, 4, 5, 6, 7] as Day[]).map((d) => {
          const r = value[d];
          const name = DAYS[d - 1]!;
          return (
            <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-ink">{name}</span>
              <label className="inline-flex items-center gap-1.5 text-ink">
                <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={r.open} onChange={(e) => set(d, { open: e.target.checked })} />
                Open
              </label>
              {r.open ? (
                <>
                  <label className="inline-flex items-center gap-1 text-muted">
                    From
                    <input type="time" className={TIME} aria-label={`${name} from`} value={r.opens} onChange={(e) => set(d, { opens: e.target.value })} />
                  </label>
                  <label className="inline-flex items-center gap-1 text-muted">
                    To
                    <input type="time" className={TIME} aria-label={`${name} to`} value={r.closes} onChange={(e) => set(d, { closes: e.target.value })} />
                  </label>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        size="xs"
        variant="secondary"
        className="mt-2"
        onClick={() => onChange({ ...value, 2: { ...value[1] }, 3: { ...value[1] }, 4: { ...value[1] }, 5: { ...value[1] } })}
      >
        Same hours Monday to Friday
      </Button>
      {bad.length ? <p className="mt-1 text-xs text-red-600">The closing time comes before the opening time on {bad.join(', ')}.</p> : null}
    </fieldset>
  );
}

/** "Monday 08:30 to 17:00" per open day, one line each, for reading. */
export function hoursText(hours: OpeningHours | null | undefined): string | null {
  if (!hours?.length) return null;
  return hours.map((h) => `${DAYS[h.day - 1]} ${h.opens} to ${h.closes}`).join('\n');
}
