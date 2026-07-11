import type { Knex } from 'knex';

/**
 * Completing a task is now a recorded fact, not a disappearance. When a task
 * is marked done we keep when it was done and who did it, so completed tasks
 * stay in the record as their own searchable, sortable history rather than
 * vanishing from the list. Each is its own column, never packed together.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reminders', (t) => {
    t.timestamp('completed_at').nullable();
    t.uuid('completed_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.index(['care_profile_id', 'completed']);
  });
  // Existing completed tasks have no known completion time; stamp them with
  // their creation time so they sort sensibly instead of sitting at "unknown".
  await knex('reminders').where({ completed: true }).whereNull('completed_at').update({ completed_at: knex.ref('created_at') });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reminders', (t) => {
    t.dropIndex(['care_profile_id', 'completed']);
    t.dropColumn('completed_at');
    t.dropColumn('completed_by_account_id');
  });
}
