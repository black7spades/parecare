import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    // OAuth-only accounts have no password
    t.string('password_hash', 255).nullable().alter();
    t.string('oauth_provider', 20).nullable(); // 'google' | 'facebook'
    t.string('oauth_subject', 255).nullable(); // provider's stable user id
    t.unique(['oauth_provider', 'oauth_subject']);
    t.string('mfa_secret', 64).nullable();
    t.boolean('mfa_enabled').notNullable().defaultTo(false);
  });

  // Emails are matched case-insensitively from now on; normalise existing
  // rows where doing so cannot collide with another account.
  await knex.raw(`
    UPDATE accounts a
    SET email = lower(email)
    WHERE email <> lower(email)
      AND NOT EXISTS (
        SELECT 1 FROM accounts b WHERE b.id <> a.id AND b.email = lower(a.email)
      )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.dropUnique(['oauth_provider', 'oauth_subject']);
    t.dropColumn('oauth_provider');
    t.dropColumn('oauth_subject');
    t.dropColumn('mfa_secret');
    t.dropColumn('mfa_enabled');
    t.string('password_hash', 255).notNullable().defaultTo('').alter();
  });
}
