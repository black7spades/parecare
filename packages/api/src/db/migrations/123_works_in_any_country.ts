import type { Knex } from 'knex';

/**
 * Works in any country.
 *
 * 1. country_settings: the one country this PareCare is set to, whether
 *    whoever runs it has confirmed it, and when the services were last
 *    checked as a whole (the yearly check).
 * 2. accounts.country: an account that lives somewhere else picks its own.
 * 3. country_services: changes made on top of the built-in services, for
 *    everyone (account_id null) or for one account, and services added
 *    that are not built in. A row with is_own false only records that the
 *    built-in details were checked and found right.
 * 4. Journey steps name a kind of national service instead of carrying a
 *    fixed number: the 15 service steps from migration 121, and the quit
 *    smoking line beside "Book a support appointment". Their wording no
 *    longer names Australian services, which now come from the country.
 * 5. ID numbers for New Zealand, the UK, Ireland, Canada and the US, each
 *    its own field beside the Australian ones.
 */

// Fixed here so this migration does the same on every install.
const STEPS: Array<{ titles: string[]; title?: string; description?: string; service: string; call: boolean }> = [
  { titles: ['Register with the carer gateway', 'Register for carer support'], title: 'Register for carer support', description: 'Support for carers opens respite, counselling and emergency backup.', service: 'carer_support', call: true },
  { titles: ['Register with dementia support services'], description: 'For education, advice and support groups.', service: 'dementia_support', call: true },
  { titles: ['Contact My Aged Care for an assessment', 'Ask for an aged care assessment'], title: 'Ask for an aged care assessment', description: 'Call the aged care assessment service to start the assessment.', service: 'aged_care_assessment', call: true },
  { titles: ['Research residential care options'], service: 'aged_care_finder', call: true },
  { titles: ['Request a financial assessment'], service: 'aged_care_finances', call: true },
  { titles: ['Bring in help before the crisis'], service: 'aged_care_assessment', call: true },
  { titles: ['Get feeding support early if it hurts or worries you'], service: 'breastfeeding', call: true },
  { titles: ['Watch how the parents are doing'], service: 'parenting_perinatal', call: true },
  { titles: ['Ask about early support while you wait'], description: 'Disability funding for young children can often start before a diagnosis.', service: 'disability_funding', call: true },
  { titles: ['Apply for funding support'], description: 'Apply for disability funding. Bring the assessment and your logs.', service: 'disability_funding', call: true },
  { titles: ['Say it out loud with someone safe'], service: 'youth_helpline', call: true },
  { titles: ['Choose a program built for young people'], service: 'eating_disorders', call: true },
  { titles: ['Commit to the program'], service: 'alcohol_drugs', call: true },
  { titles: ['Tell one person'], service: 'mental_health_crisis', call: true },
  { titles: ['Screen your own mood honestly'], service: 'mental_health_support', call: true },
  {
    titles: ['Book a support appointment'],
    description: 'For smoking, your doctor can prescribe support that doubles your odds, and the quit line is free.',
    service: 'quit_smoking',
    call: false,
  },
];

// Wording only: a step whose text named an Australian rule.
const REWORDED: Array<{ title: string; from: string; description: string }> = [
  {
    title: 'Book the over seventy five health assessment',
    from: 'Or the full check for your age. A yearly full review is free in Australia from seventy five.',
    description: 'Or the full check for your age, once a year.',
  },
];

const ID_COLUMNS: Array<[string, number]> = [
  ['nhs_number', 10],
  ['nhi_number', 7],
  ['pps_number', 9],
  ['medical_card_number', 20],
  ['health_card_province', 2],
  ['health_card_number', 20],
  ['health_card_version', 4],
  ['medicare_mbi', 11],
  ['medicaid_number', 20],
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('country_settings', (t) => {
    t.smallint('id').primary().defaultTo(1);
    t.string('country', 2).nullable();
    t.timestamp('confirmed_at', { useTz: true }).nullable();
    t.uuid('confirmed_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.date('services_checked_on').nullable();
    t.date('check_emailed_on').nullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['confirmed_by_account_id']);
  });
  await knex.raw('ALTER TABLE country_settings ADD CONSTRAINT country_settings_one_row CHECK (id = 1)');
  // An install already in use was set up for Australia, which is what every
  // number in it was until now. Whoever runs it is asked to confirm.
  const used = await knex('accounts').first('id');
  if (used) await knex('country_settings').insert({ id: 1, country: 'AU' });

  await knex.schema.alterTable('accounts', (t) => {
    t.string('country', 2).nullable();
  });

  await knex.schema.createTable('country_services', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').nullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('country', 2).notNullable();
    t.string('kind', 60).notNullable();
    t.string('label', 160).nullable();
    t.boolean('is_own').notNullable().defaultTo(false);
    t.string('name', 160).nullable();
    t.string('phone', 50).nullable();
    t.string('website', 500).nullable();
    t.date('checked_on').nullable();
    t.uuid('updated_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['account_id']);
    t.index(['updated_by_account_id']);
  });
  await knex.raw('CREATE UNIQUE INDEX country_services_everyone_uniq ON country_services (country, kind) WHERE account_id IS NULL');
  await knex.raw('CREATE UNIQUE INDEX country_services_account_uniq ON country_services (account_id, country, kind) WHERE account_id IS NOT NULL');

  for (const table of ['journey_template_tasks', 'checklist_items']) {
    await knex.schema.alterTable(table, (t) => {
      t.string('action_service', 40).nullable();
    });
  }

  const systemTasks = () =>
    knex('journey_template_phases as p').join('journey_templates as j', 'p.template_id', 'j.id').where('j.is_system', true).select('p.id');
  const systemItems = () =>
    knex('care_journey_phases as cp')
      .join('care_journeys as cj', 'cp.care_journey_id', 'cj.id')
      .join('journey_templates as j', 'cj.template_id', 'j.id')
      .where('j.is_system', true)
      .select('cp.id');

  for (const step of STEPS) {
    const cols: Record<string, unknown> = { action_service: step.service };
    if (step.title) cols['title'] = step.title;
    if (step.description) cols['description'] = step.description;
    // A call step's name, number and site now come from the country.
    if (step.call) Object.assign(cols, { action: 'call', action_contact_name: null, action_phone: null, action_url: null });
    await knex('journey_template_tasks').whereIn('template_phase_id', systemTasks()).whereIn('title', step.titles).update(cols);
    await knex('checklist_items').where({ is_custom: false }).whereIn('care_journey_phase_id', systemItems()).whereIn('title', step.titles).update(cols);
  }
  for (const r of REWORDED) {
    await knex('journey_template_tasks').whereIn('template_phase_id', systemTasks()).where({ title: r.title, description: r.from }).update({ description: r.description });
    await knex('checklist_items').where({ is_custom: false, title: r.title, description: r.from }).update({ description: r.description });
  }

  await knex.schema.alterTable('profile_identifiers', (t) => {
    for (const [col, len] of ID_COLUMNS) t.string(col, len).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('profile_identifiers', (t) => {
    for (const [col] of ID_COLUMNS) t.dropColumn(col);
  });
  for (const table of ['checklist_items', 'journey_template_tasks']) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('action_service');
    });
  }
  await knex.schema.dropTable('country_services');
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('country');
  });
  await knex.schema.dropTable('country_settings');
}
