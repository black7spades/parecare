import type { Knex } from 'knex';

/**
 * Cold storage for the medication administration record. Administrations older
 * than the super-admin retention horizon are moved here so the live table stays
 * lean, but nothing is ever deleted — archived rows remain queryable. The table
 * is self-contained (no cascading foreign keys) so history survives even if a
 * medication is later removed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('medication_administration_archive', (t) => {
    t.uuid('id').primary();
    t.uuid('medication_id').notNullable();
    t.uuid('care_profile_id').notNullable();
    t.string('medication_name', 255).nullable();
    t.timestamp('scheduled_for').nullable();
    t.timestamp('administered_at').notNullable();
    t.uuid('administered_by_account_id').nullable();
    t.string('administered_by_name', 255).nullable();
    t.string('status', 30).notNullable();
    t.string('dose_given', 255).nullable();
    t.string('route_given', 100).nullable();
    t.text('notes').nullable();
    t.boolean('right_patient').notNullable().defaultTo(false);
    t.boolean('right_medication').notNullable().defaultTo(false);
    t.boolean('right_dose').notNullable().defaultTo(false);
    t.boolean('right_route').notNullable().defaultTo(false);
    t.boolean('right_time').notNullable().defaultTo(false);
    t.boolean('right_documentation').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable();
    t.timestamp('archived_at').notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id', 'administered_at']);
    t.index('medication_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('medication_administration_archive');
}
