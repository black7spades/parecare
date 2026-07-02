import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('memory_book_entries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('author_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.string('title', 255).nullable();
    t.text('body').notNullable();
    t.string('photo_url', 500).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id', 'created_at']);
  });

  await knex.schema.alterTable('reminders', (t) => {
    // Set when a due-reminder email has been sent for the current occurrence
    t.timestamp('last_notified_at').nullable();
  });

  await knex.schema.alterTable('open_question_responses', (t) => {
    // Marks AI mediation summaries so the UI can render them distinctly
    t.boolean('is_ai').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('open_question_responses', (t) => {
    t.dropColumn('is_ai');
  });
  await knex.schema.alterTable('reminders', (t) => {
    t.dropColumn('last_notified_at');
  });
  await knex.schema.dropTable('memory_book_entries');
}
