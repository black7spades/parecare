import type { Knex } from 'knex';

/**
 * AI-written summaries shown on the overview cards of a care profile.
 * Generated once and stored, so opening the page does not re-run the
 * model; carers can regenerate on demand or edit the text and save it.
 * One row per profile and card.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('overview_card_summaries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('card_key', 40).notNullable();
    t.text('content').notNullable();
    // 'ai' when the model wrote it, 'edited' once a carer changed it.
    t.string('source', 10).notNullable().defaultTo('ai');
    t.timestamp('generated_at', { useTz: true }).nullable();
    t.uuid('updated_by').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['care_profile_id', 'card_key']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('overview_card_summaries');
}
