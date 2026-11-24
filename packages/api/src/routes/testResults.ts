import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { ResultProblem, resultInputSchema, resultsOut, saveResult } from '../services/testResults';

/**
 * Test results for one person, each measure its own row. Saving one ties it
 * to the next visit with whoever ordered it, and ticks off the "Results to
 * chase" step waiting on it.
 */
export const testResultsRouter = Router({ mergeParams: true });

const profileIdOf = (req: { params: unknown }) => String((req.params as Record<string, string>)['id']);

async function oneOut(profileId: string, id: string) {
  const row = await db('test_results').where({ id, care_profile_id: profileId }).first();
  return row ? (await resultsOut(db, profileId, [row]))[0]! : null;
}

testResultsRouter.get('/', requireAuth, async (req, res) => {
  const profileId = profileIdOf(req);
  const rows = await db('test_results').where({ care_profile_id: profileId }).orderByRaw('coalesce(collected_on, reported_on, created_at::date) desc');
  res.json({ results: await resultsOut(db, profileId, rows) });
});

testResultsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = resultInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which test it was. Each measure needs a name, and numbers go in as numbers.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  try {
    const saved = await db.transaction((trx) => saveResult(trx, { profileId, actorId: req.account!.id, input: parsed.data, timeZone: (req.headers['x-time-zone'] as string) || null }));
    res.status(201).json({ result: await oneOut(profileId, saved.id), filed: saved.filed, ticked: saved.ticked });
  } catch (err) {
    if (err instanceof ResultProblem) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
});

testResultsRouter.patch('/:resultId', requireAuth, async (req, res) => {
  const parsed = resultInputSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read. Each measure needs a name, and numbers go in as numbers.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  try {
    const saved = await db.transaction((trx) => saveResult(trx, { profileId, actorId: req.account!.id, resultId: String(req.params['resultId']), input: parsed.data, timeZone: (req.headers['x-time-zone'] as string) || null }));
    res.json({ result: await oneOut(profileId, saved.id), filed: saved.filed, ticked: saved.ticked });
  } catch (err) {
    if (err instanceof ResultProblem) {
      res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
});

testResultsRouter.delete('/:resultId', requireAuth, async (req, res) => {
  const profileId = profileIdOf(req);
  const n = await db('test_results').where({ id: req.params['resultId'], care_profile_id: profileId }).delete();
  if (!n) {
    res.status(404).json({ error: 'That result was not found.', code: 'NOT_FOUND' });
    return;
  }
  await db('document_links').where({ entity_type: 'results', entity_id: req.params['resultId'] }).delete();
  res.json({ message: 'Result deleted.' });
});
