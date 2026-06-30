import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('care_circle_members', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.string('invited_email', 255).nullable();
    t.string('display_name', 255).notNullable();
    t.string('role', 100).notNullable();
    t.text('role_description').nullable();
    t.string('poa_type', 50).nullable();
    t.boolean('poa_activated').notNullable().defaultTo(false);
    t.uuid('poa_document_id').nullable();
    t.string('invite_token', 255).nullable().unique();
    t.boolean('invite_accepted').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('care_circle_members');
}
