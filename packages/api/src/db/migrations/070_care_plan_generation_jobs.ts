import type { Knex } from 'knex';

/**
 * Care plan generation runs the AI, which can take a while, especially on a
 * self-hosted local model. Rather than hold one long HTTP request open (which
 * a reverse proxy will kill), generation now runs as a background job the
 * client kicks off and then polls. One row per run records its state, any
 * error, and the version it produced.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('care_plan_generation_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    // running | succeeded | failed
    t.string('status', 20).notNullable().defaultTo('running');
    t.text('error').nullable();
    // The version produced, when one was (an update with no changes produces none).
    t.uuid('result_version_id').nullable().references('id').inTable('care_plan_versions').onDelete('SET NULL');
    // no_changes | published | awaiting_signoff, mirroring the update result.
    t.string('result_status', 30).nullable();
    t.integer('applied_count').nullable();
    t.timestamps(true, true);
    t.index('care_profile_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('care_plan_generation_jobs');
}
