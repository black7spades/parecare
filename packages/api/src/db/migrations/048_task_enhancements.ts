import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reminders', (t) => {
    t.text('desired_outcome').nullable();
    t.smallint('sentiment').nullable();
    t.uuid('claimed_by').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('claimed_at', { useTz: true }).nullable();
  });

  await knex.schema.createTable('task_co_owners', (t) => {
    t.uuid('reminder_id').notNullable().references('id').inTable('reminders').onDelete('CASCADE');
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['reminder_id', 'account_id']);
    t.index('account_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('task_co_owners');
  await knex.schema.alterTable('reminders', (t) => {
    t.dropColumn('desired_outcome');
    t.dropColumn('sentiment');
    t.dropColumn('claimed_by');
    t.dropColumn('claimed_at');
  });
}
