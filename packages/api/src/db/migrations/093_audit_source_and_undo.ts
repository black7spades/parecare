import type { Knex } from 'knex';

/**
 * The audit trail learns to say how a change was made and, for the changes
 * that created something, to point at what they created so it can be undone.
 *
 * - source: whether a change came from a person's own hands, from Pare, or
 *   from an outside assistant driving the API. Defaults to 'person', so every
 *   existing row and every ordinary write is attributed correctly with no
 *   other change.
 * - entity_id: the row a create action inserted, so an undo can find and
 *   remove it. Null for updates, removals and the writes that have no single
 *   reversible row.
 * - undo_batch: groups the rows one action call wrote, so a single token can
 *   undo the whole call.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('audit_log', (t) => {
    t.string('source', 16).notNullable().defaultTo('person'); // person | pare | assistant
    t.uuid('entity_id').nullable();
    t.uuid('undo_batch').nullable();
    t.index('undo_batch');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('audit_log', (t) => {
    t.dropIndex('undo_batch');
    t.dropColumn('undo_batch');
    t.dropColumn('entity_id');
    t.dropColumn('source');
  });
}
