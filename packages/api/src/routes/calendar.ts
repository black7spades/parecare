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

  const events = await db<Reminder>('reminders')
    .where({ care_profile_id: req.params['id'] })
    .whereBetween('next_due_at', [from, to])
    .orderBy('next_due_at', 'asc');
  res.json({ events });
});

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

  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="parecare.ics"');
  res.send(lines.join('\r\n') + '\r\n');
});
