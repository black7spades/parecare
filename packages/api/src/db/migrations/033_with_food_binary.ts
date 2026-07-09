import type { Knex } from 'knex';

/**
 * With food is a binary fact recorded only when true: one checkbox,
 * checked means with food, anything else is false. No third state.
 */
export async function up(knex: Knex): Promise<void> {
  await knex('medications').whereNull('with_food').update({ with_food: false });
  await knex.schema.alterTable('medications', (t) => {
    t.boolean('with_food').notNullable().defaultTo(false).alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.boolean('with_food').nullable().alter();
  });
}
