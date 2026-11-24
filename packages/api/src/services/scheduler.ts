import { db } from '../config/database';
import { getSchedulerConfig, onSettingsChange } from '../config/settings';
import { sendReminderEmail } from './email';
import type { Reminder } from '../types';
import { nextAfter, ruleFor } from '../lib/repeat';
import { topUpAllSeries } from './booking';

interface DueReminder extends Reminder {
  profile_owner_id: string;
  owner_timezone: string | null;
}

/**
 * Who a due task's reminder goes to: whoever it is assigned to, at their
 * login's email or, for someone added by name, the email kept for them. Added
 * by name with no email, the reminder goes to whoever manages the profile,
 * with a line saying to remind them by phone.
 */
export async function resolveRecipient(
  reminder: Pick<DueReminder, 'assigned_account_id' | 'assigned_to' | 'profile_owner_id'>
): Promise<{ email: string; name: string; note: string | null } | null> {
  if (reminder.assigned_account_id) {
    const acc = await db('accounts').where({ id: reminder.assigned_account_id }).first('email', 'display_name');
    if (acc) return { email: acc.email, name: acc.display_name, note: null };
  }
  let note: string | null = null;
  if (reminder.assigned_to) {
    const member = await db('care_circle_members')
      .leftJoin('accounts', 'care_circle_members.account_id', 'accounts.id')
      .where('care_circle_members.id', reminder.assigned_to)
      .select(
        'care_circle_members.display_name',
        'care_circle_members.invited_email',
        'care_circle_members.email as member_email',
        'care_circle_members.phone as member_phone',
        'accounts.email as account_email',
        'accounts.phone as account_phone'
      )
      .first();
    if (member) {
      const email = member.account_email ?? member.member_email ?? member.invited_email;
      if (email) return { email, name: member.display_name, note: null };
      const phone = member.account_phone ?? member.member_phone;
      note = phone
        ? `${member.display_name} has no email in PareCare. Remind them on ${phone}.`
        : `${member.display_name} has no email or phone in PareCare. Remind them yourself, and add their phone in the care circle.`;
    }
  }
  const owner = await db('accounts').where({ id: reminder.profile_owner_id }).first();
  return owner ? { email: owner.email, name: owner.display_name, note } : null;
}

let lastSeriesTopUp = 0;

async function tick(): Promise<void> {
  const now = new Date();
  // Repeating appointments are kept a season ahead, checked once a day.
  if (now.getTime() - lastSeriesTopUp > 24 * 3600 * 1000) {
    lastSeriesTopUp = now.getTime();
    await topUpAllSeries().catch((err) => console.warn('Repeating appointments top-up failed:', (err as Error).message));
  }
  const due = await db<Reminder>('reminders')
    .join('care_profiles', 'reminders.care_profile_id', 'care_profiles.id')
    .where('reminders.completed', false)
    // No reminder emails about someone who has died.
    .whereNull('care_profiles.died_on')
    // Any time that day: the reminder goes out at 8am that day, not midnight.
    .where((qb) => {
      qb.where((w) => w.where('reminders.all_day', false).where('reminders.next_due_at', '<=', now)).orWhere((w) =>
        w.where('reminders.all_day', true).whereRaw("reminders.next_due_at + interval '8 hours' <= ?", [now])
      );
    })
    .where((qb) => {
      qb.whereNull('reminders.last_notified_at').orWhereRaw('reminders.last_notified_at < reminders.next_due_at');
    })
    .join('accounts as owner', 'care_profiles.account_id', 'owner.id')
    .select<DueReminder[]>('reminders.*', 'care_profiles.account_id as profile_owner_id', 'owner.timezone as owner_timezone')
    .limit(100);

  for (const reminder of due) {
    const recipient = await resolveRecipient(reminder);
    if (recipient) {
      const body = [recipient.note, reminder.body].filter(Boolean).join(' ') || null;
      await sendReminderEmail(recipient.email, recipient.name, reminder.title, body).catch((err) =>
        console.warn(`Reminder email failed for "${reminder.title}":`, (err as Error).message)
      );
    }

    const updates: Record<string, unknown> = { last_notified_at: now };
    const rule = ruleFor(reminder);
    if (rule) {
      // Roll recurring reminders forward past now so they come due again, on
      // the same wall-clock time where the person lives.
      updates.next_due_at = nextAfter(new Date(reminder.next_due_at), rule, now, reminder.owner_timezone);
      updates.last_notified_at = null;
    }
    await db('reminders').where({ id: reminder.id }).update(updates);
    // A new round is due: the journey step it carries out is open again.
    const itemId = (reminder as unknown as { checklist_item_id?: string | null }).checklist_item_id;
    if (rule && itemId) {
      await db('checklist_items')
        .where({ id: itemId, completed: true })
        .update({ completed: false, completed_at: null, completed_by: null, achieved_on: null })
        .catch((err) => console.warn('Reopening a journey step failed:', (err as Error).message));
    }
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
