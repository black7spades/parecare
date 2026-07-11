import type { Knex } from 'knex';

/**
 * Treatments become the umbrella for everything done to manage a condition.
 * Medications remain their own tranche (the existing tables); this adds the
 * other tranche: therapies and devices, e.g. CPAP overnight, physiotherapy,
 * wound care or oxygen. Each treatment defines its own measures (what a
 * session records, in the unit the device or therapy actually reports), and
 * every session is logged as an observation whose values sit one-per-row —
 * never packed into a string.
 *
 * Devices can push their own output through the device API: a device key is
 * an unguessable token tied to one treatment, stored only as a hash.
 *
 * Conditions also gain their lifecycle: anyone can be afflicted with a
 * temporary condition, so whether it is expected to pass, its current
 * status, and when it started and cleared are each their own column.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('treatments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    // device | therapy | exercise | wound_care | diet | other
    t.string('category', 50).notNullable().defaultTo('other');
    // What this treatment manages.
    t.uuid('medical_condition_id').nullable().references('id').inTable('medical_conditions').onDelete('SET NULL');
    t.text('instructions').nullable();
    t.string('frequency', 255).nullable();
    t.jsonb('schedule_times').nullable(); // ["22:00"]
    // Only done when needed, not on a schedule.
    t.boolean('as_needed').notNullable().defaultTo(false);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index('care_profile_id');
  });

  // What one session of this treatment records, in the unit the device or
  // therapy reports. Name and unit are two data points, so two columns.
  await knex.schema.createTable('treatment_metrics', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('treatment_id').notNullable().references('id').inTable('treatments').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.string('unit', 50).nullable();
    // number | text | yes_no
    t.string('value_type', 20).notNullable().defaultTo('number');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index('treatment_id');
  });

  // A machine's credentials for pushing its own readings. The token is
  // stored only as a hash; the prefix is kept so the key can be recognised.
  await knex.schema.createTable('device_keys', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('treatment_id').notNullable().references('id').inTable('treatments').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.string('token_hash', 64).notNullable().unique();
    t.string('token_prefix', 12).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('last_used_at').nullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('treatment_id');
  });

  // One logged session of a treatment: who or what recorded it, when it
  // happened, and how it went. The readings live in observation_values.
  await knex.schema.createTable('observations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('treatment_id').notNullable().references('id').inTable('treatments').onDelete('CASCADE');
    t.timestamp('observed_at').notNullable().defaultTo(knex.fn.now());
    t.uuid('recorded_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.string('recorded_by_name', 255).nullable();
    // manual | device
    t.string('source', 20).notNullable().defaultTo('manual');
    t.uuid('device_key_id').nullable().references('id').inTable('device_keys').onDelete('SET NULL');
    // completed | partial | skipped | refused
    t.string('status', 30).notNullable().defaultTo('completed');
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id', 'observed_at']);
    t.index('treatment_id');
  });

  // One reading per row: the metric it belongs to and its value in the
  // column matching the metric's type. Never two values in one cell.
  await knex.schema.createTable('observation_values', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('observation_id').notNullable().references('id').inTable('observations').onDelete('CASCADE');
    t.uuid('treatment_metric_id').notNullable().references('id').inTable('treatment_metrics').onDelete('CASCADE');
    t.decimal('value_number', 14, 3).nullable();
    t.text('value_text').nullable();
    t.boolean('value_boolean').nullable();
    t.index('observation_id');
  });

  // A condition's lifecycle, one fact per column: whether it is expected to
  // pass, how it stands now, and when it started and cleared.
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.boolean('is_temporary').notNullable().defaultTo(false);
    // active | improving | managed | resolved
    t.string('status', 20).notNullable().defaultTo('active');
    t.date('started_on').nullable();
    t.date('resolved_on').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.dropColumn('is_temporary');
    t.dropColumn('status');
    t.dropColumn('started_on');
    t.dropColumn('resolved_on');
  });
  await knex.schema.dropTable('observation_values');
  await knex.schema.dropTable('observations');
  await knex.schema.dropTable('device_keys');
  await knex.schema.dropTable('treatment_metrics');
  await knex.schema.dropTable('treatments');
}
