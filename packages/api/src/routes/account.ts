import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * The logged-in user's own relationships to other accounts (who is who).
 * Edges are directed: a row records that `to_account` is the actor's
 * <relationship> (e.g. "brother"). Each user curates their own outgoing edges.
 */
export const accountRouter = Router();

accountRouter.use(requireAuth);

// Find people to link, by name or email
accountRouter.get('/people/search', async (req, res) => {
  const q = String(req.query['q'] ?? '').trim();
  if (q.length < 2) {
    res.json({ people: [] });
    return;
  }
  const like = `%${q}%`;
  const people = await db('accounts')
    .whereNot({ id: req.account!.id })
    .andWhere((qb) => {
      qb.whereILike('display_name', like).orWhereILike('email', like);
    })
    .select('id', 'display_name', 'email', 'avatar_url')
    .orderBy('display_name')
    .limit(10);
  res.json({ people });
});

accountRouter.get('/relationships', async (req, res) => {
  const relationships = await db('account_relationships')
    .join('accounts', 'account_relationships.to_account_id', 'accounts.id')
    .where('account_relationships.from_account_id', req.account!.id)
    .select(
      'account_relationships.id',
      'account_relationships.relationship',
      'accounts.id as account_id',
      'accounts.display_name',
      'accounts.email',
      'accounts.avatar_url'
    )
    .orderBy('accounts.display_name');
  res.json({ relationships });
});

const addSchema = z.object({
  to_account_id: z.string().uuid(),
  relationship: z.string().min(1).max(100),
});

accountRouter.post('/relationships', async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const { to_account_id, relationship } = parsed.data;
  if (to_account_id === req.account!.id) {
    res.status(400).json({ error: 'You cannot add a relationship to yourself', code: 'VALIDATION_ERROR' });
    return;
  }
  const target = await db('accounts').where({ id: to_account_id }).first();
  if (!target) {
    res.status(404).json({ error: 'Person not found', code: 'NOT_FOUND' });
    return;
  }
  await db('account_relationships')
    .insert({ from_account_id: req.account!.id, to_account_id, relationship })
    .onConflict(['from_account_id', 'to_account_id'])
    .merge({ relationship });
  res.status(201).json({ message: 'Relationship saved.' });
});

accountRouter.delete('/relationships/:id', async (req, res) => {
  const deleted = await db('account_relationships')
    .where({ id: req.params['id'], from_account_id: req.account!.id })
    .del();
  if (!deleted) {
    res.status(404).json({ error: 'Relationship not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Relationship removed.' });
});
