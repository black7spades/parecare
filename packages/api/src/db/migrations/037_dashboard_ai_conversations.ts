import type { Knex } from 'knex';

/**
 * Dashboard conversations with Pare are account-wide, not tied to one care
 * profile, so care_profile_id becomes nullable. A null profile id marks a
 * dashboard conversation; profile conversations keep their id as before.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE ai_conversations ALTER COLUMN care_profile_id DROP NOT NULL');
}

export async function down(knex: Knex): Promise<void> {
  await knex('ai_conversations').whereNull('care_profile_id').del();
  await knex.raw('ALTER TABLE ai_conversations ALTER COLUMN care_profile_id SET NOT NULL');
}
