import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('providers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('provider_type', 100).notNullable();
    t.string('name', 255).notNullable();
    t.string('organisation', 255).nullable();
    t.string('phone', 50).nullable();
    t.string('email', 255).nullable();
    t.text('address').nullable();
    t.uuid('primary_contact_member_id').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('providers');
}
