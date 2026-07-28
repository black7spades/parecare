import type { Knex } from 'knex';

/**
 * Two gaps in the first version of backups.
 *
 * One person could reach them. If the super admin is away, loses their
 * account, or something happens to them, nobody else could get the records
 * back, which in a care setting is not a hypothetical. can_manage_backups
 * joins the existing account rights so at least one other person can be
 * nominated. It is off by default, because a copy holds everyone's health
 * records.
 *
 * Nothing recorded whether a copy had ever left this server. Copies that
 * only exist on the machine they are protecting are not protection, and the
 * screen was calling that state protected. Remembering when a copy was taken
 * away lets it tell the truth instead.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('accounts', 'can_manage_backups'))) {
    await knex.schema.alterTable('accounts', (t) => {
      t.boolean('can_manage_backups').notNullable().defaultTo(false);
    });
  }
  // Rights templates carry every right, so the new one can be handed out the
  // same way as the rest rather than only one account at a time.
  if ((await knex.schema.hasTable('rights_templates')) && !(await knex.schema.hasColumn('rights_templates', 'can_manage_backups'))) {
    await knex.schema.alterTable('rights_templates', (t) => {
      t.boolean('can_manage_backups').notNullable().defaultTo(false);
    });
  }
  if (!(await knex.schema.hasColumn('backups', 'downloaded_at'))) {
    await knex.schema.alterTable('backups', (t) => {
      t.timestamp('downloaded_at').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('accounts', 'can_manage_backups')) {
    await knex.schema.alterTable('accounts', (t) => t.dropColumn('can_manage_backups'));
  }
  if (await knex.schema.hasColumn('backups', 'downloaded_at')) {
    await knex.schema.alterTable('backups', (t) => t.dropColumn('downloaded_at'));
  }
}
