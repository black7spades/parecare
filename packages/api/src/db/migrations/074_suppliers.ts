import type { Knex } from 'knex';

/**
 * Suppliers are the pharmacies and shops a medication is reordered from,
 * shared across every care profile in an account (like providers, but a
 * separate concern: a supplier fulfils orders, a provider delivers care).
 *
 * Vendor name and suburb are two distinct data points, so they are two
 * columns. Two suppliers can share a vendor name (a chain with several
 * branches); the suburb tells them apart, e.g. "Chemist Warehouse" in two
 * suburbs. Each medication links to one supplier via `supplier_id`; the
 * denormalised `supplier` name and `supplier_order_url` stay on the
 * medication for display, export and the low-supply Order button.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('suppliers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    // The vendor name, e.g. "Chemist Warehouse".
    t.string('name', 255).notNullable();
    // The branch suburb, telling apart two branches of the same vendor.
    t.string('suburb', 120).nullable();
    // How to reach them to place or chase an order.
    t.string('phone', 50).nullable();
    // A direct link to reorder from this supplier (their order page).
    t.text('order_url').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    // The same vendor+suburb is one supplier per account.
    t.unique(['account_id', 'name', 'suburb']);
  });

  // Link each medication to a supplier. Nullable: a medication need not name
  // one, and clearing the supplier keeps the medication.
  await knex.schema.alterTable('medications', (t) => {
    t.uuid('supplier_id').nullable().references('id').inTable('suppliers').onDelete('SET NULL');
  });

  // Backfill: turn every distinct supplier name already typed on a medication
  // into a shared supplier for its account, carrying an order link where one
  // exists, then point the medications at the supplier they match by name.
  await knex.raw(`
    INSERT INTO suppliers (account_id, name, order_url)
    SELECT DISTINCT ON (cp.account_id, lower(trim(m.supplier)))
           cp.account_id, trim(m.supplier), m.supplier_order_url
    FROM medications m
    JOIN care_profiles cp ON m.care_profile_id = cp.id
    WHERE m.supplier IS NOT NULL AND trim(m.supplier) <> ''
    ORDER BY cp.account_id, lower(trim(m.supplier)), m.supplier_order_url NULLS LAST
  `);

  await knex.raw(`
    UPDATE medications m
    SET supplier_id = s.id
    FROM suppliers s
    JOIN care_profiles cp ON cp.account_id = s.account_id
    WHERE m.care_profile_id = cp.id
      AND m.supplier IS NOT NULL
      AND lower(trim(m.supplier)) = lower(trim(s.name))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('supplier_id');
  });
  await knex.schema.dropTable('suppliers');
}
