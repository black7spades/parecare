import type { Knex } from 'knex';

/**
 * Price tracking for health spend. A medication carries the cost of one full
 * pack; a treatment carries the cost of one session, plus how many sessions
 * are expected in a year. From these the yearly spend on health is derived:
 * a medication's yearly cost comes from its schedule and pack size (how many
 * packs a year the schedule gets through), a treatment's from cost per session
 * times sessions a year. Every column is nullable: pricing is optional unless
 * a super admin makes it required in System settings.
 *
 * Dose, pack size and price stay separate data points in separate columns; the
 * annual figure is always computed, never stored packed with anything else.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('medications', 'price'))) {
    await knex.schema.alterTable('medications', (t) => {
      // Cost of one full pack, in the account's currency.
      t.decimal('price', 12, 2).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('treatments', 'price'))) {
    await knex.schema.alterTable('treatments', (t) => {
      // Cost of one session, in the account's currency.
      t.decimal('price', 12, 2).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('treatments', 'sessions_per_year'))) {
    await knex.schema.alterTable('treatments', (t) => {
      // Expected sessions in a year, used to annualise the per-session cost.
      t.integer('sessions_per_year').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('medications', 'price')) {
    await knex.schema.alterTable('medications', (t) => t.dropColumn('price'));
  }
  if (await knex.schema.hasColumn('treatments', 'sessions_per_year')) {
    await knex.schema.alterTable('treatments', (t) => t.dropColumn('sessions_per_year'));
  }
  if (await knex.schema.hasColumn('treatments', 'price')) {
    await knex.schema.alterTable('treatments', (t) => t.dropColumn('price'));
  }
}
