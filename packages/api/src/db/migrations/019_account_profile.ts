import type { Knex } from 'knex';

/**
 * Personal profile for the logged-in user (distinct from the care-recipient
 * profile): an avatar plus optional demographics, and a lightweight directed
 * relationship graph between accounts so the circle can see who is who.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.string('avatar_url', 500).nullable();
    t.date('date_of_birth').nullable();
    t.string('gender', 50).nullable();
    t.string('pronouns', 50).nullable();
  });

  await knex.schema.createTable('account_relationships', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // from_account records that to_account is their <relationship> (e.g. brother)
    t.uuid('from_account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.uuid('to_account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('relationship', 100).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['from_account_id', 'to_account_id']);
    t.index('from_account_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('account_relationships');
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('avatar_url');
    t.dropColumn('date_of_birth');
    t.dropColumn('gender');
    t.dropColumn('pronouns');
  });
}
