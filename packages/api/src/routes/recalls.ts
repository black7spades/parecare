import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { addRecall, dismissRecall, recallsFor } from '../services/recalls';

/**
 * Suggested reminders for one person: Add makes the repeating task, Dismiss
 * sets the suggestion aside for whoever dismissed it.
 */
export const recallsRouter = Router({ mergeParams: true });

const profileIdOf = (req: { params: unknown }) => String((req.params as Record<string, string>)['id']);

recallsRouter.get('/', requireAuth, async (req, res) => {
  res.json({ recalls: await recallsFor(db, profileIdOf(req), req.account!.id) });
});

recallsRouter.post('/:rule/add', requireAuth, async (req, res) => {
  const added = await db.transaction((trx) =>
    addRecall(trx, { profileId: profileIdOf(req), actorId: req.account!.id, rule: String(req.params['rule']), timeZone: (req.headers['x-time-zone'] as string) || null })
  );
  if (!added) {
    res.status(404).json({ error: 'That suggestion is not offered any more.', code: 'NOT_FOUND' });
    return;
  }
  res.locals['auditEntries'] = [{ entity_type: 'reminders', entity_id: added.id, summary: added.title, action: added.joined ? 'updated' : 'created' }];
  res.status(201).json({ task: added });
});

recallsRouter.post('/:rule/dismiss', requireAuth, async (req, res) => {
  await dismissRecall(req.account!.id, profileIdOf(req), String(req.params['rule']));
  res.locals['auditEntries'] = [];
  res.json({ dismissed: true });
});

// Taking a dismissal back, for Undo.
recallsRouter.delete('/:rule/dismiss', requireAuth, async (req, res) => {
  await db('attention_dismissals').where({ account_id: req.account!.id, item_key: `recall:${profileIdOf(req)}:${String(req.params['rule'])}` }).delete();
  res.locals['auditEntries'] = [];
  res.json({ dismissed: false });
});
