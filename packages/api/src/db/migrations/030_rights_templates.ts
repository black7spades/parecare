import type { Knex } from 'knex';

/**
 * Rights templates: a named bundle of the per-account rights that an
 * administrator can apply to many accounts at once ("Night carer" for a
 * whole shift roster). Applying a template stamps its values onto the
 * selected accounts; the account columns stay the single source of truth
 * and can still be adjusted individually afterwards.
 *
 * Three starter templates are seeded as sensible defaults; they are
 * ordinary rows an admin can rename, change or delete.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('rights_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 100).notNullable();
    t.text('description').nullable();
    t.boolean('can_create_care_profiles').notNullable().defaultTo(false);
    t.boolean('can_invite_members').notNullable().defaultTo(true);
    t.boolean('can_use_ai').notNullable().defaultTo(true);
    t.boolean('can_export_data').notNullable().defaultTo(true);
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX rights_templates_name_uniq ON rights_templates (lower(name))');

  await knex('rights_templates').insert([
    {
      name: 'Family organiser',
      description: 'Runs the care of their own people: creates profiles, invites the circle, uses every tool.',
      can_create_care_profiles: true,
      can_invite_members: true,
      can_use_ai: true,
      can_export_data: true,
    },
    {
      name: 'Professional carer',
      description: 'Works with people shared with them: records care and uses the assistant, but does not create profiles or invite others.',
      can_create_care_profiles: false,
      can_invite_members: false,
      can_use_ai: true,
      can_export_data: true,
    },
    {
      name: 'View-only helper',
      description: 'Reads and joins the conversation only. No creating, inviting, assistant or exports.',
      can_create_care_profiles: false,
      can_invite_members: false,
      can_use_ai: false,
      can_export_data: false,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('rights_templates');
}
