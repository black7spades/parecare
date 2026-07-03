import type { Knex } from 'knex';

/**
 * Runtime application settings, editable by a super admin instead of only
 * through environment variables. Only overridden keys are stored; anything
 * absent falls back to the process environment, then to a hardcoded default.
 * Secrets (API keys, SMTP password) live encrypted in value_encrypted;
 * everything else lives typed in the jsonb value column.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('app_settings', (t) => {
    t.text('key').primary();
    t.jsonb('value').nullable();
    t.text('value_encrypted').nullable();
    t.boolean('is_secret').notNullable().defaultTo(false);
    t.text('group').notNullable();
    t.uuid('updated_by').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('app_settings');
}
