import type { Knex } from 'knex';

/**
 * Connecting outside assistants (Claude, ChatGPT and the like) to PareCare.
 *
 * An assistant connects in one of two ways, and both end as a row in
 * api_keys, so the person sees and disconnects every connection in one list:
 *
 * - It signs in through PareCare's own consent screen (OAuth with PKCE and
 *   dynamic client registration, which is what Claude's and ChatGPT's
 *   "add a connector" flows use). oauth_clients holds the apps that have
 *   registered, oauth_codes the single-use codes handed back after the
 *   person clicks Allow.
 * - The person makes an app password themselves and pastes it in.
 *
 * api_keys learns:
 * - access: 'full' (read and add records) or 'read' (look only).
 * - oauth_client_id: the app that signed in, when it came that way.
 * - refresh_token_hash and expires_at: signed-in connections renew
 *   themselves; an app password never expires until it is disconnected.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('oauth_clients', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('client_id', 80).notNullable().unique();
    t.string('client_secret_hash', 64).nullable();
    t.string('client_name', 200).notNullable();
    t.jsonb('redirect_uris').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('oauth_codes', (t) => {
    t.string('code_hash', 64).primary();
    t.string('client_id', 80).notNullable().references('client_id').inTable('oauth_clients').onDelete('CASCADE');
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.text('redirect_uri').notNullable();
    t.string('code_challenge', 128).notNullable();
    t.string('access', 16).notNullable().defaultTo('full');
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('api_keys', (t) => {
    t.string('access', 16).notNullable().defaultTo('full'); // full | read
    t.string('oauth_client_id', 80).nullable().references('client_id').inTable('oauth_clients').onDelete('CASCADE');
    t.string('refresh_token_hash', 64).nullable().unique();
    t.timestamp('expires_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('api_keys', (t) => {
    t.dropColumn('expires_at');
    t.dropColumn('refresh_token_hash');
    t.dropColumn('oauth_client_id');
    t.dropColumn('access');
  });
  await knex.schema.dropTable('oauth_codes');
  await knex.schema.dropTable('oauth_clients');
}
