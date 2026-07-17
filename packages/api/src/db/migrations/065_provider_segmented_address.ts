import type { Knex } from 'knex';

/**
 * Providers get the same segmented address as people and pets: one column
 * per part, filled by the shared address finder. The existing free-text
 * `address` column stays as a composed one-line display, kept in step on
 * write, so every current reader keeps working unchanged.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.string('address_line1', 255).nullable();
    t.string('address_line2', 255).nullable();
    t.string('address_suburb', 120).nullable();
    t.string('address_state', 120).nullable();
    t.string('address_postcode', 20).nullable();
    t.string('address_country', 120).nullable();
  });

  // Seed line 1 from any existing single-line address so nothing is lost;
  // the finer parts fill in the next time the provider is edited.
  await knex.raw(`UPDATE providers SET address_line1 = address WHERE address IS NOT NULL AND address <> ''`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.dropColumn('address_line1');
    t.dropColumn('address_line2');
    t.dropColumn('address_suburb');
    t.dropColumn('address_state');
    t.dropColumn('address_postcode');
    t.dropColumn('address_country');
  });
}
