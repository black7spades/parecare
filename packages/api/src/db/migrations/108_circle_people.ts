import type { Knex } from 'knex';

/**
 * People in the care circle who are simply added, never invited.
 *
 * Not everyone around a person needs to log in. A neighbour who checks in, a
 * friend who drives to appointments, a support worker: they belong in the
 * circle so everyone knows who they are and how to reach them, without an
 * account or an email invite. Such a person is a circle member with no
 * account and no invitation, which no access check ever accepts, so adding
 * them grants nothing. Their phone and email are kept as two separate
 * contact details. Inviting them to log in later turns them into an invite.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.string('phone', 50).nullable();
    t.string('email', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.dropColumn('email');
    t.dropColumn('phone');
  });
}
