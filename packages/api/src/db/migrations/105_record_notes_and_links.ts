import type { Knex } from 'knex';

/**
 * Notes and attached documents on any record.
 *
 * Every line in every list now opens into its own view, and that view has the
 * same few things whatever the record is: a running set of notes, and the
 * documents that belong to it. Both point at a record by its kind (the same
 * names the activity trail uses, such as appointments or medications) and its
 * id, so one table serves every kind of record.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('record_notes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('entity_type', 40).notNullable();
    t.uuid('entity_id').notNullable();
    t.text('body').notNullable();
    t.uuid('author_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['care_profile_id', 'entity_type', 'entity_id']);
  });

  await knex.schema.createTable('document_links', (t) => {
    t.uuid('document_id').notNullable().references('id').inTable('documents').onDelete('CASCADE');
    t.string('entity_type', 40).notNullable();
    t.uuid('entity_id').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['document_id', 'entity_type', 'entity_id']);
    t.index(['entity_type', 'entity_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('document_links');
  await knex.schema.dropTableIfExists('record_notes');
}
