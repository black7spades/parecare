import type { Knex } from 'knex';

/**
 * An appointment that is not booked yet.
 *
 * Often everything about an appointment is known except when: who it is with,
 * where, what for, the notes that go with it. Those details are kept on a real
 * appointment with no date and the status to_book, shown as Not booked yet.
 * A to-do keeps it in view until the date is added, at which point it becomes
 * a scheduled appointment and the to-do is ticked off. Dateless appointments
 * never reach the calendar, reminders or "how did it go", since every one of
 * those looks for a date.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE appointments ALTER COLUMN starts_at DROP NOT NULL');
}

export async function down(knex: Knex): Promise<void> {
  // Anything still waiting for a date is given today, so nothing is lost.
  await knex.raw(`UPDATE appointments SET starts_at = now(), status = 'scheduled' WHERE starts_at IS NULL`);
  await knex.raw('ALTER TABLE appointments ALTER COLUMN starts_at SET NOT NULL');
}
