import { db } from '../config/database';
import { getSchedulerConfig, onSettingsChange } from '../config/settings';
import { sendReminderEmail } from './email';
import type { Reminder } from '../types';

interface DueReminder extends Reminder {
  profile_owner_id: string;
}

function advance(date: Date, type: Reminder['reminder_type']): Date {
  const next = new Date(date);
  if (type === 'daily') next.setDate(next.getDate() + 1);
  else if (type === 'weekly') next.setDate(next.getDate() + 7);
  else if (type === 'monthly') next.setMonth(next.getMonth() + 1);
  return next;
}

async function resolveRecipient(reminder: DueReminder): Promise<{ email: string; name: string } | null> {
  if (reminder.assigned_to) {
    const member = await db('care_circle_members')
      .leftJoin('accounts', 'care_circle_members.account_id', 'accounts.id')
      .where('care_circle_members.id', reminder.assigned_to)
      .select(
        'care_circle_members.display_name',
        'care_circle_members.invited_email',
        'accounts.email as account_email'
      )
      .first();
    if (member) {
      const email = member.account_email ?? member.invited_email;
      if (email) return { email, name: member.display_name };
    }
  }
  const owner = await db('accounts').where({ id: reminder.profile_owner_id }).first();
  return owner ? { email: owner.email, name: owner.display_name } : null;
}

async function tick(): Promise<void> {
  const now = new Date();
  const due = await db<Reminder>('reminders')
    .join('care_profiles', 'reminders.care_profile_id', 'care_profiles.id')
    .where('reminders.completed', false)
    .where('reminders.next_due_at', '<=', now)
    .where((qb) => {
      qb.whereNull('reminders.last_notified_at').orWhereRaw('reminders.last_notified_at < reminders.next_due_at');
    })
    .select<DueReminder[]>('reminders.*', 'care_profiles.account_id as profile_owner_id')
    .limit(100);

  for (const reminder of due) {
    const recipient = await resolveRecipient(reminder);
    if (recipient) {
      await sendReminderEmail(recipient.email, recipient.name, reminder.title, reminder.body).catch((err) =>
        console.warn(`Reminder email failed for "${reminder.title}":`, (err as Error).message)
      );
    }

    const updates: Record<string, unknown> = { last_notified_at: now };
    if (reminder.reminder_type !== 'once') {
      // Roll recurring reminders forward past now so they come due again
      let next = new Date(reminder.next_due_at);
      while (next <= now) next = advance(next, reminder.reminder_type);
      updates.next_due_at = next;
      updates.last_notified_at = null;
    }
    await db('reminders').where({ id: reminder.id }).update(updates);
  }
}

let timer: NodeJS.Timeout | null = null;

// A self-rescheduling timeout (rather than a fixed setInterval) so a changed
// interval from the settings screen takes effect on the next cycle, and so a
// save can re-arm it immediately.
function scheduleNext(): void {
  const interval = getSchedulerConfig().reminderIntervalMs;
  if (interval <= 0) {
    timer = null;
    return;
  }
  timer = setTimeout(() => {
    tick()
      .catch((err) => console.error('Reminder scheduler error:', err))
      .finally(() => scheduleNext());
  }, interval);
  timer.unref();
}

/** Clear the pending cycle and reschedule with the current interval. */
export function rearmScheduler(): void {
  if (timer) clearTimeout(timer);
  scheduleNext();
}

/**
 * Emails due reminders to their assignee (or the profile owner) and rolls
 * recurring reminders forward — previously recurring tasks stayed overdue
 * forever and nothing ever called sendReminderEmail.
 */
export function startReminderScheduler(): void {
  onSettingsChange(rearmScheduler);
  const interval = getSchedulerConfig().reminderIntervalMs;
  if (interval <= 0) {
    console.log('Reminder scheduler disabled (interval <= 0).');
    return;
  }
  scheduleNext();
  console.log(`Reminder scheduler running (every ${Math.round(interval / 1000)}s).`);
}
