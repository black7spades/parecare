import type { Knex } from 'knex';

/**
 * 1. A question can be for someone and for a visit: who to ask, a contact,
 *    and the appointment to ask at. A question that names a contact goes on
 *    the next visit with them, and the columns worked out rather than chosen
 *    are listed, so the screen can say so and a person's choice replaces it.
 * 2. First setup can be tried again without adding a medicine twice: each
 *    medicine it adds carries the key the screen gave it.
 * 3. Who raised each question, by their login, so a question shows its
 *    author the way its replies do.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('open_questions', (t) => {
    t.uuid('provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.specificType('inferred_fields', 'text[]').notNullable().defaultTo('{}');
    t.uuid('raised_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.index(['provider_id']);
    t.index(['appointment_id']);
  });

  // Who raised the questions already asked, from the activity trail.
  await knex.raw(`
    UPDATE open_questions q
       SET raised_by_account_id = a.actor_account_id
      FROM audit_log a
     WHERE a.entity_type = 'questions' AND a.action = 'created' AND a.entity_id = q.id
       AND q.raised_by_account_id IS NULL AND a.actor_account_id IS NOT NULL
  `);

  await knex.schema.alterTable('medications', (t) => {
    t.string('client_key', 64).nullable();
    t.unique(['care_profile_id', 'client_key']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.dropUnique(['care_profile_id', 'client_key']);
    t.dropColumn('client_key');
  });
  await knex.schema.alterTable('open_questions', (t) => {
    t.dropIndex(['provider_id']);
    t.dropIndex(['appointment_id']);
    t.dropColumn('raised_by_account_id');
    t.dropColumn('inferred_fields');
    t.dropColumn('appointment_id');
    t.dropColumn('provider_id');
  });
}
