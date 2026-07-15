import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.string('neurotype', 50).nullable();
    t.string('diagnosis_status', 30).nullable();
    t.date('diagnosis_date').nullable();
    t.string('diagnosing_provider', 255).nullable();
    t.uuid('diagnosis_document_id').nullable().references('id').inTable('documents');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.dropColumn('neurotype');
    t.dropColumn('diagnosis_status');
    t.dropColumn('diagnosis_date');
    t.dropColumn('diagnosing_provider');
    t.dropColumn('diagnosis_document_id');
  });
}
