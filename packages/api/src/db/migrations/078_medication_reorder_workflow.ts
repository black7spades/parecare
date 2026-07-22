import type { Knex } from 'knex';

/**
 * The reorder workflow for a medication running low: depleted, then ordered,
 * then replenished. `reorder_ordered_at` records when a repeat was ordered.
 * It is the one piece of state the workflow needs:
 *   - not set, supply low  => depleted, needs ordering
 *   - set                  => ordered, awaiting delivery
 *   - cleared on restock    => replenished
 * An alert is raised when something ordered has not been replenished after
 * five days (the order still stands, so this column is still set).
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('medications', 'reorder_ordered_at'))) {
    await knex.schema.alterTable('medications', (t) => {
      t.timestamp('reorder_ordered_at', { useTz: true }).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('medications', 'reorder_ordered_at')) {
    await knex.schema.alterTable('medications', (t) => {
      t.dropColumn('reorder_ordered_at');
    });
  }
}
