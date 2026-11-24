import { env } from '../config/env';
import { dateInZone } from '../lib/timezone';
import type { ContactSummary } from './professionals';

/**
 * Calendar file pieces, shared by the subscribed feed and the single
 * appointment file sent to a driver or added to someone's own calendar.
 * What goes out is what helps someone get there: the time, the place, who
 * it is with and their phone, what to bring and how to get ready. Notes
 * never go.
 */

/** Calendar files end every line with a carriage return and line feed. */
export const ICS_EOL = String.fromCharCode(13, 10);

export function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Long lines are folded at 75 bytes, as calendar apps expect, never inside
 * a character: an emoji in a title stays whole.
 */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // the space that starts each folded line counts too
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join(`${ICS_EOL} `);
}

export function calendarText(name: string, bodyLines: string[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PareCare//Care Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    ...bodyLines,
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(ICS_EOL) + ICS_EOL;
}

/** The link back to a record in the app. */
export const openInApp = (profileId: string, page: string, recordId: string, base: string = env.APP_URL): string =>
  `${base}/app/${profileId}/${page}?record=${recordId}`;

const nextDay = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** A whole day, in the zone of whoever keeps the calendar. */
export function allDayLines(start: Date, zone: string | null): string[] {
  const day = dateInZone(start, zone);
  return [`DTSTART;VALUE=DATE:${day.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${nextDay(day).replace(/-/g, '')}`];
}

export interface IcsAppointment {
  id: string;
  care_profile_id: string;
  title: string;
  starts_at: Date | string;
  ends_at: Date | string | null;
  all_day: boolean;
  location: string | null;
  telehealth_link: string | null;
  preparation: string | null;
  provider: ContactSummary | null;
  bring: string[];
}

/** Where to go: the address, else the video call. */
export function appointmentPlace(a: Pick<IcsAppointment, 'location' | 'telehealth_link' | 'provider'>): string | null {
  const isUrl = (v: string | null | undefined) => !!v && /^\s*https?:\/\//i.test(v);
  const address = (a.location && !isUrl(a.location) ? a.location : null) ?? a.provider?.address ?? null;
  return address || a.telehealth_link || null;
}

/** The lines that help someone get there, in plain words. */
export function appointmentDetailLines(a: IcsAppointment): string[] {
  const out: string[] = [];
  if (a.provider) {
    out.push(`With: ${[a.provider.name, a.provider.role_label].filter(Boolean).join(', ')}`);
    if (a.provider.phone) out.push(`Phone: ${a.provider.phone}`);
  }
  if (a.telehealth_link) out.push(`Video call: ${a.telehealth_link}`);
  if (a.bring.length) out.push(`Bring: ${a.bring.join(', ')}`);
  if (a.preparation) out.push(`How to get ready: ${a.preparation}`);
  return out;
}

export function appointmentEvent(a: IcsAppointment, zone: string | null, base?: string): string[] {
  const start = new Date(a.starts_at);
  const end = a.ends_at ? new Date(a.ends_at) : new Date(start.getTime() + 30 * 60 * 1000);
  const place = appointmentPlace(a);
  const description = [...appointmentDetailLines(a), `Open in PareCare: ${openInApp(a.care_profile_id, 'appointments', a.id, base)}`].join('\n');
  return [
    'BEGIN:VEVENT',
    `UID:appt-${a.id}@parecare`,
    `DTSTAMP:${icsDate(new Date())}`,
    ...(a.all_day ? allDayLines(start, zone) : [`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`]),
    `SUMMARY:${icsEscape(`${a.title}${a.provider?.name ? ` with ${a.provider.name}` : ''}`)}`,
    ...(place ? [`LOCATION:${icsEscape(place)}`] : []),
    `DESCRIPTION:${icsEscape(description)}`,
    // A day before and two hours before.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(`Tomorrow: ${a.title}`)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(`In two hours: ${a.title}`)}`,
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
  ];
}
