import type { Knex } from 'knex';

/**
 * First-class medications plus an administration record built on the six
 * rights of medication administration (right patient, medication, dose, route,
 * time, and documentation). Existing care-plan medications are copied across so
 * nothing is re-entered.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('medications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.string('dose', 255).nullable();
    t.string('form', 100).nullable();
    t.string('route', 100).nullable();
    t.string('frequency', 255).nullable();
    t.jsonb('schedule_times').nullable(); // ["08:00","20:00"]
    t.text('instructions').nullable();
    t.string('prescriber', 255).nullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index('care_profile_id');
  });

  await knex.schema.createTable('medication_administrations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('medication_id').notNullable().references('id').inTable('medications').onDelete('CASCADE');
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.timestamp('scheduled_for').nullable();
    t.timestamp('administered_at').notNullable().defaultTo(knex.fn.now());
    t.uuid('administered_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.string('administered_by_name', 255).nullable();
    // given | refused | omitted | held | self_administered
    t.string('status', 30).notNullable().defaultTo('given');
    t.string('dose_given', 255).nullable();
    t.string('route_given', 100).nullable();
    t.text('notes').nullable();
    // The six rights, each confirmed at the point of administration.
    t.boolean('right_patient').notNullable().defaultTo(false);
    t.boolean('right_medication').notNullable().defaultTo(false);
    t.boolean('right_dose').notNullable().defaultTo(false);
    t.boolean('right_route').notNullable().defaultTo(false);
    t.boolean('right_time').notNullable().defaultTo(false);
    t.boolean('right_documentation').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id', 'administered_at']);
    t.index('medication_id');
  });

  // Copy existing care-plan medications into the new table.
  const plans = await knex('care_plans').select('care_profile_id', 'medications');
  const rows: Array<Record<string, unknown>> = [];
  for (const plan of plans) {
    const meds = Array.isArray(plan.medications) ? plan.medications : [];
    for (const m of meds) {
      if (!m || typeof m.name !== 'string' || !m.name.trim()) continue;
      rows.push({
        care_profile_id: plan.care_profile_id,
        name: m.name,
        dose: m.dose ?? null,
        frequency: m.frequency ?? null,
        prescriber: m.prescriber ?? null,
      });
    }
  }
  if (rows.length > 0) await knex('medications').insert(rows);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('medication_administrations');
  await knex.schema.dropTable('medications');
}
