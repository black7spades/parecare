import type { Knex } from 'knex';

/**
 * Three additions, each guarded so the migration is safe to re-run against a
 * database that already has part of it.
 *
 * 1. Wi-Fi details on an address. Nobody remembers the network name or the
 *    password, and a carer arriving at a house needs both. Two data points,
 *    two columns. The password is stored encrypted at rest.
 * 2. Secrets: the logins kept for someone's life admin (social accounts, the
 *    rental, the bank). Only the account owner sees them, plus a power of
 *    attorney holder once a date of death is recorded, which is why
 *    `died_on` lands on the care profile here.
 * 3. Per-condition tracking. A condition under Current health (a sprained
 *    ankle that is still sore months later) needs its own thread: its own log,
 *    plus the appointments, documents and therapies that arose from it, so it
 *    can be followed without hunting through the whole care log.
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. Wi-Fi on an address ───────────────────────────────────────
  const hasNetworkName = await knex.schema.hasColumn('addresses', 'wifi_network_name');
  if (!hasNetworkName) {
    await knex.schema.alterTable('addresses', (t) => {
      // The name the network shows up as on a phone or laptop.
      t.string('wifi_network_name', 255).nullable();
      // Encrypted at rest; never returned to anyone without profile access.
      t.text('wifi_password').nullable();
    });
  }

  // ── 2. Secrets ───────────────────────────────────────────────────
  const hasDiedOn = await knex.schema.hasColumn('care_profiles', 'died_on');
  if (!hasDiedOn) {
    await knex.schema.alterTable('care_profiles', (t) => {
      // Recorded when someone dies. Unlocks the secrets to a power of
      // attorney holder, who has to settle the estate's accounts.
      t.date('died_on').nullable();
    });
  }

  const hasSecrets = await knex.schema.hasTable('secrets');
  if (!hasSecrets) {
    await knex.schema.createTable('secrets', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
      // social | bank | rental | utility | government | shopping | email | other
      t.string('category', 30).notNullable().defaultTo('other');
      // What this login is for, e.g. "Facebook" or "Origin Energy".
      t.string('label', 255).notNullable();
      // Every fact its own column: the site, who you sign in as, the
      // password, the account number, and anything else worth keeping.
      t.string('website_url', 500).nullable();
      t.string('username', 255).nullable();
      // Encrypted at rest.
      t.text('password').nullable();
      t.string('account_number', 120).nullable();
      t.text('notes').nullable();
      t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
      t.timestamps(true, true);
      t.index('care_profile_id');
    });
  }

  // ── 3. Per-condition tracking ────────────────────────────────────
  // Everything hangs off medical_conditions, which is what the Current health
  // card on a person's overview actually lists.
  const hasConditionLog = await knex.schema.hasTable('condition_log_entries');
  if (!hasConditionLog) {
    await knex.schema.createTable('condition_log_entries', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('medical_condition_id').notNullable().references('id').inTable('medical_conditions').onDelete('CASCADE');
      // note | symptom_change | treatment | appointment_outcome | test_result | other
      t.string('entry_type', 30).notNullable().defaultTo('note');
      t.string('title', 255).nullable();
      t.text('body').notNullable();
      t.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.uuid('author_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
      t.timestamps(true, true);
      t.index('medical_condition_id');
      t.index(['medical_condition_id', 'occurred_at']);
    });
  }

  const apptHasCondition = await knex.schema.hasColumn('appointments', 'medical_condition_id');
  if (!apptHasCondition) {
    await knex.schema.alterTable('appointments', (t) => {
      // The condition this appointment arose from, so the x-ray booked for a
      // sore ankle stays tied to the ankle in the record and on the calendar.
      t.uuid('medical_condition_id').nullable().references('id').inTable('medical_conditions').onDelete('SET NULL');
      t.index('medical_condition_id');
    });
  }

  const docHasCondition = await knex.schema.hasColumn('documents', 'medical_condition_id');
  if (!docHasCondition) {
    await knex.schema.alterTable('documents', (t) => {
      // The scan report or medical certificate that came out of a condition.
      t.uuid('medical_condition_id').nullable().references('id').inTable('medical_conditions').onDelete('SET NULL');
      t.index('medical_condition_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('documents', 'medical_condition_id')) {
    await knex.schema.alterTable('documents', (t) => t.dropColumn('medical_condition_id'));
  }
  if (await knex.schema.hasColumn('appointments', 'medical_condition_id')) {
    await knex.schema.alterTable('appointments', (t) => t.dropColumn('medical_condition_id'));
  }
  await knex.schema.dropTableIfExists('condition_log_entries');
  await knex.schema.dropTableIfExists('secrets');
  if (await knex.schema.hasColumn('care_profiles', 'died_on')) {
    await knex.schema.alterTable('care_profiles', (t) => t.dropColumn('died_on'));
  }
  if (await knex.schema.hasColumn('addresses', 'wifi_network_name')) {
    await knex.schema.alterTable('addresses', (t) => {
      t.dropColumn('wifi_network_name');
      t.dropColumn('wifi_password');
    });
  }
}
