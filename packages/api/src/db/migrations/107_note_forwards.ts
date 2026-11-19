import type { Knex } from 'knex';

/**
 * Passing what one appointment found on to another.
 *
 * A doctor says "I can't do this, but a neurologist can", so what was said at
 * that visit needs to reach the neurology appointment. Each forward is one
 * piece of the visit (what happened, the appointment's notes, or one added
 * note), sent either to an appointment already booked or to a next step not
 * booked yet, such as the referral. A forward to a next step waits there and
 * lands on the appointment the moment that step is booked.
 *
 * The forwarded copy is an ordinary note on the receiving appointment that
 * knows which forward it came from, so it can say who it is from. The names
 * and dates are kept on the forward too, so the trail still reads if either
 * appointment is later deleted.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('note_forwards', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('source_appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    // outcome: what happened. details: the appointment's own notes box. note: one added note.
    t.string('source_part', 20).notNullable();
    t.uuid('source_note_id').nullable().references('id').inTable('record_notes').onDelete('SET NULL');
    t.text('body').notNullable();
    t.string('from_label', 255).notNullable();
    t.timestamp('from_on', { useTz: true }).notNullable();
    t.uuid('target_reminder_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
    t.uuid('target_appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.string('to_label', 255).notNullable();
    t.uuid('forwarded_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('delivered_at', { useTz: true }).nullable();
    t.timestamps(true, true);
    t.index(['care_profile_id', 'source_appointment_id']);
    t.index(['target_reminder_id']);
  });

  await knex.schema.alterTable('record_notes', (t) => {
    t.uuid('forward_id').nullable().references('id').inTable('note_forwards').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('record_notes', (t) => {
    t.dropColumn('forward_id');
  });
  await knex.schema.dropTableIfExists('note_forwards');
}
