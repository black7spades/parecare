import { Router } from 'express';
import { z } from 'zod';
import type { Knex } from 'knex';
import { db } from '../config/database';
import { rosterFor } from '../services/roster';
import { requireAuth } from '../middleware/auth';
import { getCareAccess } from '../middleware/subscriptionGate';
import {
  TaskProblem,
  contactProblem,
  createTask,
  enrichTasks,
  markTaskDone,
  mergeTasks,
  undoRound,
  type TaskRound,
  taskInputSchema,
  undoJoin,
  updateTask,
  type TaskListRow,
} from '../services/tasks';

export const remindersRouter = Router({ mergeParams: true });

const tzOf = (req: { account?: unknown }) => (req.account as { timezone?: string | null } | undefined)?.timezone ?? null;

function sendProblem(res: { status: (n: number) => { json: (b: unknown) => void } }, err: unknown): boolean {
  if (err instanceof TaskProblem) {
    res.status(400).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

const plainError = 'The task did not save. Check each box and try again.';

// The full task record. status filters to open, done or all (default open,
// so existing callers are unchanged); completed tasks carry when they were
// done and who did it, so nothing disappears when it is ticked off.
remindersRouter.get('/', requireAuth, async (req, res) => {
  const status = String(req.query['status'] ?? 'open');
  const profileId = String(req.params['id']);
  // The roster: the week's repeating tasks, by who does them, day by day.
  if (req.query['view'] === 'roster') {
    res.json({ roster: await rosterFor(db, profileId, typeof req.query['week'] === 'string' ? req.query['week'] : null) });
    return;
  }
  const query = db('reminders as r')
    .leftJoin('accounts as a', 'r.completed_by_account_id', 'a.id')
    .leftJoin('accounts as cl', 'r.claimed_by', 'cl.id')
    // A next step knows its kind and the appointment it came out of.
    .leftJoin('next_step_types as nst', 'r.next_step_type_id', 'nst.id')
    .leftJoin('appointments as ap', 'r.appointment_id', 'ap.id')
    .leftJoin('providers as pv', 'r.provider_id', 'pv.id')
    .leftJoin('reminders as mi', 'r.merged_into_id', 'mi.id')
    // An appointment waiting on this to-do for its date: doing the to-do
    // means adding that date.
    .leftJoin('appointments as tb', function () {
      this.on('tb.from_reminder_id', '=', 'r.id').andOnNull('tb.starts_at');
    })
    .where('r.care_profile_id', profileId)
    .select(
      'r.*', 'a.display_name as completed_by_name', 'cl.display_name as claimed_by_name',
      'nst.name as next_step_type_name', 'ap.title as appointment_title', 'ap.starts_at as appointment_starts_at',
      'tb.id as to_book_appointment_id', 'tb.title as to_book_title',
      'pv.name as provider_name', 'mi.title as merged_into_title'
    );
  if (status === 'open') query.where('r.completed', false);
  else if (status === 'done') query.where('r.completed', true);
  const reminders = (await query.orderBy('r.completed', 'asc').orderBy('r.next_due_at', 'asc')) as TaskListRow[];

  const reminderIds = reminders.map((r) => r.id);
  const coOwners = reminderIds.length > 0
    ? await db('task_co_owners as co')
        .join('accounts as acc', 'co.account_id', 'acc.id')
        .whereIn('co.reminder_id', reminderIds)
        .select('co.reminder_id', 'co.account_id as id', 'acc.display_name')
    : [];
  const coOwnersByReminder = new Map<string, Array<{ id: string; display_name: string }>>();
  for (const co of coOwners) {
    const arr = coOwnersByReminder.get(co.reminder_id) ?? [];
    arr.push({ id: co.id, display_name: co.display_name });
    coOwnersByReminder.set(co.reminder_id, arr);
  }
  const enriched = await enrichTasks(db, profileId, reminders);
  res.json({
    reminders: enriched.map((r) => ({
      ...r,
      merged_into_title: r['merged_into_title'] ?? null,
      co_owners: coOwnersByReminder.get(r.id) ?? [],
    })),
  });
});

/** One task, with everything the list shows for it. */
async function oneTask(profileId: string, id: string) {
  const row = (await db('reminders as r')
    .leftJoin('providers as pv', 'r.provider_id', 'pv.id')
    .where({ 'r.id': id, 'r.care_profile_id': profileId })
    .first('r.*', 'pv.name as provider_name')) as TaskListRow | undefined;
  if (!row) return null;
  const [t] = await enrichTasks(db, profileId, [row]);
  return t;
}

remindersRouter.post('/', requireAuth, async (req, res) => {
  const parsed = taskInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: plainError, code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const profileId = String(req.params['id']);
  try {
    const result = await db.transaction((trx) =>
      createTask(trx, { profileId, actorId: req.account!.id, input: parsed.data, timeZone: tzOf(req) })
    );
    res.status(201).json({
      reminder: await oneTask(profileId, result.reminder.id),
      joined_into: result.joined_into ?? null,
      filed: result.filed,
    });
  } catch (err) {
    if (!sendProblem(res, err)) throw err;
  }
});

/**
 * Create the same task on several profiles at once: the source profile plus
 * any others the requester can write to. A one-time copy, not a live link,
 * so each profile's task is thereafter its own. The assignee is a member of
 * the source profile's care circle and does not carry across, so copies are
 * left unassigned. Any target the requester cannot write to is skipped and
 * reported rather than failing the whole action.
 */
remindersRouter.post('/fan-out', requireAuth, async (req, res) => {
  const fanOutSchema = taskInputSchema.extend({
    also_profile_ids: z.array(z.string().uuid()).default([]),
  });
  const parsed = fanOutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: plainError, code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const sourceId = req.params['id'] as string;
  const { also_profile_ids, ...fields } = parsed.data;
  let source;
  try {
    source = await db.transaction((trx) => createTask(trx, { profileId: sourceId, actorId: req.account!.id, input: fields, timeZone: tzOf(req) }));
  } catch (err) {
    if (sendProblem(res, err)) return;
    throw err;
  }
  const providerId = (source.reminder['provider_id'] as string | null) ?? null;

  const created: Array<{ profile_id: string }> = [{ profile_id: sourceId }];
  const skipped: Array<{ profile_id: string; reason: 'no_access' | 'view_only' }> = [];

  const targets = [...new Set(also_profile_ids)].filter((id) => id !== sourceId);
  for (const pid of targets) {
    const access = await getCareAccess(req.account!, pid);
    if (!access) {
      skipped.push({ profile_id: pid, reason: 'no_access' });
      continue;
    }
    if (access.level === 'viewer') {
      skipped.push({ profile_id: pid, reason: 'view_only' });
      continue;
    }
    // The contact carries across only when it is linked to that person too;
    // conditions and documents belong to the source person.
    const contactThere = providerId && !(await contactProblem(db, pid, providerId)) ? providerId : null;
    const copy = await createTask(db, {
      profileId: pid,
      actorId: req.account!.id,
      timeZone: tzOf(req),
      input: {
        ...fields, provider_id: contactThere, provider_name: null, assigned_to: null, assigned_account_id: null,
        medical_condition_id: null, document_ids: [], no_join: true, next_step_type_id: (source.reminder['next_step_type_id'] as string | null) ?? null,
      },
    }).catch(() => null);
    if (!copy) {
      skipped.push({ profile_id: pid, reason: 'no_access' });
      continue;
    }
    // The source write is audited by middleware; log each extra profile here.
    await db('audit_log')
      .insert({
        care_profile_id: pid,
        actor_account_id: req.account!.id,
        action: 'created',
        entity_type: 'reminders',
        entity_id: copy.reminder.id,
        summary: fields.title.slice(0, 255),
      })
      .catch(() => {});
    created.push({ profile_id: pid });
  }

  res.status(201).json({ reminder: source.reminder, joined_into: source.joined_into ?? null, filed: source.filed, created, skipped });
});

remindersRouter.patch('/:reminderId', requireAuth, async (req, res) => {
  const parsed = taskInputSchema.partial().extend({
    completed: z.boolean().optional(),
    sentiment: z.number().int().min(1).max(6).optional().nullable(),
    completion_reason: z.string().max(100).optional().nullable(),
    completion_note: z.string().max(240).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: plainError, code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  const taskId = String(req.params['reminderId']);
  const { completed, sentiment, completion_reason, completion_note, ...edits } = parsed.data;

  try {
    const done = await db.transaction(async (trx) => {
      const exists = await trx('reminders').where({ id: taskId, care_profile_id: profileId }).first('id');
      if (!exists) return null;
      const edited = Object.values(edits).some((v) => v !== undefined);
      const result = edited ? await updateTask(trx, { profileId, taskId, input: edits, timeZone: tzOf(req) }) : { filed: [] };
      const update: Record<string, unknown> = {};
      let round: TaskRound | null = null;
      // Ticking off goes through the one place every screen and Pare uses: a
      // repeating task is done for this round and comes round again.
      const open = completed === true ? await trx('reminders').where({ id: taskId, completed: false }).first('id') : null;
      if (open) {
        const done = await markTaskDone(trx, { profileId, taskId, actorId: req.account!.id, sentiment, completion_reason, completion_note });
        round = done?.round ?? null;
      } else {
        if (sentiment !== undefined) update['sentiment'] = sentiment;
        if (completion_reason !== undefined) update['completion_reason'] = completion_reason;
        if (completion_note !== undefined) update['completion_note'] = completion_note;
      }
      // A person reopening a task makes it theirs again: clearing a date of
      // death later leaves it as they set it.
      if (completed === false) {
        update['completed'] = false;
        update['stopped_by_death_at'] = null;
        update['completed_at'] = null;
        update['completed_by_account_id'] = null;
        update['sentiment'] = null;
        update['completion_reason'] = null;
        update['completion_note'] = null;
        update['merged_into_id'] = null;
      }
      if (Object.keys(update).length) await trx('reminders').where({ id: taskId }).update(update);
      return { ...result, round };
    });
    if (!done) {
      res.status(404).json({ error: 'Task not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ reminder: await oneTask(profileId, taskId), filed: done.filed, round: done.round });
  } catch (err) {
    if (!sendProblem(res, err)) throw err;
  }
});

/** Join this task into another open task doing the same booking. */
remindersRouter.post('/:reminderId/join', requireAuth, async (req, res) => {
  const parsed = z.object({ into: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which task to join it with.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  const result = await db.transaction((trx) =>
    mergeTasks(trx, { profileId, fromId: String(req.params['reminderId']), intoId: parsed.data.into, actorId: req.account!.id })
  );
  if (!result) {
    res.status(404).json({ error: 'One of those tasks could not be found. Refresh and try again.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ reminder: await oneTask(profileId, result.into) });
});

/**
 * "Keep them separate": put the task back as it was before a new one joined
 * it, then add the new one on its own.
 */
remindersRouter.post('/:reminderId/separate', requireAuth, async (req, res) => {
  const parsed = z
    .object({
      // Only what a join can change, each checked.
      previous: z
        .object({
          provider_id: z.string().uuid().nullable().optional(),
          next_step_type_id: z.string().uuid().nullable().optional(),
          medical_condition_id: z.string().uuid().nullable().optional(),
          appointment_id: z.string().uuid().nullable().optional(),
          next_due_at: z.coerce.date().optional(),
          all_day: z.boolean().optional(),
        })
        .strict()
        .default({}),
      note_id: z.string().uuid().optional().nullable(),
      document_ids: z.array(z.string().uuid()).max(50).default([]),
      create: taskInputSchema,
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: plainError, code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  const taskId = String(req.params['reminderId']);
  try {
    const result = await db.transaction(async (trx) => {
      const exists = await trx('reminders').where({ id: taskId, care_profile_id: profileId }).first('id');
      if (!exists) return null;
      const prev = parsed.data.previous;
      const problem = await contactProblem(trx, profileId, prev.provider_id);
      if (problem) throw new TaskProblem(problem);
      const own = async (table: string, id: string | null | undefined) =>
        !id || !!(await trx(table).where({ id, care_profile_id: profileId }).first('id'));
      if (!(await own('medical_conditions', prev.medical_condition_id)) || !(await own('appointments', prev.appointment_id))) {
        throw new TaskProblem('That task could not be put back as it was. Refresh and try again.');
      }
      await undoJoin(trx, profileId, { id: taskId, previous: parsed.data.previous, note_id: parsed.data.note_id, document_ids: parsed.data.document_ids });
      return createTask(trx, { profileId, actorId: req.account!.id, input: { ...parsed.data.create, no_join: true }, timeZone: tzOf(req) });
    });
    if (!result) {
      res.status(404).json({ error: 'Task not found', code: 'NOT_FOUND' });
      return;
    }
    await db('audit_log').insert({
      care_profile_id: profileId, actor_account_id: req.account!.id, action: 'created', entity_type: 'reminders',
      entity_id: result.reminder.id, summary: result.reminder.title.slice(0, 255), source: 'person',
    }).catch(() => {});
    res.status(201).json({ reminder: await oneTask(profileId, result.reminder.id), filed: result.filed });
  } catch (err) {
    if (!sendProblem(res, err)) throw err;
  }
});

remindersRouter.post('/:reminderId/claim', requireAuth, async (req, res) => {
  const updated = await db('reminders')
    .where({ id: req.params['reminderId'], care_profile_id: req.params['id'] })
    .whereNull('claimed_by')
    .update({ claimed_by: req.account!.id, claimed_at: db.fn.now() });

  if (!updated) {
    const existing = await db('reminders as r')
      .leftJoin('accounts as a', 'r.claimed_by', 'a.id')
      .where({ 'r.id': req.params['reminderId'], 'r.care_profile_id': req.params['id'] })
      .select('r.claimed_by', 'r.claimed_at', 'a.display_name as claimed_by_name')
      .first();
    if (!existing) {
      res.status(404).json({ error: 'Task not found', code: 'NOT_FOUND' });
      return;
    }
    res.status(409).json({
      error: 'Task already claimed',
      code: 'ALREADY_CLAIMED',
      claimed_by: existing.claimed_by,
      claimed_by_name: existing.claimed_by_name,
      claimed_at: existing.claimed_at,
    });
    return;
  }
  res.json({ message: 'Task claimed.' });
});

remindersRouter.delete('/:reminderId/claim', requireAuth, async (req, res) => {
  const updated = await db('reminders')
    .where({ id: req.params['reminderId'], care_profile_id: req.params['id'] })
    .where((qb) => {
      qb.where('claimed_by', req.account!.id);
    })
    .update({ claimed_by: null, claimed_at: null });

  if (!updated) {
    res.status(404).json({ error: 'Task not found or not claimed by you', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Claim released.' });
});

const coOwnersSchema = z.object({
  account_ids: z.array(z.string().uuid()).max(50),
});

remindersRouter.put('/:reminderId/co-owners', requireAuth, async (req, res) => {
  const parsed = coOwnersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const reminderId = req.params['reminderId'];
  const exists = await db('reminders')
    .where({ id: reminderId, care_profile_id: req.params['id'] })
    .first();
  if (!exists) {
    res.status(404).json({ error: 'Task not found', code: 'NOT_FOUND' });
    return;
  }

  await db('task_co_owners').where({ reminder_id: reminderId }).del();
  if (parsed.data.account_ids.length > 0) {
    await db('task_co_owners').insert(
      parsed.data.account_ids.map((accountId) => ({
        reminder_id: reminderId,
        account_id: accountId,
      }))
    );
  }

  const coOwners = await db('task_co_owners as co')
    .join('accounts as acc', 'co.account_id', 'acc.id')
    .where('co.reminder_id', reminderId)
    .select('co.account_id as id', 'acc.display_name');

  res.json({ co_owners: coOwners });
});

// Complete, reopen or delete several tasks at once, scoped to this profile.
const bulkSchema = z.object({
  action: z.enum(['complete', 'reopen', 'delete']),
  ids: z.array(z.string().uuid()).min(1).max(500),
});

remindersRouter.post('/bulk', requireAuth, async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  const scope = () => db('reminders').where({ care_profile_id: profileId }).whereIn('id', parsed.data.ids);
  if (parsed.data.action === 'delete') {
    const ids = (await scope().pluck('id')) as string[];
    const deleted = await db.transaction(async (trx) => {
      await forgetTasks(trx, profileId, ids);
      return trx('reminders').whereIn('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).del();
    });
    res.json({ deleted });
    return;
  }
  const completing = parsed.data.action === 'complete';
  // A to-do waiting on an appointment's date is done by booking it, so
  // ticking it off in bulk leaves it open, the same as ticking it alone.
  const waiting = completing
    ? ((await db('reminders as r')
        .join('appointments as a', function () {
          this.on('a.from_reminder_id', '=', 'r.id').andOnNull('a.starts_at');
        })
        .where('r.care_profile_id', profileId)
        .where('r.completed', false)
        .whereIn('r.id', parsed.data.ids)
        .select('r.id', 'r.title', 'a.id as appointment_id')) as Array<{ id: string; title: string; appointment_id: string }>)
    : [];
  const skip = new Set(waiting.map((w) => w.id));
  const ids = parsed.data.ids.filter((id) => !skip.has(id));
  if (completing) {
    // Each one through the same tick as the checkbox: repeating ones move on a round.
    const rounds: TaskRound[] = [];
    let updated = 0;
    await db.transaction(async (trx) => {
      for (const id of ids) {
        const done = await markTaskDone(trx, { profileId, taskId: id, actorId: req.account!.id });
        if (!done) continue;
        updated++;
        if (done.round) rounds.push(done.round);
      }
    });
    res.json({ updated, waiting, rounds });
    return;
  }
  const updated = ids.length
    ? await db('reminders').where({ care_profile_id: profileId }).whereIn('id', ids).update({
        completed: false,
        completed_at: null,
        completed_by_account_id: null,
        merged_into_id: null,
      })
    : 0;
  res.json({ updated, waiting });
});

/** Undo "done for this round": the task is due when it was, and its step opens again. */
remindersRouter.post('/:reminderId/rounds/:roundId/undo', requireAuth, async (req, res) => {
  const profileId = String(req.params['id']);
  const ok = await db.transaction((trx) => undoRound(trx, { profileId, taskId: String(req.params['reminderId']), roundId: String(req.params['roundId']) }));
  if (!ok) {
    res.status(404).json({ error: 'That was already undone, or the task has gone. Refresh to see where it is now.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ reminder: await oneTask(profileId, String(req.params['reminderId'])) });
});

/**
 * What goes with a deleted task: its notes and document links, and a
 * night-before reminder someone deleted is not made again.
 */
async function forgetTasks(trx: Knex.Transaction, profileId: string, ids: string[]) {
  if (ids.length === 0) return;
  await trx('appointments').where({ care_profile_id: profileId }).whereIn('preparation_task_id', ids).update({ preparation_reminder_off: true });
  await trx('record_notes').where({ care_profile_id: profileId, entity_type: 'reminders' }).whereIn('entity_id', ids).delete();
  await trx('document_links').where({ entity_type: 'reminders' }).whereIn('entity_id', ids).delete();
}

remindersRouter.delete('/:reminderId', requireAuth, async (req, res) => {
  const profileId = String(req.params['id']);
  const affected: number = await db.transaction(async (trx): Promise<number> => {
    const ids = (await trx('reminders').where({ id: req.params['reminderId'], care_profile_id: profileId }).pluck('id')) as string[];
    await forgetTasks(trx, profileId, ids);
    return (await trx('reminders').whereIn('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).delete()) as number;
  });
  if (!affected) {
    res.status(404).json({ error: 'Reminder not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Reminder deleted.' });
});
