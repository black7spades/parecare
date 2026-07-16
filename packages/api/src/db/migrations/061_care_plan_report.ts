import type { Knex } from 'knex';

/**
 * Each care plan version carries a prose clinical report: the same data
 * structure written as a narrative document, composed by the plan editor
 * at version creation. The structured content stays the source of truth
 * for diffing; the report is what people read, export and sign.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_plan_versions', (t) => {
    t.text('report').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_plan_versions', (t) => {
    t.dropColumn('report');
  });
}
