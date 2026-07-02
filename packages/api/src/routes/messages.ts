import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

export const messagesRouter = Router({ mergeParams: true });

messagesRouter.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query['limit'] ?? 100), 200);
  const messages = await db('messages')
    .leftJoin('accounts', 'messages.author_account_id', 'accounts.id')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('messages.created_at', 'desc')
    .limit(limit)
    .select(
      'messages.id',
      'messages.body',
      'messages.created_at',
      'messages.author_account_id',
      'accounts.display_name as author_name'
    );
  // Oldest first for display
  res.json({ messages: messages.reverse() });
});

messagesRouter.post('/', requireAuth, async (req, res) => {
  const schema = z.object({ body: z.string().min(1).max(5000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [message] = await db('messages')
    .insert({
      care_profile_id: req.params['id'],
      author_account_id: req.account!.id,
      body: parsed.data.body,
    })
    .returning(['id', 'body', 'created_at', 'author_account_id']);

  res.status(201).json({ message: { ...message, author_name: req.account!.display_name } });
});

messagesRouter.delete('/:messageId', requireAuth, async (req, res) => {
  const affected = await db('messages')
    .where({
      id: req.params['messageId'],
      care_profile_id: req.params['id'],
      author_account_id: req.account!.id, // only your own messages
    })
    .delete();
  if (!affected) {
    res.status(404).json({ error: 'Message not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Deleted.' });
});
