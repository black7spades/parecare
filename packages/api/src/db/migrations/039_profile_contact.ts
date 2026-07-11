import type { Knex } from 'knex';

/**
 * Who to contact about this person, captured as discrete fields. The
 * contact is one of three kinds:
 *  - 'self': the person is their own contact; phone, phone type and email
 *    are their own.
 *  - 'user': someone already on the platform; contact_account_id points at
 *    their account.
 *  - 'contact': a new contact who is not (yet) a user; name, relationship,
 *    phone, phone type and email are stored here. They can be invited to
 *    log in later.
 * Every data point is its own column, never packed together.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.string('contact_kind', 20).nullable();
    t.uuid('contact_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.string('contact_name', 255).nullable();
    t.string('contact_relationship', 100).nullable();
    t.string('contact_phone', 50).nullable();
    t.string('contact_phone_type', 20).nullable();
    t.string('contact_email', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('contact_kind');
    t.dropColumn('contact_account_id');
    t.dropColumn('contact_name');
    t.dropColumn('contact_relationship');
    t.dropColumn('contact_phone');
    t.dropColumn('contact_phone_type');
    t.dropColumn('contact_email');
  });
}
