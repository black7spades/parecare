import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reminders', (t) => {
    t.text('completion_reason').nullable();
    t.string('completion_note', 240).nullable();
  });

  await knex.schema.createTable('task_notes', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('reminder_id').notNullable().references('id').inTable('reminders').onDelete('CASCADE');
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.text('content').notNullable();
    t.timestamps(true, true);
    t.index(['reminder_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('task_notes');
  await knex.schema.alterTable('reminders', (t) => {
    t.dropColumn('completion_reason');
    t.dropColumn('completion_note');
  });
}
