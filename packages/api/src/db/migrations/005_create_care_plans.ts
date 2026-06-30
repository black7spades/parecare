import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('care_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.specificType('conditions', 'TEXT[]').nullable();
    t.jsonb('medications').nullable();
    t.specificType('dietary_requirements', 'TEXT[]').nullable();
    t.specificType('mobility_aids', 'TEXT[]').nullable();
    t.text('communication_preferences').nullable();
    t.boolean('advance_care_directive').notNullable().defaultTo(false);
    t.text('advance_care_directive_location').nullable();
    t.string('gp_name', 255).nullable();
    t.string('gp_practice', 255).nullable();
    t.string('gp_phone', 50).nullable();
    t.jsonb('emergency_contacts').nullable();
    t.uuid('updated_by').nullable().references('id').inTable('care_circle_members');
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('care_plans');
}
