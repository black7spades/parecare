import type { Knex } from 'knex';

/**
 * Getting back in after forgetting a password.
 *
 * Until now the only way was to ask whoever runs the server, which is not a
 * thing to require of somebody who has just been asked to help look after
 * medical records and cannot get to them.
 *
 * Only a hash of each link's token is kept, exactly as personal access keys
 * already work here. If this table ever leaked, the rows in it would not let
 * anybody into anything.
 *
 * sessions_valid_from is the other half. A password reset that leaves
 * whoever might already be signed in still signed in is not a reset at all,
 * so every session issued before the change stops working the moment it
 * happens.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('password_resets'))) {
    await knex.schema.createTable('password_resets', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
      // The hash of what was emailed, never the thing itself.
      t.string('token_hash', 64).notNullable().unique();
      t.timestamp('expires_at').notNullable();
      // Single use: once it has worked, it never works again.
      t.timestamp('used_at').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['account_id']);
    });
  }

  if (!(await knex.schema.hasColumn('accounts', 'sessions_valid_from'))) {
    await knex.schema.alterTable('accounts', (t) => {
      t.timestamp('sessions_valid_from').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_resets');
  if (await knex.schema.hasColumn('accounts', 'sessions_valid_from')) {
    await knex.schema.alterTable('accounts', (t) => t.dropColumn('sessions_valid_from'));
  }
}
