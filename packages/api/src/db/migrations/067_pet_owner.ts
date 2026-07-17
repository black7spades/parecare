import type { Knex } from 'knex';

/**
 * A pet's owner is a person already in the system, not free text: the owner
 * is another care profile (a person). owner_profile_id points at that person
 * so a pet reads as "owned by Jane Smith" and links through to her profile.
 * Kept nullable; clearing the owner (or deleting the person) sets it null.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.uuid('owner_profile_id').nullable().references('id').inTable('care_profiles').onDelete('SET NULL');
    t.index('owner_profile_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('owner_profile_id');
  });
}
