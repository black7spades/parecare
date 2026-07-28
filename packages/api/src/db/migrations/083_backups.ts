import type { Knex } from 'knex';

/**
 * A record of every copy taken of this installation, so the Backups screen
 * can say plainly when the last one worked and offer it back.
 *
 * A copy is the database and the uploaded documents together: restoring one
 * without the other leaves records pointing at files that are not there.
 *
 * Each copy is stamped with the tier it is kept under. Tiers are how a
 * plain-language "keep copies for 30 days" turns into an hourly copy for the
 * last day, a daily one for the last month and so on, without the person
 * choosing any of that. Nothing in the interface says the word tier.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('backups')) return;
  await knex.schema.createTable('backups', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('finished_at').nullable();
    // running while it is being taken, ok once it is safely stored, failed
    // when it could not be. A failed row is kept so the screen can say what
    // went wrong rather than showing nothing.
    t.string('status', 20).notNullable().defaultTo('running');
    // scheduled when the timer took it, manual when a person pressed the
    // button. Manual copies are never pruned automatically.
    t.string('kind', 20).notNullable().defaultTo('scheduled');
    t.string('tier', 20).nullable();
    // Where the file sits, in the same shape documents use.
    t.text('file_url').nullable();
    t.string('filename', 400).nullable();
    t.bigInteger('size_bytes').nullable();
    // sha256 of the stored file, so damage in place is detectable.
    t.string('checksum', 64).nullable();
    // Rows counted in the live database when the copy was taken, and again
    // inside the copy when it was checked. Equal means the copy is good.
    t.integer('source_rows').nullable();
    t.integer('verified_rows').nullable();
    t.timestamp('verified_at').nullable();
    // Plain sentence, safe to show a worried person. Never a stack trace.
    t.text('error').nullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.index(['started_at']);
    t.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('backups');
}
