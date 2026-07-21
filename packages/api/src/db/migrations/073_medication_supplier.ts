import type { Knex } from 'knex';

/**
 * Where a medication is reordered from. The supplier's name and the reorder
 * link are two distinct data points, so they get two columns: the name shows
 * as its own sortable column in the medications table, and the link powers the
 * "Order" button that appears when supply runs low.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    // The pharmacy or shop this medication is reordered from.
    t.string('supplier', 255).nullable();
    // A direct link to reorder it from that supplier (their order page).
    t.text('supplier_order_url').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('supplier');
    t.dropColumn('supplier_order_url');
  });
}
