import type { Knex } from 'knex';

/**
 * A client key on a care log entry, so a note captured on a phone with no
 * signal and sent later arrives exactly once. The device makes the key when it
 * writes the note; if the queued note is sent more than once (a flaky
 * reconnect, the app reopened mid-send), the second insert collides with the
 * first and is ignored rather than making a duplicate entry.
 *
 * Nullable and unique only per profile: entries created the ordinary way carry
 * no key and are unaffected.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_log_entries', (t) => {
    t.string('client_key', 64).nullable();
    t.unique(['care_profile_id', 'client_key']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_log_entries', (t) => {
    t.dropUnique(['care_profile_id', 'client_key']);
    t.dropColumn('client_key');
  });
}
