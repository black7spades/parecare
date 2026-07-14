import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { getCareAccess } from '../middleware/subscriptionGate';
import type { Reminder } from '../types';

export const remindersRouter = Router({ mergeParams: true });

const reminderSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().optional().nullable(),
  reminder_type: z.enum(['once', 'daily', 'weekly', 'monthly']).default('once'),
  next_due_at: z.string().datetime(),
  rrule: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  desired_outcome: z.string().max(2000).optional().nullable(),
});

// The full task record. status filters to open, done or all (default open,
// so existing callers are unchanged); completed tasks carry when they were
// done and who did it, so nothing disappears when it is ticked off.
remindersRouter.get('/', requireAuth, async (req, res) => {
  const status = String(req.query['status'] ?? 'open');
  const query = db('reminders as r')
    .leftJoin('accounts as a', 'r.completed_by_account_id', 'a.id')
    .leftJoin('accounts as cl', 'r.claimed_by', 'cl.id')
    .where('r.care_profile_id', req.params['id'])
    .select('r.*', 'a.display_name as completed_by_name', 'cl.display_name as claimed_by_name');
  if (status === 'open') query.where('r.completed', false);
  else if (status === 'done') query.where('r.completed', true);
  const reminders = await query.orderBy('r.completed', 'asc').orderBy('r.next_due_at', 'asc');

  const reminderIds = reminders.map((r: { id: string }) => r.id);
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

  res.json({
    reminders: reminders.map((r: Record<string, unknown>) => ({
      ...r,
      co_owners: coOwnersByReminder.get(r.id as string) ?? [],
    })),
  });
});

remindersRouter.post('/', requireAuth, async (req, res) => {
  const parsed = reminderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const [reminder] = await db<Reminder>('reminders')
    .insert({ care_profile_id: req.params['id'], ...parsed.data })
    .returning('*');

  res.status(201).json({ reminder });
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
  const fanOutSchema = reminderSchema.extend({
    also_profile_ids: z.array(z.string().uuid()).default([]),
  });
  const parsed = fanOutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const sourceId = req.params['id'] as string;
  const { also_profile_ids, ...fields } = parsed.data;

  // Source first: access already verified by the profile-access middleware.
  const [sourceReminder] = await db<Reminder>('reminders')
    .insert({ care_profile_id: sourceId, ...fields })
    .returning('*');

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
    await db('reminders').insert({ care_profile_id: pid, ...fields, assigned_to: null });
    // The source write is audited by middleware; log each extra profile here.
    await db('audit_log')
      .insert({
        care_profile_id: pid,
        actor_account_id: req.account!.id,
        action: 'created',
        entity_type: 'reminders',
        summary: fields.title.slice(0, 255),
      })
      .catch(() => {});
    created.push({ profile_id: pid });
  }

  res.status(201).json({ reminder: sourceReminder, created, skipped });
});

remindersRouter.patch('/:reminderId', requireAuth, async (req, res) => {
  const parsed = reminderSchema.partial().extend({
    completed: z.boolean().optional(),
    sentiment: z.number().int().min(1).max(6).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.completed === true) {
    update['completed_at'] = db.fn.now();
    update['completed_by_account_id'] = req.account!.id;
  } else if (parsed.data.completed === false) {
    update['completed_at'] = null;
    update['completed_by_account_id'] = null;
    update['sentiment'] = null;
  }

  const [reminder] = await db<Reminder>('reminders')
    .where({ id: req.params['reminderId'], care_profile_id: req.params['id'] })
    .update(update)
    .returning('*');

  if (!reminder) {
    res.status(404).json({ error: 'Reminder not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ reminder });
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
  const scope = db('reminders').where({ care_profile_id: req.params['id'] }).whereIn('id', parsed.data.ids);
  if (parsed.data.action === 'delete') {
    const deleted = await scope.del();
    res.json({ deleted });
    return;
  }
  const completing = parsed.data.action === 'complete';
  const updated = await scope.update({
    completed: completing,
    completed_at: completing ? db.fn.now() : null,
    completed_by_account_id: completing ? req.account!.id : null,
  });
  res.json({ updated });
});

remindersRouter.delete('/:reminderId', requireAuth, async (req, res) => {
  const affected = await db('reminders')
    .where({ id: req.params['reminderId'], care_profile_id: req.params['id'] })
    .delete();
  if (!affected) {
    res.status(404).json({ error: 'Reminder not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Reminder deleted.' });
});
