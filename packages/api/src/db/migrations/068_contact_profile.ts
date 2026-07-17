import type { Knex } from 'knex';

/**
 * A person's primary carer (their contact) can be another person already in
 * the system: contact_kind gains the value 'profile' and contact_profile_id
 * points at that person's care profile, whose own phone and email stand in
 * for a personal one. Sits alongside the existing 'self', 'user', 'contact'
 * and 'provider' kinds. Nullable; clearing the carer sets it null.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.uuid('contact_profile_id').nullable().references('id').inTable('care_profiles').onDelete('SET NULL');
    t.index('contact_profile_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('contact_profile_id');
  });
}
