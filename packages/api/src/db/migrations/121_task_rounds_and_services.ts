import type { Knex } from 'knex';
import { journeyItemAction } from '../journeys/itemActions';

/**
 * 1. Rounds of a repeating task. Ticking a repeating task, from any screen
 *    or by Pare, keeps a record of that round (when it was due, who did it,
 *    how it went, and the journey step it ticked) and moves the task on to
 *    its next date. The record is what Undo puts back.
 * 2. Journey steps can carry a service's website beside its number.
 * 3. The national services sweep: steps whose next move is to contact My
 *    Aged Care, Services Australia, the NDIS, Carer Gateway, Dementia
 *    Australia, Quitline, Lifeline and the like get the number to call and
 *    the website, on the templates and on every journey under way.
 */
const SWEPT = [
  'Register with the carer gateway',
  'Register with dementia support services',
  'Contact My Aged Care for an assessment',
  'Research residential care options',
  'Request a financial assessment',
  'Bring in help before the crisis',
  'Get feeding support early if it hurts or worries you',
  'Watch how the parents are doing',
  'Ask about early support while you wait',
  'Apply for funding support',
  'Say it out loud with someone safe',
  'Choose a program built for young people',
  'Commit to the program',
  'Tell one person',
  'Choose your aids before day one',
  'Screen your own mood honestly',
];

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

  const tasks = (await knex('journey_template_tasks as t')
    .join('journey_template_phases as p', 't.template_phase_id', 'p.id')
    .join('journey_templates as j', 'p.template_id', 'j.id')
    .whereIn('t.title', SWEPT)
    .where('j.is_system', true)
    .select('t.id', 't.title', 't.description', 't.is_milestone', 'j.slug')) as Array<{
    id: string; title: string; description: string | null; is_milestone: boolean; slug: string | null;
  }>;
  for (const t of tasks) await knex('journey_template_tasks').where({ id: t.id }).update(journeyItemAction(t, t.slug));

  const items = (await knex('checklist_items as ci')
    .leftJoin('care_journey_phases as cp', 'ci.care_journey_phase_id', 'cp.id')
    .leftJoin('care_journeys as cj', 'cp.care_journey_id', 'cj.id')
    .leftJoin('journey_templates as j', 'cj.template_id', 'j.id')
    .whereIn('ci.title', SWEPT)
    .select('ci.id', 'ci.title', 'ci.description', 'ci.is_milestone', 'j.slug')) as Array<{
    id: string; title: string; description: string | null; is_milestone: boolean; slug: string | null;
  }>;
  for (const i of items) await knex('checklist_items').where({ id: i.id }).update(journeyItemAction(i, i.slug));
}

export async function down(knex: Knex): Promise<void> {
  for (const table of ['checklist_items', 'journey_template_tasks']) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('action_url');
    });
  }
  await knex.schema.dropTable('reminder_rounds');
}
