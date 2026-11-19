import type { Knex } from 'knex';

const PARTS = ['address_line1', 'address_line2', 'address_suburb', 'address_state', 'address_postcode', 'address_country'] as const;

/**
 * Who a next step is with, and where an appointment is, each as real data.
 *
 * A referral "to Dr Patel, neurologist" was one line of text holding two
 * facts. It now points at the professional in Contacts, who is filed there
 * automatically, so booking it later starts with the right person.
 *
 * An appointment's place was one line of text too. It now has the same
 * segmented address as everything else, filled by the same address finder,
 * plus its own map link. The one-line location stays as a display kept in
 * step with the parts, the way a provider's address is. Existing locations
 * move across: a map link becomes the map link, any other text becomes the
 * first address line, ready to tidy.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reminders', (t) => {
    t.uuid('provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
  });

  await knex.schema.alterTable('appointments', (t) => {
    t.string('address_line1', 255).nullable();
    t.string('address_line2', 255).nullable();
    t.string('address_suburb', 120).nullable();
    t.string('address_state', 120).nullable();
    t.string('address_postcode', 20).nullable();
    t.string('address_country', 120).nullable();
    t.text('directions_link').nullable();
  });

  await knex.raw(`
    UPDATE appointments
       SET directions_link = trim(location), location = NULL
     WHERE lower(trim(location)) LIKE 'http://%' OR lower(trim(location)) LIKE 'https://%'
  `);
  await knex.raw(`
    UPDATE appointments
       SET address_line1 = left(trim(location), 255)
     WHERE location IS NOT NULL AND trim(location) <> ''
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE appointments
       SET location = COALESCE(location, directions_link)
     WHERE location IS NULL AND directions_link IS NOT NULL
  `);
  await knex.schema.alterTable('appointments', (t) => {
    for (const p of PARTS) t.dropColumn(p);
    t.dropColumn('directions_link');
  });
  await knex.schema.alterTable('reminders', (t) => {
    t.dropColumn('provider_id');
  });
}
