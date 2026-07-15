import type { Knex } from 'knex';

/**
 * The conditions overhaul plus two supporting features:
 *
 * 1. medical_conditions grows from a name-plus-notes list into a structured
 *    health record. Each attribute is its own column: what kind of condition
 *    it is (chronic, acute, disability, other), how severe, whether it is
 *    expected to improve, and how long it is expected to last. The existing
 *    lifecycle columns (status, started_on, resolved_on, is_temporary) stay
 *    as they are.
 *
 * 2. condition_codes holds standard diagnosis codes, one row per code with
 *    the coding system (icd10 or snomed) and the code as two columns, so a
 *    condition can carry codes from both systems and interoperate with
 *    electronic health record systems.
 *
 * 3. condition_functions captures functional impact separately, following
 *    the International Classification of Functioning: which domain of life
 *    is limited, how much, in what temporal pattern, and what that means
 *    day to day.
 *
 * 4. treatments gain a proper lifecycle (current_status) and a review date,
 *    so the full treatment plan for a condition can be managed: therapies,
 *    surgery, lifestyle changes, assistive devices and more, alongside the
 *    medications that already link to conditions.
 *
 * 5. condition_catalogue entries gain reference ICD-10 and SNOMED CT codes,
 *    seeded for the common conditions, so picking a condition suggests its
 *    standard codes automatically.
 *
 * 6. appointments become a first-class table (previously only implied by
 *    calendar entries), feeding the calendar and the profile overview.
 *
 * 7. nav_pins stores which profile sections a carer has pinned to the top
 *    of their navigation, per account and per care profile.
 */

// Reference codes for the seeded common conditions. ICD-10 and SNOMED CT
// are two systems, so two columns. Null where no single obvious code exists.
const CATALOGUE_CODES: Record<string, { icd10: string | null; snomed: string | null }> = {
  'Gestational diabetes': { icd10: 'O24.4', snomed: '11687002' },
  'Preeclampsia': { icd10: 'O14.9', snomed: '398254007' },
  'Postnatal depression': { icd10: 'F53.0', snomed: '58703003' },
  'Morning sickness': { icd10: 'O21.0', snomed: '51885006' },
  'Colic': { icd10: 'R10.83', snomed: '32232003' },
  'Newborn jaundice': { icd10: 'P59.9', snomed: '387712008' },
  'Reflux in babies': { icd10: 'K21.9', snomed: '235595009' },
  'Tongue tie': { icd10: 'Q38.1', snomed: '67787004' },
  'Prematurity': { icd10: 'P07.3', snomed: '395507008' },
  'Asthma': { icd10: 'J45.9', snomed: '195967001' },
  'Eczema': { icd10: 'L20.9', snomed: '24079001' },
  'Food allergy': { icd10: 'T78.1', snomed: '414285001' },
  'Hay fever': { icd10: 'J30.1', snomed: '21719001' },
  'Ear infections': { icd10: 'H66.9', snomed: '65363002' },
  'Croup': { icd10: 'J05.0', snomed: '71186008' },
  'Chickenpox': { icd10: 'B01.9', snomed: '38907003' },
  'Attention deficit hyperactivity disorder': { icd10: 'F90.9', snomed: '406506008' },
  'Autism': { icd10: 'F84.0', snomed: '35919005' },
  'Dyslexia': { icd10: 'F81.0', snomed: null },
  'Speech delay': { icd10: 'F80.9', snomed: null },
  'Developmental delay': { icd10: 'F88', snomed: '248290002' },
  'Cerebral palsy': { icd10: 'G80.9', snomed: '128188000' },
  'Down syndrome': { icd10: 'Q90.9', snomed: '41040004' },
  'Type 1 diabetes': { icd10: 'E10.9', snomed: '46635009' },
  'Scoliosis': { icd10: 'M41.9', snomed: '298382003' },
  'Bedwetting': { icd10: 'F98.0', snomed: null },
  'Anxiety': { icd10: 'F41.9', snomed: '48694002' },
  'Depression': { icd10: 'F32.9', snomed: '35489007' },
  'Bipolar disorder': { icd10: 'F31.9', snomed: '13746004' },
  'Schizophrenia': { icd10: 'F20.9', snomed: '58214004' },
  'Obsessive compulsive disorder': { icd10: 'F42.9', snomed: '191736004' },
  'Post-traumatic stress disorder': { icd10: 'F43.1', snomed: '47505003' },
  'Eating disorder': { icd10: 'F50.9', snomed: '72366004' },
  'Insomnia': { icd10: 'G47.0', snomed: '193462001' },
  'Type 2 diabetes': { icd10: 'E11.9', snomed: '44054006' },
  'High blood pressure': { icd10: 'I10', snomed: '38341003' },
  'High cholesterol': { icd10: 'E78.0', snomed: '13644009' },
  'Coronary heart disease': { icd10: 'I25.1', snomed: '53741008' },
  'Atrial fibrillation': { icd10: 'I48.9', snomed: '49436004' },
  'Heart failure': { icd10: 'I50.9', snomed: '84114007' },
  'Stroke': { icd10: 'I63.9', snomed: '230690007' },
  'Chronic obstructive pulmonary disease': { icd10: 'J44.9', snomed: '13645005' },
  'Sleep apnoea': { icd10: 'G47.33', snomed: '78275009' },
  'Migraine': { icd10: 'G43.9', snomed: '37796009' },
  'Irritable bowel syndrome': { icd10: 'K58.9', snomed: '10743008' },
  "Crohn's disease": { icd10: 'K50.9', snomed: '34000006' },
  'Ulcerative colitis': { icd10: 'K51.9', snomed: '64766004' },
  'Coeliac disease': { icd10: 'K90.0', snomed: '396331005' },
  'Gastro-oesophageal reflux': { icd10: 'K21.9', snomed: '235595009' },
  'Stomach ulcer': { icd10: 'K25.9', snomed: '397825006' },
  'Chronic kidney disease': { icd10: 'N18.9', snomed: '709044004' },
  'Kidney stones': { icd10: 'N20.0', snomed: '95570007' },
  'Fatty liver disease': { icd10: 'K76.0', snomed: '197321007' },
  'Underactive thyroid': { icd10: 'E03.9', snomed: '40930008' },
  'Overactive thyroid': { icd10: 'E05.9', snomed: '34486009' },
  'Rheumatoid arthritis': { icd10: 'M06.9', snomed: '69896004' },
  'Osteoarthritis': { icd10: 'M19.9', snomed: '396275006' },
  'Gout': { icd10: 'M10.9', snomed: '90560007' },
  'Psoriasis': { icd10: 'L40.9', snomed: '9014002' },
  'Endometriosis': { icd10: 'N80.9', snomed: '129103003' },
  'Polycystic ovary syndrome': { icd10: 'E28.2', snomed: '69878008' },
  'Fibromyalgia': { icd10: 'M79.7', snomed: '203082005' },
  'Chronic fatigue syndrome': { icd10: 'G93.3', snomed: '52702003' },
  'Chronic pain': { icd10: 'R52', snomed: '82423001' },
  'Multiple sclerosis': { icd10: 'G35', snomed: '24700007' },
  'Epilepsy': { icd10: 'G40.9', snomed: '84757009' },
  "Parkinson's disease": { icd10: 'G20', snomed: '49049000' },
  'Motor neurone disease': { icd10: 'G12.2', snomed: '37340000' },
  'Anaemia': { icd10: 'D64.9', snomed: '271737000' },
  'Obesity': { icd10: 'E66.9', snomed: '414916001' },
  'Breast cancer': { icd10: 'C50.9', snomed: '254837009' },
  'Prostate cancer': { icd10: 'C61', snomed: '399068003' },
  'Bowel cancer': { icd10: 'C18.9', snomed: '363406005' },
  'Lung cancer': { icd10: 'C34.9', snomed: '363358000' },
  'Skin cancer': { icd10: 'C44.9', snomed: '372130007' },
  'Leukaemia': { icd10: 'C95.9', snomed: '93143009' },
  'Lymphoma': { icd10: 'C85.9', snomed: '118600007' },
  'Dementia': { icd10: 'F03', snomed: '52448006' },
  "Alzheimer's disease": { icd10: 'G30.9', snomed: '26929004' },
  'Vascular dementia': { icd10: 'F01.9', snomed: '429998004' },
  'Lewy body dementia': { icd10: 'G31.83', snomed: '80098002' },
  'Frontotemporal dementia': { icd10: 'G31.09', snomed: '230270009' },
  'Delirium': { icd10: 'F05', snomed: '2776000' },
  'Osteoporosis': { icd10: 'M81.0', snomed: '64859006' },
  'Falls risk': { icd10: 'Z91.81', snomed: '129839007' },
  'Frailty': { icd10: 'R54', snomed: '248279007' },
  'Urinary incontinence': { icd10: 'R32', snomed: '165232002' },
  'Pressure sores': { icd10: 'L89', snomed: '399912005' },
  'Glaucoma': { icd10: 'H40.9', snomed: '23986001' },
  'Cataracts': { icd10: 'H26.9', snomed: '193570009' },
  'Macular degeneration': { icd10: 'H35.3', snomed: '267718000' },
  'Hearing loss': { icd10: 'H91.9', snomed: '15188001' },
};

export async function up(knex: Knex): Promise<void> {
  // 1. Structured attributes on the condition itself.
  await knex.schema.alterTable('medical_conditions', (t) => {
    // chronic | acute | disability | other
    t.string('condition_type', 20).nullable();
    // mild | moderate | severe | profound
    t.string('severity', 20).nullable();
    // For disabilities: expected not to improve.
    t.boolean('is_permanent').nullable();
    // self_limiting | short_term | long_term | lifelong
    t.string('expected_duration', 20).nullable();
  });

  // Backfill condition_type from what is already known: a condition marked
  // temporary (or already resolved) is acute, everything else chronic.
  await knex('medical_conditions')
    .where('is_temporary', true)
    .orWhereNotNull('resolved_on')
    .update({ condition_type: 'acute' });
  await knex('medical_conditions').whereNull('condition_type').update({ condition_type: 'chronic' });

  // 2. Standard diagnosis codes, one per row. System and code are two data
  // points, so two columns.
  await knex.schema.createTable('condition_codes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('condition_id').notNullable().references('id').inTable('medical_conditions').onDelete('CASCADE');
    // icd10 | snomed
    t.string('system', 20).notNullable();
    t.string('code', 30).notNullable();
    t.timestamps(true, true);
    t.unique(['condition_id', 'system', 'code']);
    t.index('condition_id');
  });

  // 3. Functional impact, following the International Classification of
  // Functioning: one row per affected domain.
  await knex.schema.createTable('condition_functions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('condition_id').notNullable().references('id').inTable('medical_conditions').onDelete('CASCADE');
    // mobility | cognition | sensation | self_care | communication | social | work_study | other
    t.string('domain', 30).notNullable();
    // none | mild | moderate | severe | complete
    t.string('limitation_level', 20).notNullable().defaultTo('mild');
    // constant | intermittent | progressive | improving
    t.string('temporal_pattern', 20).nullable();
    t.text('impact_on_activities').nullable();
    t.timestamps(true, true);
    t.index('condition_id');
  });

  // 4. Treatment lifecycle: current_status supersedes the bare active flag
  // (kept in sync for existing callers), and last_review_date records when
  // the treatment plan was last looked at.
  await knex.schema.alterTable('treatments', (t) => {
    // active | completed | discontinued
    t.string('current_status', 20).notNullable().defaultTo('active');
    t.date('last_review_date').nullable();
  });
  await knex('treatments').where('active', false).update({ current_status: 'discontinued' });

  // 5. Reference codes on the shared catalogue.
  await knex.schema.alterTable('condition_catalogue', (t) => {
    t.string('icd10_code', 30).nullable();
    t.string('snomed_code', 30).nullable();
  });
  for (const [name, codes] of Object.entries(CATALOGUE_CODES)) {
    await knex('condition_catalogue')
      .whereRaw('lower(name) = ?', [name.toLowerCase()])
      .update({ icd10_code: codes.icd10, snomed_code: codes.snomed });
  }

  // 6. Appointments: a real record of who is being seen, where and when,
  // feeding the calendar rather than living inside it.
  await knex.schema.createTable('appointments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('title', 255).notNullable();
    // consultation | test | procedure | therapy | review | vaccination | other
    t.string('appointment_type', 30).notNullable().defaultTo('consultation');
    t.uuid('provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.string('location', 255).nullable();
    t.timestamp('starts_at', { useTz: true }).notNullable();
    t.timestamp('ends_at', { useTz: true }).nullable();
    // scheduled | completed | cancelled | missed
    t.string('status', 20).notNullable().defaultTo('scheduled');
    t.text('notes').nullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('care_profile_id');
    t.index(['care_profile_id', 'starts_at']);
  });

  // 7. Which profile sections a carer keeps at the top of their navigation.
  await knex.schema.createTable('nav_pins', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('item_key', 50).notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['account_id', 'care_profile_id', 'item_key']);
    t.index(['account_id', 'care_profile_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('nav_pins');
  await knex.schema.dropTableIfExists('appointments');
  await knex.schema.alterTable('condition_catalogue', (t) => {
    t.dropColumn('icd10_code');
    t.dropColumn('snomed_code');
  });
  await knex.schema.alterTable('treatments', (t) => {
    t.dropColumn('current_status');
    t.dropColumn('last_review_date');
  });
  await knex.schema.dropTableIfExists('condition_functions');
  await knex.schema.dropTableIfExists('condition_codes');
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.dropColumn('condition_type');
    t.dropColumn('severity');
    t.dropColumn('is_permanent');
    t.dropColumn('expected_duration');
  });
}
