import type { Knex } from 'knex';

/**
 * Suppliers are the pharmacies and shops a medication is reordered from,
 * shared across every care profile in an account. They mirror providers
 * field-for-field: a name, phone and email, the same segmented address filled
 * by the shared address finder, and a reorder link (in place of a provider's
 * booking and directions links). Like providers they can be linked directly to
 * care profiles through a join table, and like providers a supplier fulfils
 * orders rather than delivering care.
 *
 * Each medication also links to one supplier via `supplier_id`; the
 * denormalised `supplier` name and `supplier_order_url` stay on the medication
 * for display, export and the low-supply Order button. Two suppliers can share
 * a vendor name (a chain with several branches); the address suburb tells them
 * apart, e.g. "Chemist Warehouse" in two suburbs.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('suppliers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    // The vendor name, e.g. "Chemist Warehouse".
    t.string('name', 255).notNullable();
    // How to reach them to place or chase an order.
    t.string('phone', 50).nullable();
    t.string('email', 255).nullable();
    // The same segmented address as people, pets and providers. `address` is a
    // composed one-line display, kept in step with the parts on write.
    t.text('address').nullable();
    t.string('address_line1', 255).nullable();
    t.string('address_line2', 255).nullable();
    t.string('address_suburb', 120).nullable();
    t.string('address_state', 120).nullable();
    t.string('address_postcode', 20).nullable();
    t.string('address_country', 120).nullable();
    // A direct link to reorder from this supplier (their order page).
    t.text('order_url').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Link suppliers to care profiles, the same join providers use.
  await knex.schema.createTable('care_profile_suppliers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('CASCADE');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['care_profile_id', 'supplier_id']);
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
  await knex.schema.dropTable('care_profile_suppliers');
  await knex.schema.dropTable('suppliers');
}
