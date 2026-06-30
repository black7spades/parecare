import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('display_name', 255).notNullable();
    t.enum('subscription_status', ['active', 'past_due', 'canceled', 'trialing', 'incomplete']).nullable();
    t.enum('subscription_tier', ['free', 'family', 'professional']).notNullable().defaultTo('free');
    t.string('stripe_customer_id', 255).nullable().unique();
    t.string('stripe_subscription_id', 255).nullable().unique();
    t.timestamp('current_period_end').nullable();
    t.integer('ai_tokens_used').notNullable().defaultTo(0);
    t.timestamp('ai_tokens_reset_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('accounts');
}
