import type { Knex } from 'knex';

/**
 * Bring the suppliers schema up to the full, provider-parity shape on
 * databases that already ran an earlier version of the suppliers migration
 * (which created a lone `suburb` column and no profile-link table). This is a
 * forward migration rather than an edit to 074, so it applies cleanly on top
 * of whatever already ran; every step is guarded so it is a no-op on a fresh
 * database that already has the full shape.
 *
 * Without this, the medications list and the supplier directory both query
 * `suppliers.address_suburb` and `care_profile_suppliers`, which do not exist
 * on those databases, so the queries error and the pages render empty. No data
 * is lost — this only reconciles the columns the code expects.
 */
export async function up(knex: Knex): Promise<void> {
  const hasSuppliers = await knex.schema.hasTable('suppliers');
  if (!hasSuppliers) {
    // 074 never ran here; create the full table outright.
    await knex.schema.createTable('suppliers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
      t.string('name', 255).notNullable();
      t.string('phone', 50).nullable();
      t.string('email', 255).nullable();
      t.text('address').nullable();
      t.string('address_line1', 255).nullable();
      t.string('address_line2', 255).nullable();
      t.string('address_suburb', 120).nullable();
      t.string('address_state', 120).nullable();
      t.string('address_postcode', 20).nullable();
      t.string('address_country', 120).nullable();
      t.text('order_url').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  } else {
    // Add the segmented address columns if an earlier version lacked them.
    if (!(await knex.schema.hasColumn('suppliers', 'address_suburb'))) {
      await knex.schema.alterTable('suppliers', (t) => {
        t.text('address').nullable();
        t.string('address_line1', 255).nullable();
        t.string('address_line2', 255).nullable();
        t.string('address_suburb', 120).nullable();
        t.string('address_state', 120).nullable();
        t.string('address_postcode', 20).nullable();
        t.string('address_country', 120).nullable();
      });
    }
    if (!(await knex.schema.hasColumn('suppliers', 'email'))) {
      await knex.schema.alterTable('suppliers', (t) => {
        t.string('email', 255).nullable();
      });
    }
    // Fold the old lone `suburb` into the segmented address, then drop it.
    // Dropping the column also drops the (account_id, name, suburb) unique.
    if (await knex.schema.hasColumn('suppliers', 'suburb')) {
      await knex.raw(
        `UPDATE suppliers SET address_suburb = suburb
         WHERE suburb IS NOT NULL AND (address_suburb IS NULL OR address_suburb = '')`
      );
      await knex.schema.alterTable('suppliers', (t) => {
        t.dropColumn('suburb');
      });
    }
  }

  // Make sure a medication can point at a supplier.
  if (!(await knex.schema.hasColumn('medications', 'supplier_id'))) {
    await knex.schema.alterTable('medications', (t) => {
      t.uuid('supplier_id').nullable().references('id').inTable('suppliers').onDelete('SET NULL');
    });
  }

  // The supplier-to-profile link table, mirroring providers.
  if (!(await knex.schema.hasTable('care_profile_suppliers'))) {
    await knex.schema.createTable('care_profile_suppliers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
      t.uuid('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('CASCADE');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['care_profile_id', 'supplier_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Reconciliation only; leave the added columns in place and just drop the
  // join table, which 074's own down handles when present.
  if (await knex.schema.hasTable('care_profile_suppliers')) {
    await knex.schema.dropTable('care_profile_suppliers');
  }
}
