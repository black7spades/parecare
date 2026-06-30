import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('checklist_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('phase', 50).notNullable();
    t.string('title', 255).notNullable();
    t.text('description').nullable();
    t.boolean('completed').notNullable().defaultTo(false);
    t.uuid('completed_by').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.timestamp('completed_at').nullable();
    t.boolean('is_custom').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('checklist_items');
}
