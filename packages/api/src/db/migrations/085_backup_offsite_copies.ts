import type { Knex } from 'knex';

/**
 * Where a copy went once it left this server.
 *
 * A copy that only exists on the machine it is protecting is not protection.
 * Recording when each copy reached somewhere else, and what it is called
 * there, lets the screen tell the truth about whether this installation
 * would survive losing the server, and lets old copies be cleared from that
 * somewhere else as well as from here.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('backups', 'offsite_at'))) {
    await knex.schema.alterTable('backups', (t) => {
      t.timestamp('offsite_at').nullable();
      // The id the copy has wherever it was sent, so it can be removed from
      // there when it is thinned out here.
      t.string('offsite_ref', 255).nullable();
      t.string('offsite_error', 500).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('backups', 'offsite_at')) {
    await knex.schema.alterTable('backups', (t) => {
      t.dropColumn('offsite_at');
      t.dropColumn('offsite_ref');
      t.dropColumn('offsite_error');
    });
  }
}
