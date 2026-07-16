import type { Knex } from 'knex';

/**
 * Unopened packs on hand are their own data point, separate from the
 * loose units left in the open pack (supply_remaining) and from what a
 * full pack provides (supply). "2 packs of Perindopril at 30 tabs each"
 * is packs_on_hand 2, supply 30.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.decimal('packs_on_hand', 10, 2).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('packs_on_hand');
  });
}
