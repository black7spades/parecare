import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.enum('role', ['super_admin', 'admin', 'user']).notNullable().defaultTo('user');
    t.index('role');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.dropIndex('role');
    t.dropColumn('role');
  });
}
