import type { Knex } from 'knex';

/**
 * 1. Rounds of a repeating task. Ticking a repeating task, from any screen
 *    or by Pare, keeps a record of that round (when it was due, who did it,
 *    how it went, and the journey step it ticked) and moves the task on to
 *    its next date. The record is what Undo puts back.
 * 2. Journey steps can carry a service's website beside its number.
 * 3. The national services sweep: steps whose next move is to contact My
 *    Aged Care, Services Australia, the NDIS, Carer Gateway, Dementia
 *    Australia, Lifeline and the like get the number to call and
 *    the website, on the templates and on every journey under way.
 */
// The numbers and sites, fixed here so this migration does the same on every
// install whatever the catalogue says later.
const MAC = { action_contact_name: 'My Aged Care', action_phone: '1800 200 422', action_url: 'https://www.myagedcare.gov.au' };
const NDIS = { action_contact_name: 'NDIS', action_phone: '1800 800 110', action_url: 'https://www.ndis.gov.au' };
const LIFELINE = { action_contact_name: 'Lifeline', action_phone: '13 11 14', action_url: 'https://www.lifeline.org.au' };
const SWEPT: Record<string, { action_contact_name: string; action_phone: string; action_url: string | null }> = {
  'Register with the carer gateway': { action_contact_name: 'Carer Gateway', action_phone: '1800 422 737', action_url: 'https://www.carergateway.gov.au' },
  'Register with dementia support services': { action_contact_name: 'Dementia Australia', action_phone: '1800 100 500', action_url: 'https://www.dementia.org.au' },
  'Contact My Aged Care for an assessment': MAC,
  'Research residential care options': { ...MAC, action_url: 'https://www.myagedcare.gov.au/find-a-provider' },
  'Request a financial assessment': { action_contact_name: 'Services Australia', action_phone: '1800 227 475', action_url: 'https://www.servicesaustralia.gov.au' },
  'Bring in help before the crisis': MAC,
  'Get feeding support early if it hurts or worries you': { action_contact_name: 'Australian Breastfeeding Association', action_phone: '1800 686 268', action_url: 'https://www.breastfeeding.asn.au' },
  'Watch how the parents are doing': { action_contact_name: 'PANDA', action_phone: '1300 726 306', action_url: 'https://panda.org.au' },
  'Ask about early support while you wait': NDIS,
  'Apply for funding support': NDIS,
  'Say it out loud with someone safe': { action_contact_name: 'Kids Helpline', action_phone: '1800 55 1800', action_url: 'https://kidshelpline.com.au' },
  'Choose a program built for young people': { action_contact_name: 'Butterfly Foundation', action_phone: '1800 33 4673', action_url: 'https://butterfly.org.au' },
  'Commit to the program': { action_contact_name: 'National Alcohol and Other Drug Hotline', action_phone: '1800 250 015', action_url: null },
  'Tell one person': LIFELINE,
  'Screen your own mood honestly': { action_contact_name: 'Beyond Blue', action_phone: '1300 22 4636', action_url: 'https://www.beyondblue.org.au' },
};
const CALL = { action: 'call', action_provider_type: null, action_document_category: null, action_page: null };

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('reminder_rounds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('reminder_id').notNullable().references('id').inTable('reminders').onDelete('CASCADE');
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.timestamp('due_at', { useTz: true }).notNullable();
    t.timestamp('done_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('done_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.integer('sentiment').nullable();
    t.string('completion_reason', 100).nullable();
    t.string('completion_note', 240).nullable();
    t.timestamp('last_notified_at', { useTz: true }).nullable();
    t.uuid('ticked_item_id').nullable().references('id').inTable('checklist_items').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['reminder_id', 'done_at']);
    t.index(['care_profile_id']);
    t.index(['done_by_account_id']);
    t.index(['ticked_item_id']);
  });

  for (const table of ['journey_template_tasks', 'checklist_items']) {
    await knex.schema.alterTable(table, (t) => {
      t.string('action_url', 500).nullable();
    });
  }

  // Built-in journeys only: steps people wrote themselves are left as they made them.
  for (const [title, cols] of Object.entries(SWEPT)) {
    await knex('journey_template_tasks')
      .whereIn('template_phase_id', knex('journey_template_phases as p').join('journey_templates as j', 'p.template_id', 'j.id').where('j.is_system', true).select('p.id'))
      .where({ title })
      .update({ ...CALL, ...cols });
    await knex('checklist_items')
      .where({ title, is_custom: false })
      .whereIn(
        'care_journey_phase_id',
        knex('care_journey_phases as cp').join('care_journeys as cj', 'cp.care_journey_id', 'cj.id').join('journey_templates as j', 'cj.template_id', 'j.id').where('j.is_system', true).select('cp.id')
      )
      .update({ ...CALL, ...cols });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of ['checklist_items', 'journey_template_tasks']) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('action_url');
    });
  }
  await knex.schema.dropTable('reminder_rounds');
}
