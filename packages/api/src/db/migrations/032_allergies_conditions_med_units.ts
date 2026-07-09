import type { Knex } from 'knex';

/**
 * Three related health-record upgrades, one fact per column throughout:
 *
 * 1. Allergies become a first-class table: the substance and the reaction
 *    it causes are two data points, so they are two columns.
 * 2. Medical conditions become a first-class table (backfilled from the
 *    care plan's conditions array) and medications can be tied to the
 *    condition they treat.
 * 3. Medications gain the fields people actually think in: how many
 *    units are taken per dose, whether it is taken with food, and
 *    whether it is only taken as needed. Supply switches from volume to
 *    units, because nobody says "I have 60 mg of Panadol left", they say
 *    "I have 3 Panadols left".
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('allergies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    // What they must not be given.
    t.string('substance', 255).notNullable();
    // What happens if they are.
    t.text('reaction').nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index('care_profile_id');
  });

  await knex.schema.createTable('medical_conditions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.text('notes').nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index('care_profile_id');
  });

  await knex.schema.alterTable('medications', (t) => {
    // What this medication treats.
    t.uuid('medical_condition_id').nullable().references('id').inTable('medical_conditions').onDelete('SET NULL');
    // How many units make up one dose, e.g. 3 capsules.
    t.decimal('units_per_dose', 8, 2).nullable();
    // Taken with food (true), without food (false), or unspecified (null).
    t.boolean('with_food').nullable();
    // Only taken when needed, not on a schedule.
    t.boolean('as_needed').notNullable().defaultTo(false);
  });

  // Backfill conditions from the care plan's array so nothing is retyped.
  const plans = await knex('care_plans').select('care_profile_id', 'conditions');
  for (const plan of plans) {
    const conditions: string[] = Array.isArray(plan.conditions) ? plan.conditions : [];
    const rows = conditions
      .map((c) => String(c).trim())
      .filter(Boolean)
      .map((name, i) => ({ care_profile_id: plan.care_profile_id, name, sort_order: i }));
    if (rows.length > 0) await knex('medical_conditions').insert(rows);
  }

  // Reinterpret supply as a unit count. Where the old volume-based value
  // divides cleanly by the dose amount, convert it; otherwise keep the
  // number as-is, which for most people already meant "how many I have".
  const meds = await knex('medications').select('id', 'dose', 'supply', 'supply_remaining');
  for (const med of meds) {
    const doseAmount = parseFloat(String(med.dose ?? '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(doseAmount) || doseAmount <= 1) continue;
    const update: Record<string, number> = {};
    for (const col of ['supply', 'supply_remaining'] as const) {
      const value = Number(med[col]);
      if (Number.isFinite(value) && value > 0 && value % doseAmount === 0 && value / doseAmount >= 1) {
        update[col] = value / doseAmount;
      }
    }
    if (Object.keys(update).length > 0) await knex('medications').where({ id: med.id }).update(update);
  }

  // "As needed" was previously packed into the frequency text.
  await knex('medications')
    .whereRaw("frequency ILIKE '%as needed%' OR frequency ILIKE '%prn%'")
    .update({ as_needed: true });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('medical_condition_id');
    t.dropColumn('units_per_dose');
    t.dropColumn('with_food');
    t.dropColumn('as_needed');
  });
  await knex.schema.dropTable('medical_conditions');
  await knex.schema.dropTable('allergies');
}
