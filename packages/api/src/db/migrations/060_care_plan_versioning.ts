import type { Knex } from 'knex';

/**
 * Event-driven, versioned care plan.
 *
 * - care_plan_events: one row per change to a watched source table
 *   (conditions, allergies, medications, treatments, providers, care
 *   needs). Events are the only input to plan updates; each is applied to
 *   exactly one version (idempotency) and kept as provenance.
 * - care_plan_versions: immutable snapshots of the assembled plan. A new
 *   version is created by applying a validated delta to the previous one,
 *   never by regenerating the whole document.
 * - care_plan_changes: the ordered add/modify/remove operations that
 *   turned one version into the next — the auditable changelog, with the
 *   source event ids that caused each operation.
 * - care_plan_access: fine-grained per-person permissions on the plan.
 * - care_plan_reviews: secure-link invitations to view, comment on or
 *   approve a version.
 * - care_plan_signatures: eSignatures on a version; a signed version is
 *   locked from automatic publishing on top of it.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('care_plan_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('source_table', 50).notNullable();
    t.uuid('source_id').nullable();
    t.string('action', 20).notNullable(); // created / updated / deleted
    t.string('summary', 255).nullable();
    t.jsonb('snapshot').nullable(); // the request body that made the change
    t.uuid('actor_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('processed_at').nullable();
    t.index(['care_profile_id', 'processed_at']);
  });

  await knex.schema.createTable('care_plan_versions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.integer('version').notNullable();
    t.string('status', 20).notNullable().defaultTo('draft'); // draft / awaiting_signoff / published
    t.jsonb('content').notNullable();
    t.string('content_hash', 64).notNullable();
    t.text('changelog').nullable();
    t.uuid('author_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.jsonb('applied_event_ids').notNullable().defaultTo('[]');
    t.uuid('document_id').nullable().references('id').inTable('documents').onDelete('SET NULL');
    t.integer('restored_from_version').nullable();
    t.boolean('locked').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('published_at').nullable();
    t.unique(['care_profile_id', 'version']);
    t.index(['care_profile_id', 'status']);
  });

  await knex.schema.createTable('care_plan_changes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('version_id').notNullable().references('id').inTable('care_plan_versions').onDelete('CASCADE');
    t.integer('position').notNullable().defaultTo(0); // order within the delta
    t.string('op', 10).notNullable(); // add / modify / remove
    t.string('section', 50).notNullable();
    t.string('entry_key', 255).notNullable();
    t.jsonb('before').nullable();
    t.jsonb('after').nullable();
    t.jsonb('source_event_ids').notNullable().defaultTo('[]');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['version_id', 'position']);
  });

  await knex.schema.createTable('care_plan_access', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('account_id').nullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('email', 255).nullable(); // explicit share to someone without an account
    t.string('access_role', 30).notNullable().defaultTo('shared'); // lead_coordinator / provider / carer / emergency_contact / shared
    t.boolean('can_view').notNullable().defaultTo(true);
    t.boolean('can_comment').notNullable().defaultTo(false);
    t.boolean('can_edit').notNullable().defaultTo(false);
    t.boolean('can_sign').notNullable().defaultTo(false);
    t.uuid('created_by').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id']);
  });

  await knex.schema.createTable('care_plan_reviews', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('version_id').notNullable().references('id').inTable('care_plan_versions').onDelete('CASCADE');
    t.string('token', 64).notNullable().unique();
    t.string('invited_email', 255).nullable();
    t.string('invited_name', 255).nullable();
    t.boolean('can_comment').notNullable().defaultTo(true);
    t.boolean('can_approve').notNullable().defaultTo(false);
    t.string('status', 20).notNullable().defaultTo('pending'); // pending / commented / approved / declined
    t.text('comment').nullable();
    t.uuid('created_by').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('responded_at').nullable();
    t.timestamp('expires_at').notNullable();
  });

  await knex.schema.createTable('care_plan_signatures', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('version_id').notNullable().references('id').inTable('care_plan_versions').onDelete('CASCADE');
    t.uuid('signer_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.string('signer_name', 255).notNullable();
    t.timestamp('signed_at').notNullable().defaultTo(knex.fn.now());
    t.string('signature_hash', 64).notNullable();
    t.text('signature_image').nullable(); // data-uri image of the drawn signature
    t.string('device', 512).nullable(); // user agent
    t.string('ip', 64).nullable();
    t.boolean('consent').notNullable().defaultTo(false);
    t.index(['version_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('care_plan_signatures');
  await knex.schema.dropTable('care_plan_reviews');
  await knex.schema.dropTable('care_plan_access');
  await knex.schema.dropTable('care_plan_changes');
  await knex.schema.dropTable('care_plan_versions');
  await knex.schema.dropTable('care_plan_events');
}
