import type { Knex } from 'knex';

/**
 * Watches: the alerts a person sets up for themselves. The bell and the
 * What's new screen already show everything as it happens; a watch is the
 * opposite direction, a specific thing this person wants pushed to a
 * destination, on their own terms.
 *
 * Each watch names one metric to keep an eye on (a medication running low,
 * an appointment coming up, a new message, and so on), an optional scope (one
 * person, and for medication metrics one medication), the thresholds that
 * decide when it fires (how many days ahead, whether only the dangerous ones
 * count), where it is delivered (one of the person's notification channels),
 * and its rhythm (the moment it happens, or bundled into a digest). Several
 * digest watches sharing a destination and rhythm are composed into one
 * message, so a fortnightly email can carry supply, appointments and a
 * medication record together.
 *
 * Every distinct fact is its own column: the horizon in days and the
 * dangerous-only flag are separate, never packed together.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notification_watches', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    // Which metric this watch follows (medication_supply, appointment_upcoming,
    // dose_overdue, task_due, care_plan, mar_report, care_activity, new_message,
    // document_added, health_change). Kept as a string so new metrics need no
    // migration.
    t.string('metric', 40).notNullable();
    // Scope. Null care_profile_id means everyone this account can see; null
    // medication_id (medication metrics) means every medication in scope.
    t.uuid('care_profile_id').nullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('medication_id').nullable().references('id').inTable('medications').onDelete('CASCADE');
    // How far ahead to look: supply days remaining, appointment or task lead
    // days. Null where the metric does not use a horizon.
    t.integer('threshold_days').nullable();
    // Only the ones marked dangerous to miss (medication metrics) or needing
    // isolation (health) count towards firing.
    t.boolean('critical_only').notNullable().defaultTo(false);
    // Where it is delivered: one of this account's notification channels.
    t.uuid('channel_id').nullable().references('id').inTable('notification_channels').onDelete('CASCADE');
    // The moment it happens (immediate) or bundled at a rhythm.
    t.string('cadence', 12).notNullable().defaultTo('immediate'); // immediate | daily | weekly | fortnightly | monthly
    // What the person named it, else a sentence is derived for display.
    t.string('label', 160).nullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    // Room for metric-specific extras without a migration.
    t.jsonb('config').notNullable().defaultTo('{}');
    // When this watch last sent, so a digest waits a full period and an
    // immediate alert is not repeated needlessly.
    t.timestamp('last_sent_at').nullable();
    t.timestamps(true, true);
    t.index('account_id');
    t.index('channel_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('notification_watches');
}
