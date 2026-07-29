import type { Knex } from 'knex';

/**
 * Proving the backups work, and knowing a second person is really there.
 *
 * Every check so far read a copy back into an empty scratch database. That
 * proves the copy is readable, but it is not the disaster: a real restore
 * lands on a database that already has things in it, wrong things, and has
 * to clear them out on the way. Nobody knows that path works until it has
 * been run against records that were deliberately destroyed first.
 *
 * A drill does exactly that, on a scratch database that is always dropped.
 * Nothing live is ever involved, which is what makes it safe to do often
 * rather than never.
 *
 * The warden columns are how the levels tell the difference between someone
 * having been nominated, having been told what it means, and having actually
 * turned up. Only the last of those is protection.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('backup_drills'))) {
    await knex.schema.createTable('backup_drills', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('backup_id').nullable().references('id').inTable('backups').onDelete('SET NULL');
      t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('finished_at').nullable();
      // running, passed or failed. A failed drill is kept: it is the most
      // useful row in the table.
      t.string('status', 20).notNullable().defaultTo('running');
      // How far it got, so a failure can say which part broke in words.
      t.string('stage', 40).nullable();
      // Records counted at each point: in the copy, after being destroyed,
      // and after being put back. The middle number is the proof that the
      // destruction was real.
      t.integer('rows_before').nullable();
      t.integer('rows_after_destroy').nullable();
      t.integer('rows_restored').nullable();
      t.integer('files_before').nullable();
      t.integer('files_restored').nullable();
      t.text('error').nullable();
      t.uuid('run_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
      t.index(['started_at']);
    });
  }

  if (!(await knex.schema.hasColumn('accounts', 'warden_briefed_at'))) {
    await knex.schema.alterTable('accounts', (t) => {
      // When they were sent what being a data warden actually means.
      t.timestamp('warden_briefed_at').nullable();
      // When they last opened the Backups screen themselves, which is the
      // only evidence that a second person could really step in.
      t.timestamp('backups_seen_at').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('backup_drills');
  if (await knex.schema.hasColumn('accounts', 'warden_briefed_at')) {
    await knex.schema.alterTable('accounts', (t) => {
      t.dropColumn('warden_briefed_at');
      t.dropColumn('backups_seen_at');
    });
  }
}
