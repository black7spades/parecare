import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Who the person in care is to each viewer: the owner's term lives on the
  // profile, every circle member carries their own on their membership.
  await knex.schema.alterTable('care_profiles', (t) => {
    t.string('owner_relationship', 100).nullable();
  });
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.string('relationship', 100).nullable();
  });

  // Checklist items grow a note thread: what happened, who was there,
  // where the information now lives. Ticking a box keeps its story.
  await knex.schema.createTable('checklist_item_notes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('checklist_item_id').notNullable().references('id').inTable('checklist_items').onDelete('CASCADE');
    t.uuid('author_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.text('body').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['checklist_item_id', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('checklist_item_notes');
  await knex.schema.alterTable('care_circle_members', (t) => {
    t.dropColumn('relationship');
  });
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('owner_relationship');
  });
}
