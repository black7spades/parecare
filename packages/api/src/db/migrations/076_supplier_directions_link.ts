import type { Knex } from 'knex';

/**
 * Suppliers get a directions link, the same as providers: a map link to the
 * shop, separate from the reorder link. Guarded so it is a no-op where the
 * column already exists.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('suppliers', 'directions_link'))) {
    await knex.schema.alterTable('suppliers', (t) => {
      t.text('directions_link').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('suppliers', 'directions_link')) {
    await knex.schema.alterTable('suppliers', (t) => {
      t.dropColumn('directions_link');
    });
  }
}
