import type { Knex } from 'knex';

/**
 * Avatar background colour (used when no photo is set) for both user accounts
 * and care recipients, plus a transferable "can edit this profile" grant on
 * circle members.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.string('avatar_color', 7).nullable();
  });
  await knex.schema.alterTable('care_profiles', (t) => {
    t.string('photo_color', 7).nullable();
  });
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.boolean('can_edit_profile').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.dropColumn('can_edit_profile');
  });
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('photo_color');
  });
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('avatar_color');
  });
}
