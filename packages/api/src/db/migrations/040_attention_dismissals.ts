import type { Knex } from 'knex';

/**
 * A record that someone has acknowledged and set aside a "needs attention"
 * item, so it stops showing on their Homeboard. Only dismissible items (an
 * out-of-stock medication) are ever stored here; other items clear when the
 * underlying thing is done. The item_key is a stable string built from the
 * item, e.g. "out_of_stock:<medication_id>", so a restock can clear the
 * dismissal and let the alert recur if the medication runs out again.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('attention_dismissals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('item_key', 255).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'item_key']);
    t.index('item_key');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('attention_dismissals');
}
