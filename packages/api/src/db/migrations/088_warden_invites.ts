import type { Knex } from 'knex';

/**
 * Asking someone to be a data warden when they may not have an account yet.
 *
 * Nominating could only pick from people who had already signed up, which
 * meant the person most likely to be asked, a sibling or a friend who has
 * never used this, could not be asked at all. An invitation carries the ask
 * to an email address instead, and works whether they arrive with an
 * account, without one, or already signed in as somebody else.
 *
 * Separate from the care circle invitations table on purpose. That one is
 * about access to one person's care; this is about being able to recover
 * everything, which is a different thing with different rules.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('warden_invites')) return;
  await knex.schema.createTable('warden_invites', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // The token in the link is the credential, exactly like a password reset.
    t.uuid('token').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.string('email', 255).notNullable();
    t.uuid('invited_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    // pending, accepted or cancelled.
    t.string('status', 20).notNullable().defaultTo('pending');
    t.timestamp('expires_at').notNullable();
    t.uuid('accepted_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('accepted_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('email');
    t.index('status');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('warden_invites');
}
