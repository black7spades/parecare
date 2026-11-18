import type { Knex } from 'knex';

/**
 * Document categories people can add to, rename, combine and delete.
 *
 * Categories were a fixed list of ten written into the code. They now live in
 * their own table, one list per account, shared by everyone that account cares
 * for. The built-in ones keep a `system_key` so the code can still find "Care
 * plan" and "Advance care directive" whatever they are renamed to.
 *
 * Each document points at its category instead of holding a word. The old
 * "Medical record / certificate" is split in two: a document whose name looks
 * like a certificate moves to Medical certificate, the rest stay in Medical
 * record.
 */
const BUILT_INS: Array<[string, string]> = [
  ['poa', 'Power of attorney'],
  ['will', 'Will'],
  ['advance_care_directive', 'Advance care directive'],
  ['insurance', 'Insurance'],
  ['identity', 'Identity'],
  ['medical_record', 'Medical record'],
  ['medical_certificate', 'Medical certificate'],
  ['facility_contract', 'Facility contract'],
  ['financial', 'Financial'],
  ['care_plan', 'Care plan'],
  ['other', 'Other'],
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('document_categories', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.string('system_key', 50).nullable();
    // Set when deleted, so Undo can bring it back with its documents.
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamps(true, true);
    t.index(['account_id']);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX document_categories_account_name_uq ON document_categories (account_id, lower(name)) WHERE deleted_at IS NULL'
  );
  await knex.raw(
    'CREATE UNIQUE INDEX document_categories_account_key_uq ON document_categories (account_id, system_key) WHERE system_key IS NOT NULL'
  );

  const values = BUILT_INS.map(([key, name]) => knex.raw('(?, ?)', [key, name]).toQuery()).join(', ');
  await knex.raw(
    `INSERT INTO document_categories (account_id, system_key, name)
     SELECT a.id, b.key, b.name FROM accounts a CROSS JOIN (VALUES ${values}) AS b(key, name)`
  );

  await knex.schema.alterTable('documents', (t) => {
    t.uuid('category_id').nullable().references('id').inTable('document_categories').onDelete('SET NULL');
    t.index(['category_id']);
  });

  // Point every document at its account's matching category. Unknown words
  // and the old combined medical one are sorted as described above.
  await knex.raw(`
    UPDATE documents d
    SET category_id = dc.id
    FROM care_profiles p, document_categories dc
    WHERE p.id = d.care_profile_id
      AND dc.account_id = p.account_id
      AND dc.system_key = CASE
        WHEN d.category = 'medical_record' AND d.label ~* '(^|[^[:alnum:]])cert' THEN 'medical_certificate'
        WHEN d.category IN (${BUILT_INS.map(() => '?').join(', ')}) THEN d.category
        ELSE 'other'
      END
  `, BUILT_INS.map(([key]) => key));

  await knex.schema.alterTable('documents', (t) => {
    t.dropColumn('category');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('documents', (t) => {
    t.string('category', 100).nullable();
  });
  await knex.raw(`
    UPDATE documents d
    SET category = CASE
      WHEN dc.system_key = 'medical_certificate' THEN 'medical_record'
      WHEN dc.system_key IS NOT NULL THEN dc.system_key
      ELSE 'other'
    END
    FROM document_categories dc
    WHERE dc.id = d.category_id
  `);
  await knex('documents').whereNull('category').update({ category: 'other' });
  await knex.schema.alterTable('documents', (t) => {
    t.string('category', 100).notNullable().alter();
    t.dropColumn('category_id');
  });
  await knex.schema.dropTable('document_categories');
}
