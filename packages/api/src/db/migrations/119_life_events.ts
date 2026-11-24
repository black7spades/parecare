import type { Knex } from 'knex';

/**
 * Life events: the records the journeys already tell people to keep.
 *
 * 1. Hospital stays: when they went in and came out, the hospital, ward and
 *    treating team, why, the discharge letter, and the follow-up tasks a
 *    discharge makes. One open stay per person at a time. A medicine change
 *    can name the stay it came from.
 * 2. Test results, each measure its own row, tied to the test appointment
 *    and the visit to talk about them at.
 * 3. Funding plans (an NDIS plan or an aged care package) with their dates,
 *    how the plan is managed, its contacts and budgets. A cost can count
 *    against a budget, and a task can belong to a plan.
 * 4. Equipment says whether it is owned, on loan or hired, when it goes
 *    back and when it is due a service. A task can belong to equipment.
 * 5. Moves into care: the home, the dates that matter and the home they
 *    left, kept in the address book.
 * 6. Built-in next step kind "Report to get".
 *
 * Backfill: equipment already on file with a price or purchase date was
 * bought, so it is marked owned.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('hospital_stays', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('hospital_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.date('admitted_on').notNullable();
    t.date('discharged_on').nullable();
    t.string('ward', 120).nullable();
    t.string('treating_team', 255).nullable();
    t.uuid('treating_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.text('reason').nullable();
    t.uuid('discharge_document_id').nullable().references('id').inTable('documents').onDelete('SET NULL');
    t.uuid('follow_up_task_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
    t.uuid('plan_review_task_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id', 'admitted_on']);
    t.index(['hospital_provider_id']);
    t.index(['treating_provider_id']);
    t.index(['discharge_document_id']);
    t.index(['follow_up_task_id']);
    t.index(['plan_review_task_id']);
    t.index(['created_by_account_id']);
  });
  await knex.raw('CREATE UNIQUE INDEX hospital_stays_one_open ON hospital_stays (care_profile_id) WHERE discharged_on IS NULL');
  await knex.raw('ALTER TABLE hospital_stays ADD CONSTRAINT hospital_stays_dates_check CHECK (discharged_on IS NULL OR discharged_on >= admitted_on)');

  await knex.schema.alterTable('medication_changes', (t) => {
    t.uuid('hospital_stay_id').nullable().references('id').inTable('hospital_stays').onDelete('SET NULL');
    t.index(['hospital_stay_id']);
  });

  await knex.schema.createTable('test_results', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('test_name', 255).notNullable();
    t.date('collected_on').nullable();
    t.date('reported_on').nullable();
    t.uuid('appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.uuid('review_appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.uuid('ordered_by_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('lab_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('medical_condition_id').nullable().references('id').inTable('medical_conditions').onDelete('SET NULL');
    t.text('summary').nullable();
    t.string('doctor_view', 20).nullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id', 'collected_on']);
    t.index(['appointment_id']);
    t.index(['review_appointment_id']);
    t.index(['ordered_by_provider_id']);
    t.index(['lab_provider_id']);
    t.index(['medical_condition_id']);
    t.index(['created_by_account_id']);
  });
  await knex.raw(
    "ALTER TABLE test_results ADD CONSTRAINT test_results_doctor_view_check CHECK (doctor_view IS NULL OR doctor_view IN ('normal', 'follow_up', 'not_seen'))"
  );

  await knex.schema.createTable('test_result_values', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('test_result_id').notNullable().references('id').inTable('test_results').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.decimal('value_number', 14, 4).nullable();
    t.string('value_text', 255).nullable();
    t.string('unit', 30).nullable();
    t.decimal('range_low', 14, 4).nullable();
    t.decimal('range_high', 14, 4).nullable();
    t.string('flag', 10).nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.index(['test_result_id']);
  });
  await knex.raw(
    "ALTER TABLE test_result_values ADD CONSTRAINT test_result_values_flag_check CHECK (flag IS NULL OR flag IN ('low', 'high', 'normal'))"
  );

  await knex.schema.createTable('funding_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('scheme', 30).notNullable();
    t.date('starts_on').nullable();
    t.date('ends_on').nullable();
    t.date('review_on').nullable();
    t.date('reports_due_on').nullable();
    t.string('management', 20).nullable();
    t.uuid('plan_manager_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('support_coordinator_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('local_area_coordinator_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id']);
    t.index(['plan_manager_provider_id']);
    t.index(['support_coordinator_provider_id']);
    t.index(['local_area_coordinator_provider_id']);
  });
  await knex.raw(
    "ALTER TABLE funding_plans ADD CONSTRAINT funding_plans_scheme_check CHECK (scheme IN ('ndis', 'support_at_home', 'home_care_package', 'other'))"
  );
  await knex.raw(
    "ALTER TABLE funding_plans ADD CONSTRAINT funding_plans_management_check CHECK (management IS NULL OR management IN ('agency', 'plan', 'self'))"
  );

  await knex.schema.createTable('funding_budget_categories', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('funding_plan_id').notNullable().references('id').inTable('funding_plans').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.index(['funding_plan_id']);
  });

  await knex.schema.alterTable('health_spend_entries', (t) => {
    t.uuid('funding_budget_category_id').nullable().references('id').inTable('funding_budget_categories').onDelete('SET NULL');
    t.index(['funding_budget_category_id']);
  });

  await knex.schema.alterTable('assets', (t) => {
    t.string('ownership', 20).nullable();
    t.date('return_by').nullable();
    t.date('service_due_on').nullable();
  });
  await knex.raw("ALTER TABLE assets ADD CONSTRAINT assets_ownership_check CHECK (ownership IS NULL OR ownership IN ('owned', 'loaned', 'hired'))");
  await knex.raw("UPDATE assets SET ownership = 'owned' WHERE ownership IS NULL AND (price IS NOT NULL OR purchase_date IS NOT NULL)");

  await knex.schema.alterTable('reminders', (t) => {
    t.uuid('funding_plan_id').nullable().references('id').inTable('funding_plans').onDelete('SET NULL');
    t.uuid('asset_id').nullable().references('id').inTable('assets').onDelete('SET NULL');
    t.index(['funding_plan_id']);
    t.index(['asset_id']);
  });

  await knex.schema.createTable('care_moves', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('facility_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.date('entry_on').nullable();
    t.date('agreement_signed_on').nullable();
    t.date('cooling_off_ends_on').nullable();
    t.string('payment_choice', 20).nullable();
    t.date('payment_choice_due_on').nullable();
    t.date('notice_given_on').nullable();
    t.date('leaving_on').nullable();
    t.uuid('previous_address_id').nullable().references('id').inTable('addresses').onDelete('SET NULL');
    t.uuid('payment_task_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
    t.uuid('cooling_off_task_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id']);
    t.index(['facility_provider_id']);
    t.index(['previous_address_id']);
    t.index(['payment_task_id']);
    t.index(['cooling_off_task_id']);
  });
  await knex.raw(
    "ALTER TABLE care_moves ADD CONSTRAINT care_moves_payment_choice_check CHECK (payment_choice IS NULL OR payment_choice IN ('lump_sum', 'daily', 'mix'))"
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('care_moves');
  await knex.schema.alterTable('reminders', (t) => {
    t.dropColumn('asset_id');
    t.dropColumn('funding_plan_id');
  });
  await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_ownership_check');
  await knex.schema.alterTable('assets', (t) => {
    t.dropColumn('service_due_on');
    t.dropColumn('return_by');
    t.dropColumn('ownership');
  });
  await knex.schema.alterTable('health_spend_entries', (t) => {
    t.dropColumn('funding_budget_category_id');
  });
  await knex.schema.dropTableIfExists('funding_budget_categories');
  await knex.schema.dropTableIfExists('funding_plans');
  await knex.schema.dropTableIfExists('test_result_values');
  await knex.schema.dropTableIfExists('test_results');
  await knex.schema.alterTable('medication_changes', (t) => {
    t.dropColumn('hospital_stay_id');
  });
  await knex.schema.dropTableIfExists('hospital_stays');
}
