import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('messages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('author_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.text('body').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id', 'created_at']);
  });

  // Secret per-profile token for the read-only calendar feed URL
  await knex.schema.alterTable('care_profiles', (t) => {
    t.uuid('ics_token').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('ics_token');
  });
  await knex.schema.dropTable('messages');
}
