import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('reminders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('assigned_to').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.string('title', 255).notNullable();
    t.text('body').nullable();
    t.enum('reminder_type', ['once', 'daily', 'weekly', 'monthly']).notNullable().defaultTo('once');
    t.timestamp('next_due_at').notNullable();
    t.string('rrule', 255).nullable();
    t.boolean('completed').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('reminders');
}
