import { db } from '../config/database';

/**
 * What recording a death stops, and what clearing it puts back.
 *
 * When a date of death is first recorded, everything still running for that
 * person stops: open tasks close (so no more reminder emails), and future
 * appointments are cancelled but kept on the record as history. Dose and
 * supply alerts, the calendar feed and future medication times stop on their
 * own, because they check the date of death as they run.
 *
 * Each closed task and cancelled appointment is marked as stopped by the
 * death, so clearing the date by mistake reopens exactly those, as they were.
 * Changing the date from one day to another touches nothing.
 */

export interface DeathChange {
  /** 'stopped' when a death was just recorded, 'restored' when it was cleared. */
  kind: 'stopped' | 'restored';
  tasks: number;
  appointments: number;
  /** One plain sentence for the screen, saying what happened. */
  message: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const joinList = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

export async function applyDeathChange(
  profileId: string,
  before: string | Date | null | undefined,
  after: string | Date | null | undefined
): Promise<DeathChange | null> {
  const was = !!before;
  const now = !!after;
  if (was === now) return null;

  if (now) {
    const stamp = new Date();
    const tasks = await db('reminders')
      .where({ care_profile_id: profileId, completed: false })
      .update({ completed: true, completed_at: stamp, stopped_by_death_at: stamp });
    // Anything still to come, or waiting to be booked.
    const appointments = await db('appointments')
      .where({ care_profile_id: profileId })
      .whereIn('status', ['scheduled', 'to_book'])
      .where((qb) => qb.whereNull('starts_at').orWhere('starts_at', '>', stamp))
      .update({ status_before_death: db.ref('status'), status: 'cancelled', updated_at: stamp });
    const parts = [
      'Task reminders, dose and supply alerts and the calendar feed have stopped',
      tasks > 0 ? `${plural(tasks, 'open task is', 'open tasks are')} closed` : null,
      appointments > 0 ? `${plural(appointments, 'future appointment is', 'future appointments are')} cancelled but kept as history` : null,
    ].filter(Boolean) as string[];
    const message = `${joinList(parts)}. Clearing the date of death puts everything back.`;
    return { kind: 'stopped', tasks, appointments, message };
  }

  // Only what is still as the death left it goes back: a task someone has
  // since reopened or ticked off by hand, or an appointment whose status a
  // person changed, keeps what they did.
  const tasks = await db('reminders')
    .where({ care_profile_id: profileId, completed: true })
    .whereNotNull('stopped_by_death_at')
    .whereNull('completed_by_account_id')
    .update({ completed: false, completed_at: null, stopped_by_death_at: null });
  await db('reminders').where({ care_profile_id: profileId }).whereNotNull('stopped_by_death_at').update({ stopped_by_death_at: null });
  const appointments = await db('appointments')
    .where({ care_profile_id: profileId, status: 'cancelled' })
    .whereNotNull('status_before_death')
    .update({ status: db.ref('status_before_death'), status_before_death: null, updated_at: db.fn.now() });
  await db('appointments').where({ care_profile_id: profileId }).whereNotNull('status_before_death').update({ status_before_death: null });
  const parts = [
    'Reminders, alerts and the calendar feed are running again',
    tasks > 0 ? `${plural(tasks, 'task is', 'tasks are')} open again` : null,
    appointments > 0 ? `${plural(appointments, 'appointment is back as it was', 'appointments are back as they were')}` : null,
  ].filter(Boolean) as string[];
  const message = `${joinList(parts)}.`;
  return { kind: 'restored', tasks, appointments, message };
}
