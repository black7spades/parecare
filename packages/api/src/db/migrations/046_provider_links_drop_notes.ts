import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.text('booking_link').nullable();
    t.text('directions_link').nullable();
    t.dropColumn('notes');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.text('notes').nullable();
    t.dropColumn('directions_link');
    t.dropColumn('booking_link');
  });
}
