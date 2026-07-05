import type { Knex } from 'knex';

/**
 * Per-account pinning of care profiles (quick access in the left nav), and a
 * history of care-journey phases so prior phases can be shown as locked
 * read-only with the date they were locked off.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('care_profile_pins', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('pinned_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'care_profile_id']);
    t.index('account_id');
  });

  await knex.schema.createTable('care_phase_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('phase', 50).notNullable();
    t.timestamp('entered_at').notNullable().defaultTo(knex.fn.now());
    // Set when the profile moves on from this phase; a set value means the
    // phase is locked read-only. locked_by records the actor.
    t.timestamp('locked_at').nullable();
    t.uuid('locked_by').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.unique(['care_profile_id', 'phase']);
    t.index('care_profile_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('care_phase_history');
  await knex.schema.dropTable('care_profile_pins');
}
