import type { Knex } from 'knex';

/**
 * The notification system grows up:
 *
 * 1. accounts.timezone: the IANA zone the person's browser reports, so
 *    "today" and "a scheduled time has passed" are judged on their clock,
 *    not the server's. accounts.notification_prefs holds their per-kind
 *    choices (which kinds of notification they want at all).
 *
 * 2. medications.critical: whether missing this medication is dangerous
 *    (stopping citalopram suddenly is; skipping aspirin for a day is
 *    usually not). Overdue-dose and out-of-stock alerts are urgent only
 *    for critical medications.
 *
 * 3. notification_channels: where notifications are delivered beyond the
 *    in-app bell. One row per destination: an email address, a web push
 *    subscription for a device, a Discord webhook, a Telegram chat, or a
 *    generic webhook for anything else. Each channel chooses whether
 *    urgent alerts are pushed the moment they arise and how often the
 *    rest are bundled into a digest.
 *
 * 4. notification_deliveries: which items each channel has already been
 *    sent, so nothing is delivered twice.
 *
 * 5. api_keys: personal access tokens, so bots and outside apps can call
 *    the API as the account without a browser session. Only a hash is
 *    stored; the token itself is shown once at creation.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.string('timezone', 64).nullable();
    t.jsonb('notification_prefs').notNullable().defaultTo('{}');
  });

  await knex.schema.alterTable('medications', (t) => {
    t.boolean('critical').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('notification_channels', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('kind', 20).notNullable(); // email | webpush | discord | telegram | webhook
    t.string('label', 100).notNullable();
    // Kind-specific destination details: the email address, the push
    // subscription, the webhook URL, the bot token and chat id.
    t.jsonb('config').notNullable().defaultTo('{}');
    t.boolean('urgent_instantly').notNullable().defaultTo(true);
    t.string('digest', 10).notNullable().defaultTo('daily'); // off | daily | weekly | monthly
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('last_digest_at').nullable();
    t.timestamps(true, true);
    t.index('account_id');
  });

  await knex.schema.createTable('notification_deliveries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('channel_id').notNullable().references('id').inTable('notification_channels').onDelete('CASCADE');
    t.string('item_key', 255).notNullable();
    t.timestamp('sent_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['channel_id', 'item_key']);
  });

  await knex.schema.createTable('api_keys', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('label', 100).notNullable();
    t.string('token_hash', 64).notNullable().unique();
    // The first characters of the token, for recognising a key in a list.
    t.string('token_prefix', 12).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_used_at').nullable();
    t.timestamp('revoked_at').nullable();
    t.index('account_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('api_keys');
  await knex.schema.dropTable('notification_deliveries');
  await knex.schema.dropTable('notification_channels');
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('critical');
  });
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('timezone');
    t.dropColumn('notification_prefs');
  });
}
