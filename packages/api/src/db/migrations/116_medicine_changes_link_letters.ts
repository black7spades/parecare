import type { Knex } from 'knex';

/**
 * A letter a medicine change came from lists that medicine under Attached
 * to. Changes already kept before this link their letters now. A change
 * remembers whether it made that link, so taking the change back never
 * removes a link someone made themselves.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medication_changes', (t) => {
    t.boolean('linked_document').notNullable().defaultTo(false);
  });
  await knex.raw(`
    UPDATE medication_changes ch SET linked_document = true
     WHERE ch.source_document_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM document_links l
          WHERE l.document_id = ch.source_document_id AND l.entity_type = 'medications' AND l.entity_id = ch.medication_id)
       AND ch.id = (
         SELECT c2.id FROM medication_changes c2
          WHERE c2.medication_id = ch.medication_id AND c2.source_document_id = ch.source_document_id
          ORDER BY c2.created_at ASC LIMIT 1)
  `);
  await knex.raw(`
    INSERT INTO document_links (document_id, entity_type, entity_id)
    SELECT DISTINCT ch.source_document_id, 'medications', ch.medication_id
      FROM medication_changes ch
     WHERE ch.source_document_id IS NOT NULL
    ON CONFLICT (document_id, entity_type, entity_id) DO NOTHING
  `);
}

// The links made here are left in place: they say something true.
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medication_changes', (t) => {
    t.dropColumn('linked_document');
  });
}
