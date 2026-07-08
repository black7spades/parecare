import type { Knex } from 'knex';

/**
 * Creating care profiles becomes an explicit account right instead of
 * something every authenticated account can do. Self-serve registrations
 * keep it (they sign up to manage someone's care); accounts that came
 * into existence by accepting an invitation are helpers in someone
 * else's circles and do NOT get it until an admin grants it.
 *
 * Backfill: existing accounts default to allowed, except accounts that
 * joined via an invitation and own no care profiles of their own — those
 * are exactly the invited helpers this right exists to constrain.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.boolean('can_create_care_profiles').notNullable().defaultTo(true);
  });

  await knex.raw(`
    UPDATE accounts a
    SET can_create_care_profiles = false
    WHERE a.role = 'user'
      AND EXISTS (SELECT 1 FROM invitations i WHERE i.accepted_account_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM care_profiles p WHERE p.account_id = a.id)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('can_create_care_profiles');
  });
}
