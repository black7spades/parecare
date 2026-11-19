import type { Knex } from 'knex';

/**
 * Why a condition resolved, and what happened, as two fields of their own
 * beside the existing resolution date. All three are optional: marking a
 * condition resolved can simply mean "stop tracking it", while a carer who
 * wants the full story can record when, why and the detail.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.string('resolution_reason', 30).nullable();
    t.text('resolution_notes').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.dropColumn('resolution_notes');
    t.dropColumn('resolution_reason');
  });
}
