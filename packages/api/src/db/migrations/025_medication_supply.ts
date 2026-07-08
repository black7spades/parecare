import type { Knex } from 'knex';

/**
 * Replace the superfluous prescriber field with supply tracking. "supply" is
 * the total amount on hand (in the same unit as the dose, e.g. mg or mL) and
 * "supply_remaining" counts down by the dose each time a dose is given.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.decimal('supply', 12, 3).nullable();
    t.decimal('supply_remaining', 12, 3).nullable();
  });
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('prescriber');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.string('prescriber', 255).nullable();
  });
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('supply');
    t.dropColumn('supply_remaining');
  });
}
