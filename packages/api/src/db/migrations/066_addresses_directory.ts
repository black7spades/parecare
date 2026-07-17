import type { Knex } from 'knex';

/**
 * Addresses become a reusable directory, the same way providers are: an
 * address is entered once, kept at the account level, and linked to any
 * number of care profiles. Segmented into parts, each its own column, with
 * a one-line `formatted` display kept in step on write.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('addresses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    // An optional friendly name, e.g. "Mum's house" or "Regis North Fremantle".
    t.string('label', 255).nullable();
    t.string('address_line1', 255).nullable();
    t.string('address_line2', 255).nullable();
    t.string('address_suburb', 120).nullable();
    t.string('address_state', 120).nullable();
    t.string('address_postcode', 20).nullable();
    t.string('address_country', 120).nullable();
    // One-line composed display, kept in step with the parts on write.
    t.text('formatted').nullable();
    t.timestamps(true, true);
    t.index('account_id');
  });

  await knex.schema.createTable('care_profile_addresses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('address_id').notNullable().references('id').inTable('addresses').onDelete('CASCADE');
    // What this address is to the person, e.g. "home", "postal". One value.
    t.string('address_kind', 40).nullable();
    t.timestamps(true, true);
    t.unique(['care_profile_id', 'address_id']);
    t.index('care_profile_id');
    t.index('address_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('care_profile_addresses');
  await knex.schema.dropTableIfExists('addresses');
}
