import type { Knex } from 'knex';

/**
 * Emergency and sending information out.
 *
 * 1. A person's ID numbers, each its own column: Medicare with its position
 *    on the card and valid-to date, the Individual Healthcare Identifier, DVA
 *    with the card colour, NDIS, the health fund and member number, and My
 *    Aged Care. One row per person.
 * 2. An allergy says how bad the reaction is, and "no known allergies" is a
 *    checked fact with who checked and when, not an empty list. Allergies
 *    already on file whose reaction is anaphylaxis are marked life
 *    threatening.
 * 3. The care needs keep a list of what keeps eating and drinking safe, such
 *    as sitting upright or thickened fluids.
 * 4. Share links: an emergency sheet, an appointment or a report opened by
 *    someone with no login. Each link counts its opens and can be turned off.
 *    A report link names the documents sent with it.
 * 5. The health fund list for the ID numbers form.
 */
const HEALTH_FUNDS = [
  'ahm', 'Australian Unity', 'Bupa', 'CBHS', 'Defence Health', 'GMHBA', 'HBF', 'HCF', 'Medibank', 'nib', 'Peoplecare',
  'Teachers Health', 'Westfund',
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('profile_identifiers', (t) => {
    t.uuid('care_profile_id').primary().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('medicare_number', 10).nullable();
    t.smallint('medicare_irn').nullable();
    t.date('medicare_valid_to').nullable();
    t.string('ihi_number', 16).nullable();
    t.string('dva_number', 9).nullable();
    t.string('dva_card_colour', 10).nullable();
    t.string('ndis_number', 9).nullable();
    t.string('health_fund_name', 120).nullable();
    t.string('health_fund_member_number', 30).nullable();
    t.string('my_aged_care_number', 12).nullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('updated_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.index(['updated_by_account_id']);
  });

  await knex.schema.alterTable('allergies', (t) => {
    t.string('severity', 20).nullable();
  });
  await knex.raw(
    "ALTER TABLE allergies ADD CONSTRAINT allergies_severity_check CHECK (severity IS NULL OR severity IN ('mild', 'moderate', 'severe', 'life_threatening'))"
  );
  await knex.raw("UPDATE allergies SET severity = 'life_threatening' WHERE severity IS NULL AND reaction ~* 'anaphyla'");

  await knex.schema.alterTable('care_profiles', (t) => {
    t.date('no_known_allergies_on').nullable();
    t.uuid('no_known_allergies_by').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.index(['no_known_allergies_by']);
  });

  await knex.schema.alterTable('care_plans', (t) => {
    t.jsonb('swallowing_needs').notNullable().defaultTo('[]');
  });

  await knex.schema.createTable('share_links', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('token', 64).notNullable().unique();
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('kind', 30).notNullable();
    t.uuid('entity_id').nullable();
    t.uuid('provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('circle_member_id').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.string('recipient_email', 255).nullable();
    // The documents a report was sent with, shown on its shared page.
    t.specificType('document_ids', 'uuid[]').notNullable().defaultTo('{}');
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('expires_at', { useTz: true }).nullable();
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.timestamp('last_opened_at', { useTz: true }).nullable();
    t.integer('open_count').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['care_profile_id']);
    t.index(['provider_id']);
    t.index(['circle_member_id']);
    t.index(['created_by_account_id']);
  });
  await knex.raw(
    "ALTER TABLE share_links ADD CONSTRAINT share_links_kind_check CHECK (kind IN ('emergency_sheet', 'appointment', 'report'))"
  );
  // One emergency sheet link on at a time for each person.
  await knex.raw(
    "CREATE UNIQUE INDEX share_links_one_sheet_link ON share_links (care_profile_id) WHERE kind = 'emergency_sheet' AND revoked_at IS NULL"
  );

  for (const name of HEALTH_FUNDS) {
    const exists = await knex('option_catalogue').where({ category: 'health_fund' }).whereRaw('lower(name) = lower(?)', [name]).first('id');
    if (!exists) await knex('option_catalogue').insert({ category: 'health_fund', name });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('option_catalogue').where({ category: 'health_fund' }).delete();
  await knex.schema.dropTableIfExists('share_links');
  await knex.schema.alterTable('care_plans', (t) => {
    t.dropColumn('swallowing_needs');
  });
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('no_known_allergies_by');
    t.dropColumn('no_known_allergies_on');
  });
  await knex.raw('ALTER TABLE allergies DROP CONSTRAINT IF EXISTS allergies_severity_check');
  await knex.schema.alterTable('allergies', (t) => {
    t.dropColumn('severity');
  });
  await knex.schema.dropTableIfExists('profile_identifiers');
}
