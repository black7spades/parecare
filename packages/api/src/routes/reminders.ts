import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
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
