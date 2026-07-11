import type { Knex } from 'knex';

/**
 * Two additions:
 *
 * 1. A shared condition catalogue, mirroring the medication catalogue: a
 *    condition name is stored once for the whole instance and offered as a
 *    typeahead suggestion wherever conditions are entered. It ships seeded
 *    with common conditions across all life stages, and anything a user
 *    types that is not in it yet is added, so the catalogue grows with use.
 *    Per-profile medical_conditions keep their own name column (the person's
 *    record must survive catalogue edits) and gain an optional link to the
 *    catalogue entry they came from.
 *
 * 2. notification_reads: which notification items an account has read, so
 *    the bell badge counts only what is genuinely new to them.
 */

// Common conditions across all life stages, in plain language. Pregnancy and
// infancy first, then childhood, adulthood and older age.
const COMMON_CONDITIONS = [
  // Pregnancy and infancy
  'Gestational diabetes',
  'Preeclampsia',
  'Postnatal depression',
  'Morning sickness',
  'Colic',
  'Newborn jaundice',
  'Reflux in babies',
  'Tongue tie',
  'Prematurity',
  // Childhood and adolescence
  'Asthma',
  'Eczema',
  'Food allergy',
  'Hay fever',
  'Ear infections',
  'Croup',
  'Chickenpox',
  'Attention deficit hyperactivity disorder',
  'Autism',
  'Dyslexia',
  'Speech delay',
  'Developmental delay',
  'Cerebral palsy',
  'Down syndrome',
  'Type 1 diabetes',
  'Scoliosis',
  'Bedwetting',
  // Mental health, any age
  'Anxiety',
  'Depression',
  'Bipolar disorder',
  'Schizophrenia',
  'Obsessive compulsive disorder',
  'Post-traumatic stress disorder',
  'Eating disorder',
  'Insomnia',
  // Adulthood
  'Type 2 diabetes',
  'High blood pressure',
  'High cholesterol',
  'Coronary heart disease',
  'Atrial fibrillation',
  'Heart failure',
  'Stroke',
  'Chronic obstructive pulmonary disease',
  'Sleep apnoea',
  'Migraine',
  'Irritable bowel syndrome',
  "Crohn's disease",
  'Ulcerative colitis',
  'Coeliac disease',
  'Gastro-oesophageal reflux',
  'Stomach ulcer',
  'Chronic kidney disease',
  'Kidney stones',
  'Fatty liver disease',
  'Underactive thyroid',
  'Overactive thyroid',
  'Rheumatoid arthritis',
  'Osteoarthritis',
  'Gout',
  'Psoriasis',
  'Endometriosis',
  'Polycystic ovary syndrome',
  'Fibromyalgia',
  'Chronic fatigue syndrome',
  'Chronic pain',
  'Multiple sclerosis',
  'Epilepsy',
  "Parkinson's disease",
  'Motor neurone disease',
  'Anaemia',
  'Obesity',
  'Breast cancer',
  'Prostate cancer',
  'Bowel cancer',
  'Lung cancer',
  'Skin cancer',
  'Leukaemia',
  'Lymphoma',
  // Older age
  'Dementia',
  "Alzheimer's disease",
  'Vascular dementia',
  'Lewy body dementia',
  'Frontotemporal dementia',
  'Delirium',
  'Osteoporosis',
  'Falls risk',
  'Frailty',
  'Urinary incontinence',
  'Pressure sores',
  'Glaucoma',
  'Cataracts',
  'Macular degeneration',
  'Hearing loss',
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('condition_catalogue', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
  });
  // One shared entry per condition name (case-insensitive).
  await knex.raw('CREATE UNIQUE INDEX condition_catalogue_name_uniq ON condition_catalogue (lower(name))');

  await knex('condition_catalogue').insert(COMMON_CONDITIONS.map((name) => ({ name })));

  await knex.schema.alterTable('medical_conditions', (t) => {
    t.uuid('condition_catalogue_id').nullable().references('id').inTable('condition_catalogue').onDelete('SET NULL');
  });

  // Backfill: existing per-profile conditions join the catalogue (matching
  // seeded names case-insensitively, adding the rest), so what people already
  // recorded is suggested to everyone from day one.
  const existing = await knex('medical_conditions').select('id', 'name');
  const catalogue = await knex('condition_catalogue').select('id', 'name');
  const byLower = new Map<string, string>(catalogue.map((c) => [String(c.name).toLowerCase(), c.id as string]));
  for (const row of existing) {
    const name = String(row.name ?? '').trim();
    if (!name) continue;
    let catId = byLower.get(name.toLowerCase());
    if (!catId) {
      const [inserted] = await knex('condition_catalogue').insert({ name }).returning('id');
      catId = (inserted as { id: string }).id;
      byLower.set(name.toLowerCase(), catId);
    }
    await knex('medical_conditions').where({ id: row.id }).update({ condition_catalogue_id: catId });
  }

  await knex.schema.createTable('notification_reads', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('item_key', 255).notNullable();
    t.timestamp('read_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'item_key']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('notification_reads');
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.dropColumn('condition_catalogue_id');
  });
  await knex.schema.dropTable('condition_catalogue');
}
