import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { MoveProblem, deleteMove, moveInputSchema, movesOut, saveMove } from '../services/careMoves';
import { TaskProblem } from '../services/tasks';
import { ADDRESS_PART_KEYS } from '../services/addresses';

/**
 * Moves into care for one person, and "Where they live" as one page: the
 * home they live in now, the home they left, their hospital stays and their
 * moves.
 */
export const careMovesRouter = Router({ mergeParams: true });

const profileIdOf = (req: { params: unknown }) => String((req.params as Record<string, string>)['id']);
const tz = (req: { headers: Record<string, unknown> }) => (req.headers['x-time-zone'] as string) || null;

careMovesRouter.get('/', requireAuth, async (req, res) => {
  const profileId = profileIdOf(req);
  const rows = await db('care_moves').where({ care_profile_id: profileId }).orderByRaw('coalesce(entry_on, created_at::date) desc');
  // Previous homes kept in the address book, newest first.
  const previous = await db('care_profile_addresses as l')
    .join('addresses as a', 'a.id', 'l.address_id')
    .where({ 'l.care_profile_id': profileId, 'l.address_kind': 'previous_home' })
    .orderBy('l.updated_at', 'desc')
    .select('a.id', 'a.formatted', ...ADDRESS_PART_KEYS.map((k) => `a.${k}`));
  res.json({ moves: await movesOut(db, profileId, rows), previous_homes: previous });
});

async function oneOut(profileId: string, id: string) {
  const row = await db('care_moves').where({ id, care_profile_id: profileId }).first();
  return row ? (await movesOut(db, profileId, [row]))[0]! : null;
}

function problem(res: import('express').Response, err: unknown): boolean {
  if (err instanceof MoveProblem || err instanceof TaskProblem) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message, code: 'VALIDATION_ERROR' });
    return true;
  }
  return false;
}

careMovesRouter.post('/', requireAuth, async (req, res) => {
  const parsed = moveInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which care home. Dates go in as dates.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  try {
    const saved = await db.transaction((trx) => saveMove(trx, { profileId, actor: { id: req.account!.id, role: req.account!.role }, input: parsed.data, timeZone: tz(req) }));
    res.status(201).json({ move: await oneOut(profileId, saved.id), filed: saved.filed, phase_changed: saved.phase_changed });
  } catch (err) {
    if (problem(res, err)) return;
    throw err;
  }
});

careMovesRouter.patch('/:moveId', requireAuth, async (req, res) => {
  const parsed = moveInputSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read. Dates go in as dates.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  try {
    const saved = await db.transaction((trx) =>
      saveMove(trx, { profileId, actor: { id: req.account!.id, role: req.account!.role }, moveId: String(req.params['moveId']), input: parsed.data, timeZone: tz(req) })
    );
    res.json({ move: await oneOut(profileId, saved.id), filed: saved.filed, phase_changed: saved.phase_changed });
  } catch (err) {
    if (problem(res, err)) return;
    throw err;
  }
});

careMovesRouter.delete('/:moveId', requireAuth, async (req, res) => {
  const ok = await db.transaction((trx) => deleteMove(trx, profileIdOf(req), String(req.params['moveId'])));
  if (!ok) {
    res.status(404).json({ error: 'That move was not found.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Move deleted.' });
});
