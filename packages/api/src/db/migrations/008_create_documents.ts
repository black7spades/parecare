import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('uploaded_by').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.string('category', 100).notNullable();
    t.string('label', 255).notNullable();
    t.string('file_url', 500).notNullable();
    t.integer('file_size_bytes').nullable();
    t.string('mime_type', 100).nullable();
    t.specificType('visible_to_roles', 'TEXT[]').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('documents');
}
