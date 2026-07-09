import type { Knex } from 'knex';

/**
 * Dose amount and dose measure are two data points, so they become two
 * columns; `dose` stays as the composed display string (like full_name),
 * so the MAR, emergency sheet and exports keep working unchanged. Adds a
 * repeats-due date for when a repeat prescription is next needed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.string('dose_amount', 50).nullable();
    t.string('dose_unit', 30).nullable();
    t.date('repeats_due').nullable();
  });

  // Split existing "20mg" / "5 mL" style strings into amount + measure.
  const meds = await knex('medications').select('id', 'dose');
  for (const med of meds) {
    const raw = String(med.dose ?? '').trim();
    if (!raw) continue;
    const m = /^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/.exec(raw);
    const amount = m ? m[1] : null;
    const unit = m ? m[2].trim() || null : raw;
    await knex('medications').where({ id: med.id }).update({ dose_amount: amount, dose_unit: unit });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('dose_amount');
    t.dropColumn('dose_unit');
    t.dropColumn('repeats_due');
  });
}
