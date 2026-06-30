import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('care_log_entries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('author_member_id').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.string('entry_type', 50).notNullable();
    t.string('title', 255).nullable();
    t.text('body').notNullable();
    t.timestamp('occurred_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('care_log_entries');
}
