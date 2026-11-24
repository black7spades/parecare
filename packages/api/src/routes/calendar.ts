import { Router } from 'express';
import { db } from '../config/database';
import { env } from '../config/env';
import { publicBase } from '../lib/publicUrl';
import { requireAuth } from '../middleware/auth';
import type { CareProfile, Reminder } from '../types';
import { dateInZone, isValidTimeZone, parseZonedTime } from '../lib/timezone';
import { coveredTimes, doseAnchor } from '../lib/doseSlots';
import { ruleFor } from '../lib/repeat';
import { enrichAppointments } from '../services/booking';
import { allDayLines, appointmentEvent, calendarText, icsDate, icsEscape, openInApp } from '../services/ics';
import type { ContactSummary } from '../services/professionals';

// Authenticated, per-profile calendar endpoints
export const calendarRouter = Router({ mergeParams: true });

calendarRouter.get('/', requireAuth, async (req, res) => {
  const from = req.query['from'] ? new Date(String(req.query['from'])) : new Date();
  const to = req.query['to']
    ? new Date(String(req.query['to']))
    : new Date(Date.now() + 90 * 24 * 3600 * 1000);

  const reminders = await db<Reminder>('reminders')
    .where({ care_profile_id: req.params['id'] })
    .whereBetween('next_due_at', [from, to])
    .orderBy('next_due_at', 'asc');

  // Medication times are wall-clock times where the person lives, so they are
  // placed in the viewer's zone (sent by the browser), else the account's.
  const tzParam = req.query['tz'] ? String(req.query['tz']) : null;
  const tz = isValidTimeZone(tzParam) ? tzParam : (req.account as { timezone?: string | null } | undefined)?.timezone ?? null;
  const medEvents = await expandMedicationEvents(String(req.params['id']), from, to, tz);
  const birthdayEvents = await expandBirthdayEvents(String(req.params['id']), from, to);
  const healthEvents = await expandHealthStatusEvents(String(req.params['id']), from, to);
  const appointmentEvents = await expandAppointmentEvents(String(req.params['id']), from, to);
  const events = [...reminders, ...medEvents, ...birthdayEvents, ...healthEvents, ...appointmentEvents].sort(
    (a, b) => new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime()
  );
  res.json({ events });
});

interface CalendarEvent {
  id: string;
  title: string;
  next_due_at: string;
  completed: boolean;
  kind?: string;
  medication_id?: string;
  appointment_id?: string;
  // The condition an appointment came out of, so the calendar can mark it and
  // the whole thread of one condition reads at a glance.
  medical_condition_id?: string | null;
  medical_condition_name?: string | null;
  location?: string | null;
  // A map or directions URL for the event's location, when one is known.
  directions_link?: string | null;
  // Whole-day events (birthdays, illness milestones) carry no meaningful
  // clock time, so the UI shows the date alone.
  all_day?: boolean;
}

/** Whether a string is an http(s) URL we can safely turn into a link. */
function isUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}

// Appointments are their own table; the calendar shows each one at its
// start time, marked done when it has been completed.
async function expandAppointmentEvents(profileId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const appointments = await db('appointments as a')
    .leftJoin('providers as p', 'a.provider_id', 'p.id')
    .leftJoin('medical_conditions as mc', 'a.medical_condition_id', 'mc.id')
    .where('a.care_profile_id', profileId)
    .whereBetween('a.starts_at', [from, to])
    .whereNot('a.status', 'cancelled')
    .select(
      'a.id',
      'a.title',
      'a.starts_at',
      'a.status',
      'a.location',
      'a.directions_link',
      'a.all_day',
      'a.medical_condition_id',
      'mc.name as medical_condition_name',
      'p.name as provider_name',
      'p.directions_link as provider_directions_link'
    );
  return appointments.map((a) => {
    // A directions link comes from the appointment's own map link first, then
    // the provider's saved one, then a location entered as a URL.
    const directions = isUrl(a.directions_link)
      ? a.directions_link
      : isUrl(a.provider_directions_link)
        ? a.provider_directions_link
        : isUrl(a.location)
          ? a.location
          : null;
    return {
      id: `appt-${a.id}`,
      title: `🩺 ${a.title}${a.provider_name ? ` with ${a.provider_name}` : ''}`,
      next_due_at: new Date(a.starts_at).toISOString(),
      completed: a.status === 'completed',
      kind: 'appointment',
      appointment_id: a.id,
      medical_condition_id: a.medical_condition_id ?? null,
      medical_condition_name: a.medical_condition_name ?? null,
      // Show a URL location only as a button, never as raw text.
      location: isUrl(a.location) ? null : (a.location ?? null),
      directions_link: directions,
      // No set time: the day alone.
      all_day: !!a.all_day,
    };
  });
}

// Expand each active medication's scheduled times across the date range into
// calendar events. Each time is its own dose: a dose recorded against a time
// covers that time, and any other dose recorded that day covers the earliest
// time still open. So two of three doses recorded leaves one still to give.
async function expandMedicationEvents(
  profileId: string,
  from: Date,
  to: Date,
  timeZone: string | null = null
): Promise<CalendarEvent[]> {
  // Medicine times end on the day someone died: from that day nothing is
  // still to give, as on the medication record. A dose given that day stays.
  const person = await db('care_profiles').where({ id: profileId }).first('died_on');
  let diedOn: string | null = null;
  if (person?.died_on) {
    const day = person.died_on instanceof Date ? person.died_on.toISOString().slice(0, 10) : String(person.died_on).slice(0, 10);
    diedOn = day;
    const zoneForDay = isValidTimeZone(timeZone) ? timeZone : 'UTC';
    const lastDay = parseZonedTime(`${day}T23:59:59`, zoneForDay) ?? new Date(`${day}T23:59:59Z`);
    if (lastDay < to) to = lastDay;
    if (from > to) return [];
  }
  const meds = await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where({ 'm.care_profile_id': profileId, 'm.active': true })
    .select('m.*', 'c.name as name');
  const withTimes = meds.filter((m) => Array.isArray(m.schedule_times) && m.schedule_times.length > 0);
  if (withTimes.length === 0) return [];

  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const slotAt = (day: string, hm: string) => parseZonedTime(`${day}T${hm}:00`, zone) ?? new Date(`${day}T${hm}:00Z`);

  // Doses a day either side of the range, since a local day can straddle it.
  const pad = 24 * 3600 * 1000;
  const admins = await db('medication_administrations')
    .where({ care_profile_id: profileId })
    .whereIn('medication_id', withTimes.map((m) => m.id))
    .where((qb) =>
      qb
        .whereBetween('administered_at', [new Date(from.getTime() - pad), new Date(to.getTime() + pad)])
        .orWhereBetween('scheduled_for', [new Date(from.getTime() - pad), new Date(to.getTime() + pad)])
    )
    .select('medication_id', 'administered_at', 'scheduled_for');

  // Doses grouped by medication and the local day they belong to.
  const dosesByMedDay = new Map<string, typeof admins>();
  for (const a of admins) {
    const key = `${a.medication_id}|${dateInZone(doseAnchor(a), zone)}`;
    const list = dosesByMedDay.get(key) ?? [];
    list.push(a);
    dosesByMedDay.set(key, list);
  }

  const days: string[] = [];
  const last = dateInZone(to, zone);
  for (let d = dateInZone(from, zone), guard = 0; d <= last && guard < 400; guard++) {
    days.push(d);
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }

  // In hospital the hospital gives the medicines: from the day they went in
  // up to the day before they came home, nothing is due here, as on the
  // medication record.
  const stays = (await db('hospital_stays')
    .where({ care_profile_id: profileId })
    .where('admitted_on', '<=', days[days.length - 1] ?? dateInZone(to, zone))
    .where((qb) => qb.whereNull('discharged_on').orWhere('discharged_on', '>', days[0] ?? dateInZone(from, zone)))
    .select('admitted_on', 'discharged_on')) as Array<{ admitted_on: unknown; discharged_on: unknown }>;
  const dayOf = (v: unknown) => (v instanceof Date ? dateInZone(v, 'UTC') : v ? String(v).slice(0, 10) : null);
  const paused = (day: string) =>
    (diedOn !== null && day >= diedOn) ||
    stays.some((s) => {
      const inOn = dayOf(s.admitted_on);
      const outOn = dayOf(s.discharged_on);
      return !!inOn && day >= inOn && (!outOn || day < outOn);
    });

  const events: CalendarEvent[] = [];
  for (const day of days) {
    const nothingDue = paused(day);
    for (const med of withTimes) {
      // After the last day of a course, its doses are not due.
      if (med.course_ends_on && day > String(med.course_ends_on).slice(0, 10)) continue;
      const times = [...new Set(med.schedule_times as string[])].sort();
      const covered = coveredTimes(times, dosesByMedDay.get(`${med.id}|${day}`) ?? [], zone);
      for (const t of times) {
        const when = slotAt(day, t);
        if (when < from || when > to || events.length >= 1000) continue;
        if (nothingDue && !covered.has(t)) continue;
        events.push({
          id: `med-${med.id}-${day}-${t}`,
          title: `💊 ${med.name}${med.dose ? ` ${med.dose}` : ''}`,
          next_due_at: when.toISOString(),
          completed: covered.has(t),
          kind: 'medication',
          medication_id: med.id,
        });
      }
    }
  }
  return events;
}

async function expandBirthdayEvents(profileId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const profile = await db('care_profiles')
    .where({ id: profileId })
    .select('id', 'full_name', 'date_of_birth')
    .first();
  if (!profile?.date_of_birth) return [];
  const dob = new Date(profile.date_of_birth);
  if (Number.isNaN(dob.getTime())) return [];

  const events: CalendarEvent[] = [];
  const startYear = from.getUTCFullYear();
  const endYear = to.getUTCFullYear();
  for (let year = startYear; year <= endYear; year++) {
    const bday = new Date(Date.UTC(year, dob.getUTCMonth(), dob.getUTCDate()));
    if (bday >= from && bday <= to) {
      const age = year - dob.getUTCFullYear();
      events.push({
        id: `birthday-${profileId}-${year}`,
        title: `🎂 ${profile.full_name}'s birthday${age > 0 ? ` (turning ${age})` : ''}`,
        next_due_at: bday.toISOString(),
        completed: false,
        kind: 'birthday',
        all_day: true,
      });
    }
  }
  return events;
}

// Sickness milestones on the calendar come from acute conditions: when an
// illness or injury started, and when it resolved. Health status lives on
// conditions now, not the retired health_statuses table.
async function expandHealthStatusEvents(profileId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const conditions = await db('medical_conditions')
    .where({ care_profile_id: profileId })
    .whereIn('category', ['illness', 'acute_illness', 'chronic_flare', 'injury', 'post_operative', 'recovery'])
    .select('id', 'name', 'started_on', 'resolved_on', 'status');

  const events: CalendarEvent[] = [];
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  for (const c of conditions) {
    if (c.started_on) {
      const onset = String(c.started_on).slice(0, 10);
      if (onset >= fromStr && onset <= toStr) {
        events.push({
          id: `hs-onset-${c.id}`,
          title: `🤒 ${c.name} started`,
          next_due_at: new Date(onset + 'T00:00:00Z').toISOString(),
          completed: false,
          kind: 'health_status',
          all_day: true,
        });
      }
    }
    if (c.resolved_on) {
      const resolved = String(c.resolved_on).slice(0, 10);
      if (resolved >= fromStr && resolved <= toStr) {
        events.push({
          id: `hs-resolved-${c.id}`,
          title: `✅ ${c.name} resolved`,
          next_due_at: new Date(resolved + 'T00:00:00Z').toISOString(),
          completed: true,
          kind: 'health_status',
          all_day: true,
        });
      }
    }
  }
  return events;
}

calendarRouter.get('/feed', requireAuth, async (req, res) => {
  const profile = await db<CareProfile>('care_profiles').where({ id: req.params['id'] }).first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  const url = `${publicBase(req)}/api/v1/calendar/${profile.ics_token}.ics`;
  res.json({ url, webcal: url.replace(/^https?:\/\//, 'webcal://') });
});

// Public feed: authenticated by the unguessable per-profile token, so
// Google Calendar or Outlook can subscribe to it without a login. What goes
// out helps someone turn up: times, places, phones and what to bring, with a
// link back into PareCare. Task notes and appointment notes never go.
export const icsRouter = Router();

const FREQ: Record<string, string> = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' };

icsRouter.get('/:token.ics', async (req, res) => {
  const profile = await db<CareProfile & { ics_token: string }>('care_profiles')
    .where({ ics_token: req.params['token'], archived: false })
    .first();
  if (!profile) {
    res.status(404).send('Not found');
    return;
  }
  const calName = `PareCare, ${profile.full_name}`;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="parecare.ics"');

  // Once a death is recorded the feed stops: an empty calendar clears every
  // event from the calendars subscribed to it. Clearing the date restores it.
  if (profile.died_on) {
    res.send(calendarText(calName, []));
    return;
  }

  // Everything from the last 30 days onward, including finished one-offs.
  // A task joined into another is not a task of its own any more.
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const reminders = await db<Reminder>('reminders')
    .where({ care_profile_id: profile.id })
    .where('next_due_at', '>=', since)
    .whereNull('merged_into_id')
    .orderBy('next_due_at', 'asc')
    .limit(500);

  const lines: string[] = [];
  // A task due any time that day is a whole-day event in the owner's zone.
  const ownerZone = ((await db('accounts').where({ id: profile.account_id }).first('timezone')) as { timezone?: string | null } | undefined)?.timezone ?? null;
  for (const r of reminders) {
    const start = new Date(r.next_due_at);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.id}@parecare`,
      `DTSTAMP:${icsDate(new Date())}`,
      ...(r.all_day ? allDayLines(start, ownerZone) : [`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`]),
      // A finished task stays on the calendar, marked done, never cancelled.
      `SUMMARY:${icsEscape(r.completed ? `Done: ${r.title}` : r.title)}`,
      // Task notes stay in PareCare: only the way back in goes out.
      `DESCRIPTION:${icsEscape(`Open in PareCare: ${openInApp(profile.id, 'tasks', r.id, publicBase(req))}`)}`,
      'STATUS:CONFIRMED'
    );
    // The stored rule is the truth, so every 2 weeks or every year repeats right.
    const rule = ruleFor(r);
    if (rule) lines.push(`RRULE:${rule}`);
    else if (r.reminder_type !== 'once' && FREQ[r.reminder_type]) lines.push(`RRULE:FREQ=${FREQ[r.reminder_type]}`);
    lines.push('END:VEVENT');
  }

  // Birthday and health status events
  const icsBirthdays = await expandBirthdayEvents(profile.id, since, new Date(Date.now() + 365 * 24 * 3600 * 1000));
  const icsHealth = await expandHealthStatusEvents(profile.id, since, new Date(Date.now() + 90 * 24 * 3600 * 1000));
  for (const e of [...icsBirthdays, ...icsHealth]) {
    const dayStr = new Date(e.next_due_at).toISOString().slice(0, 10).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${e.id}@parecare`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART;VALUE=DATE:${dayStr}`, `SUMMARY:${icsEscape(e.title)}`, 'END:VEVENT');
  }

  // Appointments, with the place, who it is with and their phone, what to
  // bring, how to get ready, and an alarm the day before and two hours before.
  const icsAppointments = (await db('appointments')
    .where({ care_profile_id: profile.id })
    .whereNotNull('starts_at')
    .where('starts_at', '>=', since)
    .whereNot('status', 'cancelled')
    .orderBy('starts_at', 'asc')
    .limit(500)) as Array<Record<string, unknown> & { id: string }>;
  const enriched = (await enrichAppointments(db, profile.id, icsAppointments)) as unknown as Array<
    Record<string, unknown> & { id: string; provider: ContactSummary | null; bring_documents: Array<{ label: string }> }
  >;
  for (const a of enriched) {
    lines.push(
      ...appointmentEvent(
        {
          id: a.id,
          care_profile_id: profile.id,
          title: String(a['title']),
          starts_at: a['starts_at'] as Date,
          ends_at: (a['ends_at'] as Date | null) ?? null,
          all_day: !!a['all_day'],
          location: (a['location'] as string | null) ?? null,
          telehealth_link: (a['telehealth_link'] as string | null) ?? null,
          preparation: (a['preparation'] as string | null) ?? null,
          provider: a.provider ?? null,
          bring: (a.bring_documents ?? []).map((d) => d.label),
        },
        ownerZone,
        publicBase(req)
      )
    );
  }

  // Medication schedule for the next ~60 days.
  // Times are the owner's wall-clock times, so place them in the owner's zone.
  const medEvents = await expandMedicationEvents(profile.id, since, new Date(Date.now() + 60 * 24 * 3600 * 1000), ownerZone);
  for (const e of medEvents) {
    const start = new Date(e.next_due_at);
    const end = new Date(start.getTime() + 15 * 60 * 1000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@parecare`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(e.title)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT'
    );
  }

  res.send(calendarText(calName, lines));
});
