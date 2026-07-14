import { Router } from 'express';
import { db } from '../config/database';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import type { CareProfile, Reminder } from '../types';

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

  const medEvents = await expandMedicationEvents(String(req.params['id']), from, to);
  const birthdayEvents = await expandBirthdayEvents(String(req.params['id']), from, to);
  const healthEvents = await expandHealthStatusEvents(String(req.params['id']), from, to);
  const events = [...reminders, ...medEvents, ...birthdayEvents, ...healthEvents].sort(
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
}

// Expand each active medication's scheduled times across the date range into
// calendar events, marking a slot done if a dose was recorded that day.
async function expandMedicationEvents(profileId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const meds = await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where({ 'm.care_profile_id': profileId, 'm.active': true })
    .select('m.*', 'c.name as name');
  const withTimes = meds.filter((m) => Array.isArray(m.schedule_times) && m.schedule_times.length > 0);
  if (withTimes.length === 0) return [];

  const admins = await db('medication_administrations')
    .where({ care_profile_id: profileId })
    .whereBetween('administered_at', [from, to])
    .select('medication_id', 'administered_at');
  const doneByMedDay = new Set(
    admins.map((a) => `${a.medication_id}|${new Date(a.administered_at).toISOString().slice(0, 10)}`)
  );

  const events: CalendarEvent[] = [];
  const dayCursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (; dayCursor <= to && events.length < 1000; dayCursor.setUTCDate(dayCursor.getUTCDate() + 1)) {
    const dayStr = dayCursor.toISOString().slice(0, 10);
    for (const med of withTimes) {
      for (const t of med.schedule_times as string[]) {
        const when = new Date(`${dayStr}T${t}:00Z`);
        if (when < from || when > to) continue;
        events.push({
          id: `med-${med.id}-${dayStr}-${t}`,
          title: `💊 ${med.name}${med.dose ? ` ${med.dose}` : ''}`,
          next_due_at: when.toISOString(),
          completed: doneByMedDay.has(`${med.id}|${dayStr}`),
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
      });
    }
  }
  return events;
}

async function expandHealthStatusEvents(profileId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const statuses = await db('health_statuses')
    .where({ care_profile_id: profileId })
    .select('id', 'name', 'onset_date', 'expected_resolution_date', 'actual_resolution_date', 'status');

  const events: CalendarEvent[] = [];
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  for (const hs of statuses) {
    const onset = String(hs.onset_date).slice(0, 10);
    if (onset >= fromStr && onset <= toStr) {
      events.push({
        id: `hs-onset-${hs.id}`,
        title: `🤒 ${hs.name} onset`,
        next_due_at: new Date(onset + 'T00:00:00Z').toISOString(),
        completed: false,
        kind: 'health_status',
      });
    }
    if (hs.expected_resolution_date) {
      const exp = String(hs.expected_resolution_date).slice(0, 10);
      if (exp >= fromStr && exp <= toStr) {
        events.push({
          id: `hs-expected-${hs.id}`,
          title: `🤒 ${hs.name} expected resolution`,
          next_due_at: new Date(exp + 'T00:00:00Z').toISOString(),
          completed: hs.status === 'resolved',
          kind: 'health_status',
        });
      }
    }
    if (hs.actual_resolution_date) {
      const actual = String(hs.actual_resolution_date).slice(0, 10);
      if (actual >= fromStr && actual <= toStr) {
        events.push({
          id: `hs-resolved-${hs.id}`,
          title: `✅ ${hs.name} resolved`,
          next_due_at: new Date(actual + 'T00:00:00Z').toISOString(),
          completed: true,
          kind: 'health_status',
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
  const url = `${env.APP_URL}/api/v1/calendar/${profile.ics_token}.ics`;
  res.json({ url, webcal: url.replace(/^https?:\/\//, 'webcal://') });
});

// Public feed — authenticated by the unguessable per-profile token, so
// Google Calendar / Outlook can subscribe to it without a login.
export const icsRouter = Router();

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const FREQ: Record<string, string> = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' };

icsRouter.get('/:token.ics', async (req, res) => {
  const profile = await db<CareProfile & { ics_token: string }>('care_profiles')
    .where({ ics_token: req.params['token'], archived: false })
    .first();
  if (!profile) {
    res.status(404).send('Not found');
    return;
  }

  // Everything from the last 30 days onward, including completed one-offs
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const reminders = await db<Reminder>('reminders')
    .where({ care_profile_id: profile.id })
    .where('next_due_at', '>=', since)
    .orderBy('next_due_at', 'asc')
    .limit(500);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PareCare//Care Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(`PareCare — ${profile.full_name}`)}`,
  ];

  for (const r of reminders) {
    const start = new Date(r.next_due_at);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.id}@parecare`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(r.title)}`
    );
    if (r.body) lines.push(`DESCRIPTION:${icsEscape(r.body)}`);
    if (r.reminder_type !== 'once' && FREQ[r.reminder_type]) {
      lines.push(`RRULE:FREQ=${FREQ[r.reminder_type]}`);
    }
    if (r.completed) lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }

  // Birthday and health status events
  const icsBirthdays = await expandBirthdayEvents(profile.id, since, new Date(Date.now() + 365 * 24 * 3600 * 1000));
  for (const e of icsBirthdays) {
    const start = new Date(e.next_due_at);
    const dayStr = start.toISOString().slice(0, 10).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@parecare`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART;VALUE=DATE:${dayStr}`,
      `SUMMARY:${icsEscape(e.title)}`,
      'END:VEVENT'
    );
  }

  const icsHealth = await expandHealthStatusEvents(profile.id, since, new Date(Date.now() + 90 * 24 * 3600 * 1000));
  for (const e of icsHealth) {
    const start = new Date(e.next_due_at);
    const dayStr = start.toISOString().slice(0, 10).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@parecare`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART;VALUE=DATE:${dayStr}`,
      `SUMMARY:${icsEscape(e.title)}`,
      'END:VEVENT'
    );
  }

  // Medication schedule for the next ~60 days.
  const medEvents = await expandMedicationEvents(profile.id, since, new Date(Date.now() + 60 * 24 * 3600 * 1000));
  for (const e of medEvents) {
    const start = new Date(e.next_due_at);
    const end = new Date(start.getTime() + 15 * 60 * 1000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@parecare`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(e.title)}`
    );
    if (e.completed) lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="parecare.ics"');
  res.send(lines.join('\r\n') + '\r\n');
});
