import type { Knex } from 'knex';

/**
 * Sentiment on care log entries. A carer's note ("Mum was cheerful and ate a
 * full lunch" versus "refused every meal and seemed withdrawn") carries an
 * emotional reading that is worth tracking over time and surfacing in reports.
 *
 * The value uses the same 1-to-6 scale as task outcome ratings (1 angry to 6
 * overjoyed), so the two read the same way everywhere. It is analysed from the
 * note by the assistant when one is not given, but a person's own rating always
 * wins: sentiment_source records which it was, so a later analysis never
 * overwrites a hand-set value.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_log_entries', (t) => {
    // 1 angry, 2 sad, 3 disappointed, 4 neutral, 5 happy, 6 overjoyed.
    t.smallint('sentiment').nullable();
    // 'ai' when analysed from the note, 'manual' when a person set it.
    t.string('sentiment_source', 10).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_log_entries', (t) => {
    t.dropColumn('sentiment');
    t.dropColumn('sentiment_source');
  });
}
