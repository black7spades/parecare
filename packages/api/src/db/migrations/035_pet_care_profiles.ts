import type { Knex } from 'knex';

/**
 * The highest-level split for a care profile: a person or a pet. Everyone
 * created before pets existed is a person. Pets carry a few structured
 * facts of their own, each its own column so it stays sortable, filterable
 * and exportable on its own.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.string('kind', 20).notNullable().defaultTo('person');
    t.string('species', 60).nullable();
    t.string('breed', 120).nullable();
    // A plain binary like with-food: recorded only when true, unchecked
    // means not desexed.
    t.boolean('desexed').notNullable().defaultTo(false);
    t.string('microchip_number', 60).nullable();
  });
  await knex.raw(
    `ALTER TABLE care_profiles ADD CONSTRAINT care_profiles_kind_check CHECK (kind IN ('person', 'pet'))`
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE care_profiles DROP CONSTRAINT IF EXISTS care_profiles_kind_check');
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('kind');
    t.dropColumn('species');
    t.dropColumn('breed');
    t.dropColumn('desexed');
    t.dropColumn('microchip_number');
  });
}
