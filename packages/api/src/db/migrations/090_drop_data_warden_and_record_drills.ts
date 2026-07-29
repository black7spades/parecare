import type { Knex } from 'knex';

/**
 * Two changes that belong together, because the first one is why the second
 * one matters.
 *
 * The data warden idea is gone. Asking somebody by email, onboarding them
 * through a link, and holding a whole separate right for it turned out to be
 * three ways for a person to end up in the wrong place with an account that
 * belongs to nobody. Backups now follow the ordinary rules everybody already
 * understands: a super admin can reach them, and so can an administrator.
 * Nothing else to nominate, nothing else to explain.
 *
 * What is left is proving the copies work, and three numbers do not do that
 * on their own. So a restore test now writes down what it did, kind by kind
 * of record, and picks out real named records to follow through being deleted
 * and coming back. Three tables rather than one blob, because every one of
 * these is a discrete fact somebody may want to sort a column by.
 */
export async function up(knex: Knex): Promise<void> {
  // --- The data warden, removed -------------------------------------------
  await knex.schema.dropTableIfExists('warden_invites');

  for (const column of ['warden_briefed_at', 'backups_seen_at', 'can_manage_backups']) {
    if (await knex.schema.hasColumn('accounts', column)) {
      await knex.schema.alterTable('accounts', (t) => t.dropColumn(column));
    }
  }
  if (await knex.schema.hasColumn('rights_templates', 'can_manage_backups')) {
    await knex.schema.alterTable('rights_templates', (t) => t.dropColumn('can_manage_backups'));
  }

  // --- What a restore test actually did -----------------------------------

  // Every step, in order, with how long it took: what was opened, what was
  // counted, what was deleted, what came back, and when the practice copy was
  // deleted.
  if (!(await knex.schema.hasTable('backup_drill_steps'))) {
    await knex.schema.createTable('backup_drill_steps', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('drill_id').notNullable().references('id').inTable('backup_drills').onDelete('CASCADE');
      // Order they happened in, kept explicitly so two steps in the same
      // second still read in the right order.
      t.integer('position').notNullable();
      t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('finished_at').nullable();
      // How long this step took, on its own.
      t.decimal('seconds', 8, 2).nullable();
      // What happened, in a sentence a worried person can read.
      t.string('title', 200).notNullable();
      // The numbers behind it, for anyone who wants them.
      t.text('detail').nullable();
      // done | failed
      t.string('outcome', 20).notNullable().defaultTo('done');
      t.index(['drill_id', 'position']);
    });
  }

  // One row per kind of record, read across: how many there were, how many
  // were left after they were deleted, and how many came back. The
  // fingerprints are worked out from the contents, so two identical
  // fingerprints mean the records came back unchanged rather than merely came
  // back in the right number.
  if (!(await knex.schema.hasTable('backup_drill_tables'))) {
    await knex.schema.createTable('backup_drill_tables', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('drill_id').notNullable().references('id').inTable('backup_drills').onDelete('CASCADE');
      t.string('table_name', 100).notNullable();
      // What this kind of record is called on screen, in plain words.
      t.string('kind', 100).notNullable();
      t.integer('rows_before').notNullable().defaultTo(0);
      t.integer('rows_after_destroy').notNullable().defaultTo(0);
      t.integer('rows_restored').notNullable().defaultTo(0);
      t.string('fingerprint_before', 32).nullable();
      t.string('fingerprint_after', 32).nullable();
      t.index(['drill_id']);
    });
  }

  // Named records followed individually. A count going back up proves
  // arithmetic. One named care note being gone and then being back, field for
  // field, proves what people are actually asking about.
  if (!(await knex.schema.hasTable('backup_drill_records'))) {
    await knex.schema.createTable('backup_drill_records', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('drill_id').notNullable().references('id').inTable('backup_drills').onDelete('CASCADE');
      t.string('table_name', 100).notNullable();
      t.string('kind', 100).notNullable();
      // What the record is called.
      t.string('label', 255).notNullable();
      // Who it belongs to. Its own field, never folded into the label.
      t.string('owner_label', 255).nullable();
      t.string('fingerprint_before', 32).nullable();
      // Whether it survived being destroyed. False is the good answer.
      t.boolean('present_after_destroy').notNullable().defaultTo(true);
      t.string('fingerprint_after', 32).nullable();
      t.index(['drill_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('backup_drill_records');
  await knex.schema.dropTableIfExists('backup_drill_tables');
  await knex.schema.dropTableIfExists('backup_drill_steps');

  if (!(await knex.schema.hasColumn('accounts', 'can_manage_backups'))) {
    await knex.schema.alterTable('accounts', (t) => {
      t.boolean('can_manage_backups').notNullable().defaultTo(false);
      t.timestamp('warden_briefed_at').nullable();
      t.timestamp('backups_seen_at').nullable();
    });
  }
  if ((await knex.schema.hasTable('rights_templates')) && !(await knex.schema.hasColumn('rights_templates', 'can_manage_backups'))) {
    await knex.schema.alterTable('rights_templates', (t) => {
      t.boolean('can_manage_backups').notNullable().defaultTo(false);
    });
  }
}
