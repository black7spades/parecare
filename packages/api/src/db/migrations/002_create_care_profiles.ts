import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('care_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('full_name', 255).notNullable();
    t.date('date_of_birth').nullable();
    t.enum('current_phase', [
      'early_concern',
      'home_with_support',
      'increased_dependency',
      'transition_to_residential',
      'residential_ongoing',
      'end_of_life',
    ])
      .notNullable()
      .defaultTo('early_concern');
    t.string('preferred_name', 100).nullable();
    t.string('pronouns', 50).nullable();
    t.string('primary_language', 100).nullable();
    t.string('photo_url', 500).nullable();
    t.text('notes').nullable();
    t.boolean('archived').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('care_profiles');
}
