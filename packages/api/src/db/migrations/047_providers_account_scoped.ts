import type { Knex } from 'knex';

/**
 * Move providers from per-care-profile to per-account. A provider like
 * "Dr Andrew Wright at Health Hub Morayfield" is one record reusable
 * across every profile in the account.
 *
 * Per-profile data (POA status, primary contact) moves to a join table.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Add account_id to providers (nullable initially for backfill).
  await knex.schema.alterTable('providers', (t) => {
    t.uuid('account_id').nullable().references('id').inTable('accounts').onDelete('CASCADE');
  });

  // 2. Backfill account_id from the owning care profile.
  await knex.raw(`
    UPDATE providers p
    SET account_id = cp.account_id
    FROM care_profiles cp
    WHERE p.care_profile_id = cp.id
  `);

  // 3. Make account_id NOT NULL now that every row has a value.
  await knex.schema.alterTable('providers', (t) => {
    t.uuid('account_id').notNullable().alter();
  });

  // 4. Create the join table linking providers to care profiles.
  await knex.schema.createTable('care_profile_providers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('provider_id').notNullable().references('id').inTable('providers').onDelete('CASCADE');
    t.string('poa_type', 50).nullable();
    t.boolean('poa_activated').notNullable().defaultTo(false);
    t.uuid('primary_contact_member_id').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['care_profile_id', 'provider_id']);
  });

  // 5. Populate the join table from existing provider rows.
  await knex.raw(`
    INSERT INTO care_profile_providers (care_profile_id, provider_id, poa_type, poa_activated, primary_contact_member_id)
    SELECT care_profile_id, id, poa_type, poa_activated, primary_contact_member_id
    FROM providers
  `);

  // 6. Drop the moved columns from providers.
  await knex.schema.alterTable('providers', (t) => {
    t.dropForeign(['primary_contact_member_id']);
    t.dropColumn('primary_contact_member_id');
    t.dropColumn('poa_type');
    t.dropColumn('poa_activated');
    t.dropForeign(['care_profile_id']);
    t.dropColumn('care_profile_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Restore care_profile_id and per-profile columns on providers.
  await knex.schema.alterTable('providers', (t) => {
    t.uuid('care_profile_id').nullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('poa_type', 50).nullable();
    t.boolean('poa_activated').notNullable().defaultTo(false);
    t.uuid('primary_contact_member_id').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
  });

  // Copy back from join table (first link wins for providers shared across profiles).
  await knex.raw(`
    UPDATE providers p
    SET care_profile_id = cpp.care_profile_id,
        poa_type = cpp.poa_type,
        poa_activated = cpp.poa_activated,
        primary_contact_member_id = cpp.primary_contact_member_id
    FROM (
      SELECT DISTINCT ON (provider_id) *
      FROM care_profile_providers
      ORDER BY provider_id, created_at ASC
    ) cpp
    WHERE p.id = cpp.provider_id
  `);

  await knex.schema.alterTable('providers', (t) => {
    t.uuid('care_profile_id').notNullable().alter();
  });

  await knex.schema.dropTable('care_profile_providers');

  await knex.schema.alterTable('providers', (t) => {
    t.dropColumn('account_id');
  });
}
