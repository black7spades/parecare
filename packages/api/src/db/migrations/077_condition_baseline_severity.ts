import type { Knex } from 'knex';

/**
 * A condition's baseline severity: the person's normal level on the 1 to 10
 * symptom scale for a long-term condition. Everyone is different. Marie's
 * chronic pain sits at a 6 or 7 for her every day, so a reading there is not a
 * cause for alarm; the health alerts should only fire when a symptom rises
 * above this baseline, not at a fixed threshold. Nullable: a condition without
 * a baseline falls back to the standard above-moderate rule.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('medical_conditions', 'baseline_severity'))) {
    await knex.schema.alterTable('medical_conditions', (t) => {
      t.integer('baseline_severity').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('medical_conditions', 'baseline_severity')) {
    await knex.schema.alterTable('medical_conditions', (t) => {
      t.dropColumn('baseline_severity');
    });
  }
}
