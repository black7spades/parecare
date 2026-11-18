import type { Knex } from 'knex';

/**
 * When each person last looked at each care profile, so the overview can
 * show what changed since then.
 *
 * Two times are kept. `seen_at` is the visit going on now; `previous_seen_at`
 * is the one before it, which is what "since" means on screen. A new visit
 * only starts after an hour away, so reloading the page does not wipe the
 * list someone is in the middle of reading.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('profile_visits', (t) => {
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.timestamp('seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('previous_seen_at', { useTz: true }).nullable();
    t.primary(['account_id', 'care_profile_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('profile_visits');
}
