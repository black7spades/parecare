import type { Knex } from 'knex';

/**
 * Documents follow the work.
 *
 * 1. A document knows the date it was written, when it is valid from and
 *    until (or that it does not expire), who wrote it and who it is to. A
 *    referral works its own dates out and keeps a "Get a new referral" task
 *    in step with them.
 * 2. New built-in document categories: Referral, Prescription, Test request,
 *    Results, Letter, Service agreement, Behaviour support plan. An account
 *    that already typed one of these names keeps its own category, which
 *    becomes the built-in.
 * 3. A medicine keeps the day it stopped, why, the last day of a course and
 *    the repeats left on the script. Every change to its dose or times is
 *    kept with the reason and where it came from.
 */

const NEW_CATEGORIES: Array<{ key: string; name: string }> = [
  { key: 'referral', name: 'Referral' },
  { key: 'prescription', name: 'Prescription' },
  { key: 'test_request', name: 'Test request' },
  { key: 'results', name: 'Results' },
  { key: 'letter', name: 'Letter' },
  { key: 'service_agreement', name: 'Service agreement' },
  { key: 'behaviour_support_plan', name: 'Behaviour support plan' },
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('documents', (t) => {
    t.date('issued_on').nullable();
    t.date('valid_from').nullable();
    t.uuid('valid_from_appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.date('valid_until').nullable();
    t.boolean('no_expiry').notNullable().defaultTo(false);
    t.boolean('valid_until_worked_out').notNullable().defaultTo(false);
    t.uuid('from_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('to_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('renewal_task_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
    t.index(['valid_from_appointment_id']);
    t.index(['from_provider_id']);
    t.index(['to_provider_id']);
    t.index(['renewal_task_id']);
  });

  await knex.schema.alterTable('medications', (t) => {
    t.date('stopped_on').nullable();
    t.string('stop_reason', 30).nullable();
    t.text('stop_notes').nullable();
    t.date('course_ends_on').nullable();
    t.smallint('repeats_left').nullable();
  });

  await knex.schema.createTable('medication_changes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('medication_id').notNullable().references('id').inTable('medications').onDelete('CASCADE');
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.date('changed_on').notNullable();
    t.string('change_kind', 20).notNullable();
    t.string('dose_amount_before', 50).nullable();
    t.string('dose_amount_after', 50).nullable();
    t.string('dose_unit_before', 30).nullable();
    t.string('dose_unit_after', 30).nullable();
    t.jsonb('schedule_times_before').nullable();
    t.jsonb('schedule_times_after').nullable();
    t.text('reason').nullable();
    t.uuid('source_appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.uuid('source_document_id').nullable().references('id').inTable('documents').onDelete('SET NULL');
    t.uuid('changed_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['medication_id', 'changed_on']);
    t.index(['care_profile_id']);
    t.index(['source_appointment_id']);
    t.index(['source_document_id']);
    t.index(['changed_by_account_id']);
  });
  await knex.raw(
    "ALTER TABLE medication_changes ADD CONSTRAINT medication_changes_kind_check CHECK (change_kind IN ('started', 'dose', 'times', 'stopped', 'restarted', 'other'))"
  );
  await knex.raw(
    "ALTER TABLE medications ADD CONSTRAINT medications_stop_reason_check CHECK (stop_reason IS NULL OR stop_reason IN ('finished', 'side_effects', 'not_working', 'changed', 'doctor_stopped', 'no_longer_needed', 'other'))"
  );

  // Built-in categories: adopt a live category of the same name first, so a
  // typed "Referral" becomes the built-in, then add the ones still missing.
  for (const c of NEW_CATEGORIES) {
    await knex.raw(
      `UPDATE document_categories dc SET system_key = ?
         WHERE dc.system_key IS NULL AND dc.deleted_at IS NULL AND lower(dc.name) = lower(?)
           AND NOT EXISTS (SELECT 1 FROM document_categories k WHERE k.account_id = dc.account_id AND k.system_key = ?)`,
      [c.key, c.name, c.key]
    );
    await knex.raw(
      `INSERT INTO document_categories (account_id, system_key, name)
         SELECT a.id, ?, ? FROM accounts a
          WHERE NOT EXISTS (SELECT 1 FROM document_categories k WHERE k.account_id = a.id AND k.system_key = ?)
            AND NOT EXISTS (SELECT 1 FROM document_categories n WHERE n.account_id = a.id AND n.deleted_at IS NULL AND lower(n.name) = lower(?))`,
      [c.key, c.name, c.key, c.name]
    );
  }

  // A medicine already off the list stopped on the day it was last changed.
  await knex.raw('UPDATE medications SET stopped_on = updated_at::date WHERE active = false AND stopped_on IS NULL');
}

export async function down(knex: Knex): Promise<void> {
  await knex('document_categories').whereIn('system_key', NEW_CATEGORIES.map((c) => c.key)).update({ system_key: null });
  await knex.schema.dropTableIfExists('medication_changes');
  await knex.raw('ALTER TABLE medications DROP CONSTRAINT IF EXISTS medications_stop_reason_check');
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('repeats_left');
    t.dropColumn('course_ends_on');
    t.dropColumn('stop_notes');
    t.dropColumn('stop_reason');
    t.dropColumn('stopped_on');
  });
  await knex.schema.alterTable('documents', (t) => {
    t.dropColumn('renewal_task_id');
    t.dropColumn('to_provider_id');
    t.dropColumn('from_provider_id');
    t.dropColumn('valid_until_worked_out');
    t.dropColumn('no_expiry');
    t.dropColumn('valid_until');
    t.dropColumn('valid_from_appointment_id');
    t.dropColumn('valid_from');
    t.dropColumn('issued_on');
  });
}
