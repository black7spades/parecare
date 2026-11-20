/**
 * As-needed limits: the least time between two doses and the most in 24
 * hours. Read from a medicine's instructions when nobody typed them, and
 * checked when a dose is recorded. A limit warns and asks why; it never
 * blocks a dose. Only as-needed medicines have them: a scheduled medicine
 * runs to its times.
 *
 * The same rules live in the other package's lib/asNeeded.ts. Test list,
 * kept in both:
 *   "Minimum 4 hours between doses."              -> gap 4
 *   "At least 6 hours apart"                      -> gap 6
 *   "Max 2 doses in 24 hours"                     -> most 2
 *   "Maximum 8 tablets per day", 2 per dose       -> most 4
 *   "Maximum 8 tablets per day", 1 per dose       -> most 8
 *   "no more than 3 a day"                        -> most 3
 *   "every 4 to 6 hours"                          -> gap 4
 *   "Take 2 tablets"                              -> nothing
 */

export interface AsNeededLimits {
  min_hours_between_doses: number | null;
  max_doses_per_day: number | null;
}

const NUM = '(\\d+(?:\\.\\d+)?)';
// Words that count units rather than doses: "8 tablets a day" is 4 doses of 2.
const UNIT_WORDS = /^(tablet|capsule|puff|sachet|drop|spray|patch|lozenge|ml|millilitre)/;

/**
 * The limits written in a medicine's instructions, when there are any. A
 * most written in tablets, capsules or puffs is turned into doses using how
 * many make up one dose.
 */
export function limitsFromText(text: string | null | undefined, unitsPerDose?: number | null): AsNeededLimits {
  const t = String(text ?? '').toLowerCase();
  let gap: number | null = null;
  let most: number | null = null;
  const gapRes = [
    new RegExp(`(?:minimum|min\\.?|at least)\\s+(?:of\\s+)?${NUM}\\s*(?:hours?|hrs?|h)\\b`),
    new RegExp(`${NUM}\\s*(?:hours?|hrs?)\\s+(?:between|apart)`),
    new RegExp(`every\\s+${NUM}\\s*(?:to|-|–)\\s*\\d+(?:\\.\\d+)?\\s*(?:hours?|hrs?)`),
  ];
  for (const re of gapRes) {
    const m = re.exec(t);
    if (m) {
      gap = Number(m[1]);
      break;
    }
  }
  const mostRe = new RegExp(
    `(?:max(?:imum)?\\.?|no more than|not more than|up to)\\s+(?:of\\s+)?${NUM}\\s*([a-z]+)?\\s*(?:in|per|a|each|every)\\s*(?:24\\s*(?:hours?|hrs?|h)|day|days)`
  );
  const m = mostRe.exec(t);
  if (m) {
    most = Number(m[1]);
    const word = m[2] ?? '';
    const per = Number(unitsPerDose);
    if (UNIT_WORDS.test(word) && Number.isFinite(per) && per > 1) most = Math.floor(most / per);
  }
  return {
    min_hours_between_doses: gap != null && gap > 0 && gap <= 168 ? Math.round(gap * 10) / 10 : null,
    max_doses_per_day: most != null && most > 0 && most <= 50 ? Math.round(most) : null,
  };
}

export interface LimitCheck {
  /** Given inside the gap or over the daily most. */
  outside: boolean;
  /** When the next dose is due from, if a dose before this one is inside the gap. */
  next_from: Date | null;
  /** The nearest dose that is too close, before or after this one. */
  last_given_at: Date | null;
  /** The most doses any 24 hours holding this one would have. */
  count_with_this: number;
  inside_gap: boolean;
  over_most: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Check one dose against the limits, from the doses given in the 24 hours
 * either side of it, so a dose recorded late for an earlier time is checked
 * against the ones already recorded after it. Only doses the person
 * actually had count.
 */
export function checkLimits(limits: AsNeededLimits, at: Date, givenAround: Date[]): LimitCheck {
  const t = at.getTime();
  const near = givenAround.filter((d) => Math.abs(d.getTime() - t) < DAY_MS);
  const gapMs = (limits.min_hours_between_doses ?? 0) * 3600 * 1000;
  // The nearest dose either side, and whether it is too close.
  const closest = [...near].sort((a, b) => Math.abs(a.getTime() - t) - Math.abs(b.getTime() - t))[0] ?? null;
  const insideGap = !!closest && gapMs > 0 && Math.abs(t - closest.getTime()) < gapMs;
  const before = near.filter((d) => d.getTime() <= t).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  // The busiest 24 hours that hold this dose.
  let count = 1;
  for (const start of [at, ...near.filter((d) => d.getTime() <= t)]) {
    const s = start.getTime();
    if (t - s >= DAY_MS) continue;
    const n = near.filter((d) => d.getTime() >= s && d.getTime() < s + DAY_MS).length + 1;
    if (n > count) count = n;
  }
  const overMost = limits.max_doses_per_day != null && count > limits.max_doses_per_day;
  // The next dose is due a full gap after the latest dose too close to this one.
  const tooClose = near.filter((d) => Math.abs(d.getTime() - t) < gapMs).map((d) => d.getTime());
  const nextFrom = insideGap && tooClose.length ? new Date(Math.max(...tooClose) + gapMs) : null;
  return {
    outside: insideGap || overMost,
    next_from: nextFrom,
    last_given_at: insideGap ? closest : before,
    count_with_this: count,
    inside_gap: insideGap,
    over_most: overMost,
  };
}
