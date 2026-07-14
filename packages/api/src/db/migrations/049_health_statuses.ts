import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('health_statuses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.string('category', 30).notNullable();
    t.string('status', 20).notNullable().defaultTo('active');
    t.date('onset_date').notNullable();
    t.date('expected_resolution_date').nullable();
    t.date('actual_resolution_date').nullable();
    t.boolean('is_contagious').notNullable().defaultTo(false);
    t.boolean('isolation_required').notNullable().defaultTo(false);
    t.text('escalation_notes').nullable();
    t.string('region', 100).nullable();
    t.uuid('linked_condition_id').nullable().references('id').inTable('medical_conditions').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('care_profile_id');
    t.index(['care_profile_id', 'status']);
  });

  await knex.schema.createTable('health_status_symptoms', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('health_status_id').notNullable().references('id').inTable('health_statuses').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.smallint('severity').notNullable().defaultTo(3);
    t.timestamp('noted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at', { useTz: true }).nullable();
    t.text('notes').nullable();
    t.index('health_status_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('health_status_symptoms');
  await knex.schema.dropTable('health_statuses');
}
