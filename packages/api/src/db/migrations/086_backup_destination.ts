import type { Knex } from 'knex';

/**
 * Which somewhere-else a copy went to.
 *
 * With one destination there was nothing to record; with a choice of them,
 * a copy that is thinned out here has to be removed from the right place,
 * and the screen has to be able to say where each copy actually is rather
 * than "somewhere". The reference alone cannot say that: a Drive file id, a
 * Dropbox path and a storage key look nothing alike but all live in the
 * same column.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('backups', 'offsite_kind'))) {
    await knex.schema.alterTable('backups', (t) => {
      t.string('offsite_kind', 20).nullable();
    });
    // Copies already sent when Google Drive was the only choice.
    await knex('backups').whereNotNull('offsite_at').update({ offsite_kind: 'google' });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('backups', 'offsite_kind')) {
    await knex.schema.alterTable('backups', (t) => t.dropColumn('offsite_kind'));
  }
}
