import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('report_presets', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('account_id').nullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('description').nullable();
    t.boolean('is_system').notNullable().defaultTo(false);
    t.jsonb('config').notNullable();
    t.timestamps(true, true);
    t.index(['account_id']);
    t.index(['is_system']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('report_presets');
}
