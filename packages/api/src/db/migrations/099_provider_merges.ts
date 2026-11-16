import type { Knex } from 'knex';

/**
 * Two records for the same place, merged into one.
 *
 * - providers.also_known_as: the other names a provider goes by, such as the
 *   name of a duplicate merged into it. Pare, outside assistants, imports and
 *   the Based at picker all find a provider by these too, so the duplicate is
 *   never filed again. One field holding several names of the same kind.
 * - provider_merges: what one merge changed, so it can be undone for a while:
 *   the removed record as it was, the kept record as it was, and every row
 *   that was pointed from one to the other.
 * - provider_duplicate_dismissals: pairs someone has said are not the same,
 *   so they are not suggested again.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.specificType('also_known_as', 'text[]').notNullable().defaultTo('{}');
  });

  await knex.schema.createTable('provider_merges', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.uuid('actor_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.uuid('kept_id').notNullable();
    t.uuid('removed_id').notNullable();
    t.jsonb('kept_before').notNullable();
    t.jsonb('removed_before').notNullable();
    t.jsonb('moved').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('undone_at').nullable();
    t.index(['account_id', 'created_at']);
  });

  await knex.schema.createTable('provider_duplicate_dismissals', (t) => {
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    // Stored with the smaller id first, so a pair has one row either way round.
    t.uuid('first_id').notNullable().references('id').inTable('providers').onDelete('CASCADE');
    t.uuid('second_id').notNullable().references('id').inTable('providers').onDelete('CASCADE');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['first_id', 'second_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('provider_duplicate_dismissals');
  await knex.schema.dropTable('provider_merges');
  await knex.schema.alterTable('providers', (t) => {
    t.dropColumn('also_known_as');
  });
}
