/**
 * Opening hours as plain words and back, for files and for Pare: one entry
 * per open day, "Mon 08:30-17:00; Tue 08:30-17:00". Monday is day 1.
 */

export type OpeningHoursList = Array<{ day: 1 | 2 | 3 | 4 | 5 | 6 | 7; opens: string; closes: string }>;

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A day name or number as 1 to 7 (Monday is 1), or null. */
export function dayNumber(v: unknown): OpeningHoursList[number]['day'] | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7) return v as OpeningHoursList[number]['day'];
  const key = String(v ?? '').trim().toLowerCase().slice(0, 3);
  const i = DAYS.indexOf(key as (typeof DAYS)[number]);
  return i >= 0 ? ((i + 1) as OpeningHoursList[number]['day']) : null;
}

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const pad = (t: string) => {
  const m = HM.exec(t.trim());
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
};

/** Pare's form ({ day: "mon", opens, closes }) or the stored form, checked and sorted. */
export function parseHoursList(list: unknown): OpeningHoursList | null {
  if (!Array.isArray(list)) return null;
  const out: OpeningHoursList = [];
  for (const h of list as Array<Record<string, unknown>>) {
    const day = dayNumber(h?.['day']);
    const opens = pad(String(h?.['opens'] ?? ''));
    const closes = pad(String(h?.['closes'] ?? ''));
    if (!day || !opens || !closes || opens >= closes) continue;
    out.push({ day, opens, closes });
  }
  return out.length ? out.sort((a, b) => a.day - b.day || a.opens.localeCompare(b.opens)) : null;
}

/** "Mon 08:30-17:00; Tue 08:30-17:00" */
export function hoursToText(hours: unknown): string {
  const list = parseHoursList(typeof hours === 'string' ? safeJson(hours) : hours);
  return (list ?? []).map((h) => `${DAY_LABELS[h.day - 1]} ${h.opens}-${h.closes}`).join('; ');
}

/** The reverse of hoursToText; anything it cannot read is left out. */
export function hoursFromText(text: string | null | undefined): OpeningHoursList | null {
  const parts = String(text ?? '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  const list = parts.map((p) => {
    const m = /^([A-Za-z]+)\s+(\d{1,2}:\d{2})\s*[-–to]+\s*(\d{1,2}:\d{2})$/.exec(p);
    return m ? { day: m[1], opens: m[2], closes: m[3] } : null;
  });
  return parseHoursList(list.filter(Boolean));
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
