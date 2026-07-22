import type { Knex } from 'knex';

/**
 * The health spend ledger: one dated row per amount actually spent on
 * someone's care. Money is recorded at the moment it is committed, not
 * projected from a schedule:
 *
 * - a medication cost is logged when a repeat is replenished (the pack arrives);
 * - an appointment or therapy is given an estimate when it is booked, then
 *   confirmed to the real amount afterwards;
 * - a one-off cost can be entered by hand.
 *
 * Every spend is its own dated entry, so a report over any date range is just a
 * sum of the entries in that window. Amount, date, category and the record it
 * came from are each their own column; nothing is packed together.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('health_spend_entries'))) {
    await knex.schema.createTable('health_spend_entries', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
      // The amount spent, in the account's single currency.
      t.decimal('amount', 12, 2).notNullable();
      // The day the money was spent (or is expected to be, for an estimate).
      t.date('spent_on').notNullable();
      // medication | appointment | other
      t.string('category', 30).notNullable().defaultTo('other');
      // confirmed = a real amount that counts as spend; estimated = a booked
      // appointment's expected cost, not yet confirmed, kept out of totals.
      t.string('status', 20).notNullable().defaultTo('confirmed');
      // What the spend came from, when it is tied to a record. Nullable: a
      // hand-entered cost is tied to nothing.
      t.uuid('medication_id').nullable().references('id').inTable('medications').onDelete('SET NULL');
      t.uuid('appointment_id').nullable().references('id').inTable('appointments').onDelete('CASCADE');
      t.text('description').nullable();
      t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
      t.timestamps(true, true);
      t.index(['care_profile_id', 'spent_on']);
      // One appointment keeps a single spend entry, so booking then confirming
      // updates the same row rather than adding a second.
      t.unique(['appointment_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('health_spend_entries');
}
