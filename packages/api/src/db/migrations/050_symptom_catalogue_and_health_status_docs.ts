import type { Knex } from 'knex';

const SYMPTOMS = [
  // General / systemic
  'Fever', 'Chills', 'Fatigue', 'Weakness', 'Malaise', 'Night sweats',
  'Weight loss', 'Weight gain', 'Loss of appetite', 'Excessive thirst',
  'Swollen lymph nodes', 'Dehydration', 'Excessive sweating',

  // Pain
  'Headache', 'Chest pain', 'Abdominal pain', 'Back pain', 'Joint pain',
  'Muscle pain', 'Neck pain', 'Pelvic pain', 'Sore throat', 'Ear pain',
  'Eye pain', 'Tooth pain', 'Generalised pain',

  // Respiratory
  'Cough', 'Shortness of breath', 'Wheezing', 'Nasal congestion',
  'Runny nose', 'Sneezing', 'Sinus pressure', 'Difficulty breathing',
  'Chest tightness', 'Coughing up blood', 'Coughing up mucus',

  // Gastrointestinal
  'Nausea', 'Vomiting', 'Diarrhoea', 'Constipation', 'Bloating',
  'Heartburn', 'Acid reflux', 'Difficulty swallowing', 'Blood in stool',
  'Stomach cramps', 'Gas', 'Indigestion',

  // Neurological
  'Dizziness', 'Lightheadedness', 'Confusion', 'Memory loss', 'Numbness',
  'Tingling', 'Tremor', 'Seizures', 'Blurred vision', 'Double vision',
  'Loss of balance', 'Fainting', 'Brain fog',

  // Skin
  'Rash', 'Itching', 'Hives', 'Bruising', 'Swelling', 'Redness',
  'Dry skin', 'Blistering', 'Skin discolouration', 'Wound not healing',
  'Acne', 'Peeling skin',

  // Mental / emotional
  'Anxiety', 'Depression', 'Irritability', 'Insomnia', 'Difficulty concentrating',
  'Mood swings', 'Panic attacks', 'Hallucinations', 'Agitation',
  'Disorientation', 'Restlessness', 'Apathy',

  // Musculoskeletal
  'Stiffness', 'Swollen joints', 'Limited range of motion', 'Muscle cramps',
  'Muscle weakness', 'Bone pain', 'Muscle spasms',

  // Cardiovascular
  'Palpitations', 'Rapid heartbeat', 'Slow heartbeat', 'Chest pressure',
  'Swollen ankles', 'Cold extremities', 'Irregular heartbeat',

  // Urinary
  'Frequent urination', 'Painful urination', 'Blood in urine',
  'Urgency', 'Incontinence', 'Dark urine', 'Reduced urine output',

  // ENT
  'Hearing loss', 'Tinnitus', 'Vertigo', 'Nosebleed', 'Hoarse voice',
  'Loss of taste', 'Loss of smell',

  // Eyes
  'Red eyes', 'Watery eyes', 'Dry eyes', 'Sensitivity to light',
  'Eye discharge', 'Eye swelling',

  // Children / infant specific
  'Refusing to eat', 'Inconsolable crying', 'Lethargy', 'Rash with fever',
  'Pulling at ears', 'Drooling', 'Difficulty feeding',

  // Post-operative / recovery
  'Wound pain', 'Surgical site redness', 'Drainage from wound',
  'Reduced mobility', 'Swelling at surgical site',

  // Other
  'Hair loss', 'Swollen glands', 'Difficulty sleeping',
  'Loss of consciousness', 'Unsteady gait', 'Sensitivity to sound',
  'Increased sensitivity to cold', 'Increased sensitivity to heat',
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('symptom_catalogue', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX symptom_catalogue_name_lower ON symptom_catalogue (lower(name))');

  // Seed
  if (SYMPTOMS.length > 0) {
    await knex('symptom_catalogue').insert(SYMPTOMS.map((name) => ({ name })));
  }

  // Link symptoms to catalogue
  await knex.schema.alterTable('health_status_symptoms', (t) => {
    t.uuid('symptom_catalogue_id').nullable().references('id').inTable('symptom_catalogue').onDelete('SET NULL');
  });

  // Join table: health statuses <-> documents
  await knex.schema.createTable('health_status_documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('health_status_id').notNullable().references('id').inTable('health_statuses').onDelete('CASCADE');
    t.uuid('document_id').notNullable().references('id').inTable('documents').onDelete('CASCADE');
    t.timestamps(true, true);
    t.unique(['health_status_id', 'document_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('health_status_documents');
  await knex.schema.alterTable('health_status_symptoms', (t) => {
    t.dropColumn('symptom_catalogue_id');
  });
  await knex.schema.dropTableIfExists('symptom_catalogue');
}
