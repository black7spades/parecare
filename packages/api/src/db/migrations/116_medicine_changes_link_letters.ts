import type { Knex } from 'knex';

/**
 * A letter a medicine change came from lists that medicine under Attached
 * to. Changes already kept before this link their letters now.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    INSERT INTO document_links (document_id, entity_type, entity_id)
    SELECT DISTINCT ch.source_document_id, 'medications', ch.medication_id
      FROM medication_changes ch
     WHERE ch.source_document_id IS NOT NULL
    ON CONFLICT (document_id, entity_type, entity_id) DO NOTHING
  `);
}

// The links made here cannot be told apart from ones a person made by hand,
// so they are left in place.
export async function down(): Promise<void> {}
