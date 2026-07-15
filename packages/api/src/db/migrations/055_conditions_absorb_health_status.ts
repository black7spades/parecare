import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.string('category', 50).nullable();
    t.boolean('is_contagious').defaultTo(false);
    t.boolean('isolation_required').defaultTo(false);
    t.string('region', 255).nullable();
  });

  await knex.schema.createTable('condition_symptoms', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('condition_id').notNullable().references('id').inTable('medical_conditions').onDelete('CASCADE');
    t.uuid('symptom_catalogue_id').nullable().references('id').inTable('symptom_catalogue');
    t.string('name', 255).notNullable();
    t.integer('severity').notNullable().defaultTo(3);
    t.timestamp('noted_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at').nullable();
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('condition_symptoms');
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.dropColumn('category');
    t.dropColumn('is_contagious');
    t.dropColumn('isolation_required');
    t.dropColumn('region');
  });
}
