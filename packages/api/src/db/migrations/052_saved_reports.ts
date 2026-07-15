import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('saved_reports', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.text('name').notNullable();
    t.jsonb('config').notNullable();
    t.jsonb('result').notNullable();
    t.integer('profile_count').notNullable();
    t.integer('section_count').notNullable();
    t.integer('total_rows').notNullable();
    t.boolean('has_ai_narrative').notNullable().defaultTo(false);
    t.timestamp('generated_at').notNullable();
    t.timestamps(true, true);
    t.index(['account_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('saved_reports');
}
