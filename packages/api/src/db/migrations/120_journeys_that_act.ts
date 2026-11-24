import type { Knex } from 'knex';
import { journeyItemAction as currentAction } from '../journeys/itemActions';

// The columns this migration made; the website column comes in 121.
const journeyItemAction = (...args: Parameters<typeof currentAction>) => {
  const { action_url: _url, ...cols } = currentAction(...args);
  void _url;
  return cols;
};

/**
 * Journeys that act. Each journey item knows what doing it means: book it,
 * add it as a task, upload the paper, call a number, add the record it is
 * about (equipment, a hospital stay, a move into care, a funding plan, a
 * test result) or open the page it happens on.
 *
 * 1. Template tasks and journey items carry the action, who to book or
 *    call, a contact name and phone, the document category for an upload
 *    and the page to open. Template tasks also carry how many days after
 *    the phase starts it is due and how it repeats; items copy both.
 * 2. A journey item remembers the appointment booked from it and the
 *    record added from it.
 * 3. A task can belong to one journey item. Ticking the task ticks the
 *    item, whichever way the task is ticked: by hand, in bulk, by booking
 *    the appointment it waits on, or by Pare. The screen ticks the task
 *    when the item is ticked.
 *
 * Backfill: every template task and every journey item already under way
 * gets its action from the journeys sweep, or worked out from its words.
 */
const ACTION_COLUMNS = (t: Knex.AlterTableBuilder) => {
  t.string('action', 20).nullable();
  t.string('action_provider_type', 100).nullable();
  t.string('action_contact_name', 255).nullable();
  t.string('action_phone', 50).nullable();
  t.string('action_document_category', 100).nullable();
  t.string('action_page', 40).nullable();
  t.integer('due_in_days').nullable();
  t.string('repeat_rrule', 255).nullable();
};

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('journey_template_tasks', ACTION_COLUMNS);
  await knex.schema.alterTable('checklist_items', (t) => {
    ACTION_COLUMNS(t);
    t.uuid('appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.string('linked_record_kind', 30).nullable();
    t.uuid('linked_record_id').nullable();
    t.index(['appointment_id']);
  });
  await knex.schema.alterTable('reminders', (t) => {
    t.uuid('checklist_item_id').nullable().references('id').inTable('checklist_items').onDelete('SET NULL');
  });
  // One task per journey item.
  await knex.raw('CREATE UNIQUE INDEX reminders_checklist_item_id_unique ON reminders (checklist_item_id) WHERE checklist_item_id IS NOT NULL');

  // Ticking a task ticks its journey item, and reopening it reopens the
  // item. A task stopped by a death or joined into another is not done.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION journey_item_follows_task() RETURNS trigger AS $$
    BEGIN
      IF NEW.checklist_item_id IS NULL OR NEW.completed IS NOT DISTINCT FROM OLD.completed THEN
        RETURN NEW;
      END IF;
      IF NEW.completed AND (NEW.stopped_by_death_at IS NOT NULL OR NEW.merged_into_id IS NOT NULL) THEN
        RETURN NEW;
      END IF;
      UPDATE checklist_items ci SET
        completed = NEW.completed,
        completed_at = CASE WHEN NEW.completed THEN coalesce(NEW.completed_at, now()) ELSE NULL END,
        achieved_on = CASE WHEN NEW.completed THEN coalesce(ci.achieved_on, current_date) ELSE NULL END,
        completed_by = CASE WHEN NEW.completed THEN (
          SELECT m.id FROM care_circle_members m
          WHERE m.care_profile_id = ci.care_profile_id AND m.account_id = NEW.completed_by_account_id AND m.invite_accepted
          LIMIT 1
        ) ELSE NULL END
      WHERE ci.id = NEW.checklist_item_id AND ci.completed IS DISTINCT FROM NEW.completed;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql;
  `);
  await knex.raw(`
    CREATE TRIGGER reminders_tick_journey_item
    AFTER UPDATE OF completed ON reminders
    FOR EACH ROW EXECUTE FUNCTION journey_item_follows_task();
  `);

  // ------------------------------------------------------------ backfill
  const tasks = (await knex('journey_template_tasks as t')
    .join('journey_template_phases as p', 't.template_phase_id', 'p.id')
    .join('journey_templates as j', 'p.template_id', 'j.id')
    .select('t.id', 't.title', 't.description', 't.is_milestone', 'j.slug')) as Array<{
    id: string; title: string; description: string | null; is_milestone: boolean; slug: string | null;
  }>;
  for (const t of tasks) {
    await knex('journey_template_tasks').where({ id: t.id }).update(journeyItemAction(t, t.slug));
  }

  const items = (await knex('checklist_items as ci')
    .leftJoin('care_journey_phases as cp', 'ci.care_journey_phase_id', 'cp.id')
    .leftJoin('care_journeys as cj', 'cp.care_journey_id', 'cj.id')
    .leftJoin('journey_templates as j', 'cj.template_id', 'j.id')
    .select('ci.id', 'ci.title', 'ci.description', 'ci.is_milestone', 'j.slug')) as Array<{
    id: string; title: string; description: string | null; is_milestone: boolean; slug: string | null;
  }>;
  for (const i of items) {
    await knex('checklist_items').where({ id: i.id }).update(journeyItemAction(i, i.slug));
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS reminders_tick_journey_item ON reminders');
  await knex.raw('DROP FUNCTION IF EXISTS journey_item_follows_task()');
  await knex.raw('DROP INDEX IF EXISTS reminders_checklist_item_id_unique');
  await knex.schema.alterTable('reminders', (t) => {
    t.dropColumn('checklist_item_id');
  });
  await knex.schema.alterTable('checklist_items', (t) => {
    t.dropIndex(['appointment_id']);
    t.dropColumn('appointment_id');
    t.dropColumn('linked_record_kind');
    t.dropColumn('linked_record_id');
  });
  for (const table of ['checklist_items', 'journey_template_tasks']) {
    await knex.schema.alterTable(table, (t) => {
      for (const c of ['action', 'action_provider_type', 'action_contact_name', 'action_phone', 'action_document_category', 'action_page', 'due_in_days', 'repeat_rrule']) t.dropColumn(c);
    });
  }
}
