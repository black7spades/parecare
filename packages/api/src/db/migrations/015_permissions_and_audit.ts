import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Existing members keep full function — 'contributor' matches what they
  // could already do before permission levels existed.
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.enum('permission', ['viewer', 'contributor']).notNullable().defaultTo('contributor');
  });

  await knex.schema.createTable('audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('actor_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.string('action', 20).notNullable(); // created / updated / deleted
    t.string('entity_type', 50).notNullable(); // messages, log, plan, circle, …
    t.string('summary', 255).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('audit_log');
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.dropColumn('permission');
  });
}
