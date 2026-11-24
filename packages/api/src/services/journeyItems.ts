import type { Knex } from 'knex';
import { z } from 'zod';
import { journeyItemAction } from '../db/journeys/itemActions';
import { actionColumnsOf, type ItemAction } from '../lib/journeyActions';
import { REPEAT_CHOICE_VALUES, repeatChoice, repeatColumns, type RepeatChoice } from '../lib/repeat';
import { mainContact, type ContactSummary } from './professionals';
import { recordLabel, type AttachedTo } from './recordLabels';
import { createTask, markTaskDone, undoRound, updateTask } from './tasks';

type Conn = Knex | Knex.Transaction;

/**
 * Journey items that act. An item's task carries its due date, who is
 * doing it and how it repeats, so reminders work the same as any task. A
 * booking, an upload or a record added from an item ticks it, and ticking
 * an item ticks its task (the database ticks the item when the task is
 * ticked, see migration 120).
 */

export const journeyItemRef = z.string().uuid().optional().nullable();

/** The journey item rows a template phase starts with. */
export function itemRowsFromTemplate(
  tasks: Array<Record<string, unknown> & { title: string; description: string | null; is_milestone: boolean; sort_order: number }>,
  base: { care_profile_id: string; care_journey_phase_id: string; phase: string | null },
) {
  return tasks.map((task) => ({
    ...base,
    title: task.title,
    description: task.description,
    is_milestone: task.is_milestone,
    sort_order: task.sort_order,
    ...actionColumnsOf(task),
  }));
}

/** The action a person's own new item gets, from its words. */
export const actionForNewItem = (item: { title: string; description?: string | null; is_milestone?: boolean }): ItemAction => journeyItemAction(item);

/** An item that belongs to this person, or nothing. */
export async function itemFor(conn: Conn, profileId: string, itemId: string | null | undefined) {
  if (!itemId) return null;
  return ((await conn('checklist_items').where({ id: itemId, care_profile_id: profileId }).first()) as (Record<string, unknown> & { id: string; title: string; completed: boolean }) | undefined) ?? null;
}

/** The open item on a current journey phase with this title, for Pare. */
export async function itemByTitle(conn: Conn, profileId: string, title: string | null | undefined): Promise<string | null> {
  const t = title?.trim();
  if (!t) return null;
  const rows = (await conn('checklist_items as ci')
    .join('care_journey_phases as p', 'ci.care_journey_phase_id', 'p.id')
    .join('care_journeys as j', 'p.care_journey_id', 'j.id')
    .where('ci.care_profile_id', profileId)
    .whereIn('j.status', ['active', 'paused'])
    .whereNotNull('p.entered_at')
    .whereNull('p.locked_at')
    .select('ci.id', 'ci.title', 'ci.completed')) as Array<{ id: string; title: string; completed: boolean }>;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const want = norm(t);
  const exact = rows.find((r) => norm(r.title) === want && !r.completed) ?? rows.find((r) => norm(r.title) === want);
  if (exact) return exact.id;
  const near = rows.filter((r) => !r.completed && (norm(r.title).includes(want) || want.includes(norm(r.title))));
  return near.length === 1 ? near[0]!.id : null;
}

async function memberIdFor(conn: Conn, profileId: string, accountId: string | null): Promise<string | null> {
  if (!accountId) return null;
  const m = (await conn('care_circle_members').where({ care_profile_id: profileId, account_id: accountId, invite_accepted: true }).first('id')) as { id: string } | undefined;
  return m?.id ?? null;
}

/**
 * Tick an item (or untick it) and its task with it. A record added from the
 * item is remembered so the item can say what was added.
 */
export async function setItemDone(
  conn: Conn,
  opts: {
    profileId: string;
    itemId: string;
    actorId: string | null;
    completed: boolean;
    record?: { kind: string; id: string } | null;
    achievedOn?: string | null;
    /** A task the caller has already finished, so a repeating one is not moved on twice. */
    taskHandled?: string | null;
  },
): Promise<void> {
  const item = await itemFor(conn, opts.profileId, opts.itemId);
  if (!item) return;
  const update: Record<string, unknown> = {};
  if (opts.record) {
    update['linked_record_kind'] = opts.record.kind;
    update['linked_record_id'] = opts.record.id;
  }
  if (opts.completed && !item.completed) {
    update['completed'] = true;
    update['completed_at'] = new Date();
    update['achieved_on'] = opts.achievedOn ?? new Date().toISOString().slice(0, 10);
    update['completed_by'] = await memberIdFor(conn, opts.profileId, opts.actorId);
  } else if (!opts.completed && item.completed) {
    Object.assign(update, { completed: false, completed_at: null, completed_by: null, achieved_on: null });
  }
  if (Object.keys(update).length) await conn('checklist_items').where({ id: item.id }).update(update);
  // The item's own task follows it. A repeating task comes round again.
  const task = (await conn('reminders').where({ checklist_item_id: item.id, care_profile_id: opts.profileId }).first('id', 'completed', 'merged_into_id')) as
    | { id: string; completed: boolean; merged_into_id: string | null }
    | undefined;
  if (!task) return;
  if (opts.completed && !task.completed && task.id !== opts.taskHandled) {
    await markTaskDone(conn, { profileId: opts.profileId, taskId: task.id, actorId: opts.actorId, fromItemId: item.id });
  } else if (!opts.completed && !task.completed) {
    // A repeating task this step moved on a round goes back to when it was due.
    const round = (await conn('reminder_rounds').where({ reminder_id: task.id, ticked_item_id: item.id }).orderBy('done_at', 'desc').first('id')) as { id: string } | undefined;
    if (round) await undoRound(conn, { profileId: opts.profileId, taskId: task.id, roundId: round.id });
  } else if (!opts.completed && task.completed && !task.merged_into_id) {
    // Unticking reopens a task the step closed, never one joined into another
    // or a booking to-do whose appointment already has its date.
    const booked = await conn('appointments').where({ care_profile_id: opts.profileId, from_reminder_id: task.id }).whereNotNull('starts_at').first('id');
    if (!booked) {
      await conn('reminders').where({ id: task.id }).update({ completed: false, completed_at: null, completed_by_account_id: null });
    }
  }
}

/** Something was done from an item: a booking with a date, an upload, a record. */
export async function doneFromItem(
  conn: Conn,
  opts: { profileId: string; itemId: string | null | undefined; actorId: string | null; record?: { kind: string; id: string } | null; taskHandled?: string | null },
) {
  if (!opts.itemId) return;
  await setItemDone(conn, { profileId: opts.profileId, itemId: opts.itemId, actorId: opts.actorId, completed: true, record: opts.record ?? null, taskHandled: opts.taskHandled });
}

export const itemTaskSchema = z.object({
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  next_due_at: z.string().datetime().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  assigned_account_id: z.string().uuid().optional().nullable(),
  repeat: z.enum(REPEAT_CHOICE_VALUES).optional(),
  tz: z.string().max(64).optional().nullable(),
});
export type ItemTaskInput = z.infer<typeof itemTaskSchema>;

/** The day an item is due by default: the days after its phase began, else a week from today. */
export function defaultDueOn(dueInDays: number | null | undefined, phaseEnteredAt: Date | string | null | undefined, today = new Date()): string {
  const start = phaseEnteredAt ? new Date(phaseEnteredAt) : today;
  const days = dueInDays ?? 7;
  let at = new Date(start.getTime() + days * 86400000);
  // A default already past is moved to a week from today.
  if (at.getTime() < today.getTime()) at = new Date(today.getTime() + 7 * 86400000);
  return at.toISOString().slice(0, 10);
}

/**
 * Give an item a task, or change the one it has: when it is due, who is
 * doing it and how it repeats. The task is the item's title and words, and
 * who it is with when the item names the kind of person.
 */
export async function setItemTask(
  conn: Conn,
  opts: { profileId: string; itemId: string; actorId: string; input: ItemTaskInput; timeZone?: string | null },
): Promise<{ task_id: string } | null> {
  const item = (await conn('checklist_items as ci')
    .leftJoin('care_journey_phases as p', 'ci.care_journey_phase_id', 'p.id')
    .where({ 'ci.id': opts.itemId, 'ci.care_profile_id': opts.profileId })
    .first('ci.*', 'p.entered_at as phase_entered_at')) as (Record<string, unknown> & { id: string; title: string; description: string | null }) | undefined;
  if (!item) return null;
  const existing = (await conn('reminders').where({ checklist_item_id: item.id, care_profile_id: opts.profileId }).first('id')) as { id: string } | undefined;
  const repeat: RepeatChoice | undefined = opts.input.repeat ?? (existing ? undefined : repeatChoice({ rrule: item['repeat_rrule'] as string | null }));
  const due = opts.input.due_on || opts.input.next_due_at
    ? { due_on: opts.input.due_on ?? null, next_due_at: opts.input.next_due_at ?? null }
    : existing
      ? {}
      : { due_on: defaultDueOn(item['due_in_days'] as number | null, item['phase_entered_at'] as Date | null) };
  const assign = opts.input.assigned_to !== undefined || opts.input.assigned_account_id !== undefined
    ? { assigned_to: opts.input.assigned_to ?? null, assigned_account_id: opts.input.assigned_account_id ?? null }
    : {};
  if (existing) {
    await updateTask(conn, { profileId: opts.profileId, taskId: existing.id, input: { ...due, ...assign, ...(repeat ? { repeat } : {}), tz: opts.input.tz }, timeZone: opts.timeZone });
    return { task_id: existing.id };
  }
  const contact = item['action_provider_type'] ? await mainContact(conn, opts.profileId, String(item['action_provider_type'])) : null;
  const made = await createTask(conn, {
    profileId: opts.profileId,
    actorId: opts.actorId,
    timeZone: opts.timeZone,
    input: {
      title: item.title,
      body: item.description,
      ...due,
      ...assign,
      repeat,
      tz: opts.input.tz,
      provider_id: contact?.id ?? null,
      checklist_item_id: item.id,
      // The step's own task, never joined into another step's.
      no_join: true,
    },
  });
  // Joined into a task already open for the same booking: that task is this item's now.
  const taskId = made.joined_into?.id ?? made.reminder.id;
  await conn('reminders').where({ id: taskId }).whereNull('checklist_item_id').update({ checklist_item_id: item.id });
  return { task_id: taskId };
}

export interface ItemOut extends Record<string, unknown> {
  id: string;
}

/**
 * Everything an item row shows: its task (due, who is doing it, repeats),
 * the appointment booked from it, documents uploaded to it, the record added
 * from it, and who to book or call.
 */
export async function itemsOut(conn: Conn, profileId: string, items: Array<Record<string, unknown> & { id: string }>): Promise<ItemOut[]> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const [tasks, appts, docs, phases] = await Promise.all([
    conn('reminders as r')
      .leftJoin('care_circle_members as m', 'r.assigned_to', 'm.id')
      .leftJoin('accounts as a', 'r.assigned_account_id', 'a.id')
      .where('r.care_profile_id', profileId)
      .whereIn('r.checklist_item_id', ids)
      .select(
        'r.id', 'r.title', 'r.checklist_item_id', 'r.next_due_at', 'r.all_day', 'r.completed', 'r.rrule', 'r.reminder_type', 'r.assigned_to', 'r.assigned_account_id',
        'm.display_name as member_name', 'a.display_name as account_name',
        conn.raw('(select max(rr.done_at) from reminder_rounds rr where rr.reminder_id = r.id) as last_done_at'),
      ),
    conn('appointments')
      .where({ care_profile_id: profileId })
      .whereIn('id', items.map((i) => i['appointment_id']).filter(Boolean) as string[])
      .select('id', 'title', 'starts_at', 'all_day', 'status'),
    conn('document_links as l')
      .join('documents as d', 'l.document_id', 'd.id')
      .where({ 'l.entity_type': 'checklists', 'd.care_profile_id': profileId })
      .whereIn('l.entity_id', ids)
      .orderBy('d.created_at', 'asc')
      .select('l.entity_id', 'd.id', 'd.label'),
    conn('care_journey_phases').whereIn('id', items.map((i) => i['care_journey_phase_id']).filter(Boolean) as string[]).select('id', 'entered_at'),
  ]);
  const taskByItem = new Map((tasks as Array<Record<string, unknown> & { checklist_item_id: string }>).map((t) => [t.checklist_item_id, t]));
  const apptById = new Map((appts as Array<Record<string, unknown> & { id: string }>).map((a) => [a.id, a]));
  const docsByItem = new Map<string, Array<{ id: string; label: string }>>();
  for (const d of docs as Array<{ entity_id: string; id: string; label: string }>) {
    const list = docsByItem.get(d.entity_id) ?? [];
    list.push({ id: d.id, label: d.label });
    docsByItem.set(d.entity_id, list);
  }
  const phaseStart = new Map((phases as Array<{ id: string; entered_at: Date | null }>).map((p) => [p.id, p.entered_at]));
  // Who to book or call, by kind, looked up once each.
  const contactByType = new Map<string, ContactSummary | null>();
  for (const i of items) {
    const type = i['action_provider_type'] as string | null;
    if (type && (i['action'] === 'book' || i['action'] === 'call') && !contactByType.has(type)) {
      contactByType.set(type, await mainContact(conn, profileId, type));
    }
  }
  const out: ItemOut[] = [];
  for (const i of items) {
    const t = taskByItem.get(i.id);
    const a = i['appointment_id'] ? apptById.get(i['appointment_id'] as string) : undefined;
    let linked: AttachedTo | null = null;
    if (i['linked_record_kind'] && i['linked_record_id']) linked = await recordLabel(conn, profileId, String(i['linked_record_kind']), String(i['linked_record_id']));
    const type = i['action_provider_type'] as string | null;
    out.push({
      ...i,
      repeat: repeatChoice({ rrule: i['repeat_rrule'] as string | null }),
      default_due_on: defaultDueOn(i['due_in_days'] as number | null, i['care_journey_phase_id'] ? phaseStart.get(i['care_journey_phase_id'] as string) : null),
      task: t
        ? {
            id: t['id'],
            title: t['title'],
            next_due_at: t['next_due_at'],
            all_day: t['all_day'],
            completed: t['completed'],
            repeat: repeatChoice(t as { rrule?: string | null; reminder_type?: string | null }),
            assigned_to: t['assigned_to'],
            assigned_account_id: t['assigned_account_id'],
            assigned_name: (t['account_name'] as string | null) ?? (t['member_name'] as string | null) ?? null,
            last_done_at: t['last_done_at'] ?? null,
          }
        : null,
      appointment: a ? { id: a['id'], title: a['title'], starts_at: a['starts_at'], all_day: a['all_day'], status: a['status'] } : null,
      documents: docsByItem.get(i.id) ?? [],
      linked_record: linked,
      action_contact: type ? contactByType.get(type) ?? null : null,
    });
  }
  return out;
}

/** The repeat rule a template task stores for a repeat choice. */
export const repeatRule = (choice: RepeatChoice | null | undefined): string | null => (choice ? repeatColumns(choice).rrule : null);
