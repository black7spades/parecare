import type { Knex } from 'knex';

/**
 * Power of attorney is not only held by people. A legal or financial firm
 * commonly holds enduring or financial power of attorney, and those firms
 * live in the providers table, not the care circle. Give providers the same
 * two POA data points a circle member has, so an organisation can be named
 * as an attorney exactly like a person.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.string('poa_type', 50).nullable();
    t.boolean('poa_activated').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.dropColumn('poa_type');
    t.dropColumn('poa_activated');
  });
}
