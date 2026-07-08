import type { Knex } from 'knex';

/**
 * Accounts get the same structured name treatment as care profiles (first,
 * middle and last name as separate columns, display_name becomes the
 * composed form), plus granular per-account rights so an administrator can
 * control exactly what each account can do:
 *
 * - can_create_care_profiles (added in 028)
 * - can_invite_members: may invite people into circles they own
 * - can_use_ai: may talk to the AI assistant
 * - can_export_data: may download exports
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.string('first_name', 100).nullable();
    t.string('middle_name', 100).nullable();
    t.string('last_name', 100).nullable();
    t.boolean('can_invite_members').notNullable().defaultTo(true);
    t.boolean('can_use_ai').notNullable().defaultTo(true);
    t.boolean('can_export_data').notNullable().defaultTo(true);
  });

  const accounts = await knex('accounts').select('id', 'display_name');
  for (const a of accounts) {
    const words = String(a.display_name ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    await knex('accounts')
      .where({ id: a.id })
      .update({
        first_name: words[0],
        middle_name: words.length > 2 ? words.slice(1, -1).join(' ') : null,
        last_name: words.length > 1 ? words[words.length - 1] : null,
      });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('first_name');
    t.dropColumn('middle_name');
    t.dropColumn('last_name');
    t.dropColumn('can_invite_members');
    t.dropColumn('can_use_ai');
    t.dropColumn('can_export_data');
  });
}
