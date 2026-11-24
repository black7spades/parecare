import { db } from '../config/database';
import { dateInZone, parseZonedTime } from '../lib/timezone';
import { dayText } from '../lib/dayText';

/**
 * The standard care plan review: at least once a year. The date is set once,
 * the first time a plan is built, and then kept, so rebuilding the plan does
 * not push the review another year out each time. Only a person changes it.
 *
 * A reminder task is made ahead of it, so the review is booked in time
 * rather than noticed after it is overdue.
 */

/** How far ahead of the review the reminder task falls. */
const REMIND_DAYS_BEFORE = 14;
const TASK_TITLE = 'Get ready for the care plan review';

const formatDay = (ymd: string): string =>
  dayText(ymd, null, 'long');

async function ownerTimeZone(profileId: string): Promise<string | null> {
  const row = await db('care_profiles as cp')
    .join('accounts as a', 'cp.account_id', 'a.id')
    .where('cp.id', profileId)
    .first('a.timezone');
  return (row?.timezone as string | null | undefined) ?? null;
}

/** 9am on the reminder day, on the owner's clock; never in the past. */
function remindAt(dueOn: string, timeZone: string | null): Date {
  const day = new Date(`${dueOn}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - REMIND_DAYS_BEFORE);
  const ymd = day.toISOString().slice(0, 10);
  const at = parseZonedTime(`${ymd}T09:00:00`, timeZone) ?? new Date(`${ymd}T09:00:00Z`);
  return at.getTime() < Date.now() ? new Date() : at;
}

/** Make the reminder task when there is none, or move it to match the date. */
async function syncReviewTask(profileId: string, dueOn: string, taskId: string | null, recreate = false): Promise<void> {
  const tz = await ownerTimeZone(profileId);
  const body = `The care plan is due for its yearly review by ${formatDay(dueOn)}. Book a time with the people involved in their care.`;
  if (taskId) {
    const task = await db('reminders').where({ id: taskId, care_profile_id: profileId }).first();
    if (task && !task.completed) {
      await db('reminders').where({ id: taskId }).update({ next_due_at: remindAt(dueOn, tz), body });
      return;
    }
    // A task someone deleted or already ticked off is left alone, unless a
    // person has just set a new date, which earns a fresh reminder.
    if (!recreate) return;
  }
  const [task] = await db('reminders')
    .insert({
      care_profile_id: profileId,
      title: TASK_TITLE,
      body,
      reminder_type: 'once',
      next_due_at: remindAt(dueOn, tz),
    })
    .returning('id');
  await db('care_profiles')
    .where({ id: profileId })
    .update({ care_plan_review_task_id: (task as { id: string }).id });
}

/**
 * The standard review date for this person's plan, as YYYY-MM-DD. Set a
 * year from today the first time, then kept, with its reminder task made.
 */
export async function standardReviewDue(profileId: string): Promise<string> {
  const row = await db('care_profiles')
    .where({ id: profileId })
    .first('care_plan_review_due_on', 'care_plan_review_task_id');
  const kept = row?.care_plan_review_due_on ? String(row.care_plan_review_due_on).slice(0, 10) : null;
  if (kept) {
    // A date carried over from an earlier plan still earns its reminder.
    if (!row?.care_plan_review_task_id) await syncReviewTask(profileId, kept, null);
    return kept;
  }
  const tz = await ownerTimeZone(profileId);
  const today = dateInZone(new Date(), tz);
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  const dueOn = next.toISOString().slice(0, 10);
  await db('care_profiles').where({ id: profileId }).update({ care_plan_review_due_on: dueOn });
  await syncReviewTask(profileId, dueOn, (row?.care_plan_review_task_id as string | null | undefined) ?? null);
  return dueOn;
}

/** What the plan page shows: the kept date, or null before any plan exists. */
export async function reviewDueOn(profileId: string): Promise<string | null> {
  const row = await db('care_profiles').where({ id: profileId }).first('care_plan_review_due_on');
  return row?.care_plan_review_due_on ? String(row.care_plan_review_due_on).slice(0, 10) : null;
}

/** A person moves the review: the date is kept as they set it, and the reminder follows. */
export async function setReviewDue(profileId: string, dueOn: string): Promise<void> {
  const row = await db('care_profiles').where({ id: profileId }).first('care_plan_review_task_id');
  await db('care_profiles').where({ id: profileId }).update({ care_plan_review_due_on: dueOn });
  await syncReviewTask(profileId, dueOn, (row?.care_plan_review_task_id as string | null | undefined) ?? null, true);
}
