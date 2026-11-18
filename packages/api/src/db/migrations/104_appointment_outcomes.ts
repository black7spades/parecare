import type { Knex } from 'knex';

/**
 * What came of an appointment, and the next steps it set off.
 *
 * The outcome is a short note on the appointment. Each next step (a referral,
 * a blood test, a prescription to fill) is a task, so it is tracked, nudged
 * and ticked off wherever tasks already are. A task knows the appointment it
 * came from and what kind of next step it is; an appointment booked to carry
 * out a next step knows which one, so the chain reads from the first visit on.
 *
 * Kinds of next step are one list per account, like document categories: a
 * wide built-in list, plus any the account adds by typing a new name.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('next_step_types', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.string('system_key', 50).nullable();
    // Set when deleted, so Undo can bring it back. Tasks keep pointing at it.
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamps(true, true);
    t.index(['account_id']);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX next_step_types_account_name_uq ON next_step_types (account_id, lower(name)) WHERE deleted_at IS NULL'
  );
  await knex.raw(
    'CREATE UNIQUE INDEX next_step_types_account_key_uq ON next_step_types (account_id, system_key) WHERE system_key IS NOT NULL'
  );

  await knex.schema.alterTable('appointments', (t) => {
    t.text('outcome').nullable();
    t.timestamp('outcome_recorded_at', { useTz: true }).nullable();
  });

  await knex.schema.alterTable('reminders', (t) => {
    t.uuid('appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.uuid('next_step_type_id').nullable().references('id').inTable('next_step_types').onDelete('SET NULL');
    t.index(['appointment_id']);
  });

  // An appointment booked to carry out a next step, such as the specialist
  // visit a referral led to.
  await knex.schema.alterTable('appointments', (t) => {
    t.uuid('from_reminder_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('appointments', (t) => {
    t.dropColumn('from_reminder_id');
  });
  await knex.schema.alterTable('reminders', (t) => {
    t.dropIndex(['appointment_id']);
    t.dropColumn('next_step_type_id');
    t.dropColumn('appointment_id');
  });
  await knex.schema.alterTable('appointments', (t) => {
    t.dropColumn('outcome_recorded_at');
    t.dropColumn('outcome');
  });
  await knex.schema.dropTableIfExists('next_step_types');
}
