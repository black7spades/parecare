import type { Knex } from 'knex';
import { limitsFromText } from '../../lib/asNeeded';

/**
 * The shift.
 *
 * 1. A care log entry and a reply to a question keep who wrote them, by
 *    their login. Entries already written take their author from the
 *    activity trail, or from the circle member already recorded.
 * 2. An as-needed medicine keeps what it is for, the least time between
 *    doses and the most in 24 hours. Medicines already on file have their
 *    limits read from the instructions they already carry.
 * 3. A change to a medicine keeps who said so, a contact, when a carer
 *    records a change a doctor or pharmacist asked for.
 * 4. A recorded dose keeps why an as-needed dose was needed now, whether it
 *    was given inside the gap or over the daily most, and why it had to be
 *    given anyway. The archive keeps the same three facts.
 * 5. A medicine found not in stock on a round points at that dose, so the
 *    out-of-stock alert shows until it is restocked, and taking the dose
 *    back takes the alert back without touching the stock count.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_log_entries', (t) => {
    t.uuid('author_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.index(['author_account_id']);
  });
  await knex.schema.alterTable('open_question_responses', (t) => {
    t.uuid('author_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.index(['author_account_id']);
  });
  await knex.schema.alterTable('medications', (t) => {
    t.smallint('max_doses_per_day').nullable();
    t.decimal('min_hours_between_doses', 4, 1).nullable();
    t.string('as_needed_for', 255).nullable();
  });
  await knex.schema.alterTable('medication_changes', (t) => {
    t.uuid('source_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.index(['source_provider_id']);
  });
  await knex.schema.alterTable('medication_administrations', (t) => {
    t.text('reason').nullable();
    t.boolean('outside_limits').notNullable().defaultTo(false);
    t.text('outside_limits_reason').nullable();
  });
  await knex.schema.alterTable('medication_administration_archive', (t) => {
    t.text('reason').nullable();
    t.boolean('outside_limits').notNullable().defaultTo(false);
    t.text('outside_limits_reason').nullable();
  });
  await knex.schema.alterTable('medications', (t) => {
    t.uuid('not_in_stock_admin_id').nullable().references('id').inTable('medication_administrations').onDelete('SET NULL');
    t.index(['not_in_stock_admin_id']);
  });

  // Care log authors: the person who created the entry, from the activity
  // trail, else the circle member the entry already names.
  await knex.raw(`
    UPDATE care_log_entries e SET author_account_id = a.actor_account_id
      FROM audit_log a
     WHERE e.author_account_id IS NULL
       AND a.entity_type = 'log' AND a.action = 'created' AND a.entity_id = e.id
       AND a.actor_account_id IS NOT NULL
  `);
  await knex.raw(`
    UPDATE care_log_entries e SET author_account_id = m.account_id
      FROM care_circle_members m
     WHERE e.author_account_id IS NULL AND e.author_member_id = m.id AND m.account_id IS NOT NULL
  `);

  // Reply authors: the circle member already named, else whoever posted to
  // that question within a few seconds of the reply, from the activity trail.
  await knex.raw(`
    UPDATE open_question_responses r SET author_account_id = m.account_id
      FROM care_circle_members m
     WHERE r.author_account_id IS NULL AND r.author_member_id = m.id AND m.account_id IS NOT NULL
  `);
  await knex.raw(`
    UPDATE open_question_responses r SET author_account_id = (
      SELECT a.actor_account_id FROM audit_log a
       WHERE a.entity_type = 'questions' AND a.action = 'created' AND a.entity_id = r.question_id
         AND a.actor_account_id IS NOT NULL
         AND a.created_at BETWEEN r.created_at - interval '10 seconds' AND r.created_at + interval '10 seconds'
       ORDER BY abs(extract(epoch FROM (a.created_at - r.created_at))) ASC
       LIMIT 1)
     WHERE r.author_account_id IS NULL AND r.is_ai = false
  `);

  // As-needed limits read from the instructions already on file. A
  // scheduled medicine runs to its times and has none.
  const meds = (await knex('medications')
    .whereNotNull('instructions')
    .where('as_needed', true)
    .select('id', 'instructions', 'units_per_dose')) as Array<{ id: string; instructions: string; units_per_dose: string | number | null }>;
  for (const m of meds) {
    const limits = limitsFromText(m.instructions, m.units_per_dose == null ? null : Number(m.units_per_dose));
    if (limits.min_hours_between_doses == null && limits.max_doses_per_day == null) continue;
    await knex('medications').where({ id: m.id }).update({
      min_hours_between_doses: limits.min_hours_between_doses,
      max_doses_per_day: limits.max_doses_per_day,
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('not_in_stock_admin_id');
  });
  await knex.schema.alterTable('medication_administration_archive', (t) => {
    t.dropColumn('outside_limits_reason');
    t.dropColumn('outside_limits');
    t.dropColumn('reason');
  });
  await knex.schema.alterTable('medication_administrations', (t) => {
    t.dropColumn('outside_limits_reason');
    t.dropColumn('outside_limits');
    t.dropColumn('reason');
  });
  await knex.schema.alterTable('medication_changes', (t) => {
    t.dropColumn('source_provider_id');
  });
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('as_needed_for');
    t.dropColumn('min_hours_between_doses');
    t.dropColumn('max_doses_per_day');
  });
  await knex.schema.alterTable('open_question_responses', (t) => {
    t.dropColumn('author_account_id');
  });
  await knex.schema.alterTable('care_log_entries', (t) => {
    t.dropColumn('author_account_id');
  });
}
