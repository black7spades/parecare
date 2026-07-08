import type { Knex } from 'knex';

/**
 * A real invitation system plus account integrity guarantees.
 *
 * - `invitations` is the single source of truth for an invite: who it is
 *   for (an email address), who sent it, its secret token, its lifecycle
 *   (pending, accepted, revoked) and its expiry. One invitation can cover
 *   MANY care profiles (a carer looking after a wing of residents), each
 *   as a pending `care_circle_members` row linked by `invitation_id`.
 * - Legacy pending invites are folded in, keeping their old token so
 *   already-emailed links continue to work; the per-member token column
 *   is then dropped.
 * - Account emails become unique case-insensitively at the database
 *   level (previously only application code lowercased them). Existing
 *   duplicates keep the oldest account untouched and tag newer ones.
 * - Accounts gain `disabled_at` so an account can be switched off without
 *   destroying the care profiles and history hanging off it.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.timestamp('disabled_at').nullable();
  });

  // De-duplicate emails case-insensitively before enforcing uniqueness:
  // the oldest account keeps the address, newer ones get a tagged alias
  // (user+dup2@example.com) they can change after signing in by password.
  const dupGroups = await knex.raw(
    `SELECT lower(email) AS em, array_agg(id ORDER BY created_at ASC) AS ids
     FROM accounts GROUP BY lower(email) HAVING count(*) > 1`
  );
  for (const g of dupGroups.rows as Array<{ em: string; ids: string[] }>) {
    const [local, domain] = g.em.split('@');
    for (let i = 1; i < g.ids.length; i++) {
      const tagged = `${local}+dup${i + 1}@${domain ?? 'invalid.local'}`;
      console.warn(`Duplicate account email ${g.em}: renaming account ${g.ids[i]} to ${tagged}`);
      await knex('accounts').where({ id: g.ids[i] }).update({ email: tagged });
    }
  }
  await knex.raw('UPDATE accounts SET email = lower(email)');
  await knex.raw('CREATE UNIQUE INDEX accounts_email_lower_uniq ON accounts (lower(email))');

  await knex.schema.createTable('invitations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('token').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.string('email', 255).notNullable();
    t.string('display_name', 255).notNullable();
    t.uuid('invited_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | accepted | revoked
    t.timestamp('expires_at').notNullable();
    t.uuid('accepted_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('accepted_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('email');
    t.index('status');
  });

  await knex.schema.alterTable('care_circle_members', (t) => {
    t.uuid('invitation_id').nullable().references('id').inTable('invitations').onDelete('SET NULL');
  });

  // Fold legacy pending invites into the new table, keeping their token so
  // links already sitting in inboxes still open.
  const pending = await knex('care_circle_members')
    .whereNotNull('invite_token')
    .andWhere('invite_accepted', false)
    .whereNotNull('invited_email');
  for (const m of pending) {
    const [inv] = await knex('invitations')
      .insert({
        token: m.invite_token,
        email: String(m.invited_email).toLowerCase(),
        display_name: m.display_name,
        status: 'pending',
        expires_at: knex.raw("NOW() + INTERVAL '14 days'"),
      })
      .returning('id');
    await knex('care_circle_members')
      .where({ id: m.id })
      .update({ invitation_id: (inv as { id: string }).id });
  }

  await knex.schema.alterTable('care_circle_members', (t) => {
    t.dropColumn('invite_token');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.string('invite_token', 255).nullable().unique();
  });
  const invs = await knex('invitations').where({ status: 'pending' });
  for (const inv of invs) {
    await knex('care_circle_members').where({ invitation_id: inv.id }).update({ invite_token: inv.token });
  }
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.dropColumn('invitation_id');
  });
  await knex.schema.dropTable('invitations');
  await knex.raw('DROP INDEX IF EXISTS accounts_email_lower_uniq');
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('disabled_at');
  });
}
