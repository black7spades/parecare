import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('open_questions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('raised_by').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.string('title', 255).notNullable();
    t.text('body').nullable();
    t.enum('status', ['open', 'resolved', 'deferred']).notNullable().defaultTo('open');
    t.text('resolution').nullable();
    t.uuid('resolved_by').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.timestamp('resolved_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('open_question_responses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('question_id').notNullable().references('id').inTable('open_questions').onDelete('CASCADE');
    t.uuid('author_member_id').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.text('body').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('open_question_responses');
  await knex.schema.dropTable('open_questions');
}
