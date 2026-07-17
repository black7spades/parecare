import type { Knex } from 'knex';

/**
 * Substance use: a health vector in its own right, covering both legal and
 * illegal drug taking (nicotine, alcohol, cannabis, heroin, and so on). Kept
 * as its own tranche rather than folded into conditions, because what it
 * captures is different: which substance, how it is taken, how much and how
 * often, where it sits in a lifecycle from active use to recovery, and when
 * it started or stopped. One fact, one column, everywhere.
 *
 * The substance itself lives in an instance-wide catalogue, mirroring the
 * condition and medication catalogues, so a substance typed once becomes a
 * suggestion for everyone. Its class (nicotine, alcohol, opioid, and so on)
 * is a property of the substance, not a legal judgement, since legality
 * varies by place.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('substance_catalogue', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable().unique();
    // nicotine | alcohol | cannabis | opioid | stimulant | depressant |
    // hallucinogen | inhalant | other
    t.string('substance_class', 40).notNullable().defaultTo('other');
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('substance_use', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('substance_catalogue_id').notNullable().references('id').inTable('substance_catalogue').onDelete('RESTRICT');
    // active | reducing | in_recovery | in_remission | former
    t.string('status', 20).notNullable().defaultTo('active');
    // smoked | vaped | oral | drunk | injected | inhaled | other
    t.string('route', 20).nullable();
    // How much per occasion, and its unit: two data points, two columns.
    t.string('quantity', 100).nullable();
    t.string('quantity_unit', 60).nullable();
    // How often, in the carer's words, e.g. "daily", "weekends only".
    t.string('frequency', 120).nullable();
    t.date('started_on').nullable();
    t.date('quit_on').nullable();
    t.text('notes').nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['care_profile_id', 'substance_catalogue_id']);
    t.index('care_profile_id');
  });

  // Seed the catalogue with common substances across classes, legal and
  // illegal, so the first typeahead is useful. Anything not here is added as
  // typed and becomes a suggestion from then on.
  const seed: Array<{ name: string; substance_class: string }> = [
    { name: 'Nicotine', substance_class: 'nicotine' },
    { name: 'Tobacco', substance_class: 'nicotine' },
    { name: 'Vaping', substance_class: 'nicotine' },
    { name: 'Alcohol', substance_class: 'alcohol' },
    { name: 'Cannabis', substance_class: 'cannabis' },
    { name: 'Caffeine', substance_class: 'other' },
    { name: 'Heroin', substance_class: 'opioid' },
    { name: 'Prescription opioids', substance_class: 'opioid' },
    { name: 'Methadone', substance_class: 'opioid' },
    { name: 'Fentanyl', substance_class: 'opioid' },
    { name: 'Cocaine', substance_class: 'stimulant' },
    { name: 'Methamphetamine', substance_class: 'stimulant' },
    { name: 'Amphetamines', substance_class: 'stimulant' },
    { name: 'MDMA', substance_class: 'stimulant' },
    { name: 'Benzodiazepines', substance_class: 'depressant' },
    { name: 'GHB', substance_class: 'depressant' },
    { name: 'Ketamine', substance_class: 'hallucinogen' },
    { name: 'LSD', substance_class: 'hallucinogen' },
    { name: 'Psilocybin', substance_class: 'hallucinogen' },
    { name: 'Inhalants', substance_class: 'inhalant' },
  ];
  await knex('substance_catalogue').insert(seed);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('substance_use');
  await knex.schema.dropTable('substance_catalogue');
}
