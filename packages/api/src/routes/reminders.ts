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
});

remindersRouter.get('/', requireAuth, async (req, res) => {
  const reminders = await db<Reminder>('reminders')
    .where({ care_profile_id: req.params['id'], completed: false })
    .orderBy('next_due_at', 'asc');
  res.json({ reminders });
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
  const parsed = reminderSchema.partial().extend({ completed: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [reminder] = await db<Reminder>('reminders')
    .where({ id: req.params['reminderId'], care_profile_id: req.params['id'] })
    .update(parsed.data)
    .returning('*');

  if (!reminder) {
    res.status(404).json({ error: 'Reminder not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ reminder });
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
