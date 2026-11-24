import { Router, type Response } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import {
  StayProblem,
  createStay,
  deleteStay,
  dischargeSchema,
  dischargeStay,
  staysOut,
  stayInputSchema,
  updateStay,
  type StayRow,
} from '../services/hospitalStays';
import { TaskProblem } from '../services/tasks';
import { doneFromItem, journeyItemRef } from '../services/journeyItems';

const fromItemOf = (body: unknown) => journeyItemRef.safeParse((body as Record<string, unknown> | undefined)?.['from_journey_item_id']).data ?? null;

/**
 * Hospital stays for one person: when they went in and came out, where, and
 * the discharge with the tasks it makes. While a stay is open the medicine
 * reminders pause.
 */
export const hospitalStaysRouter = Router({ mergeParams: true });

const profileIdOf = (req: { params: unknown }) => String((req.params as Record<string, string>)['id']);
const tz = (req: { headers: Record<string, unknown> }) => (req.headers['x-time-zone'] as string) || null;

function sendProblem(res: Response, err: unknown): boolean {
  if (err instanceof StayProblem || err instanceof TaskProblem) {
    res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
    return true;
  }
  if ((err as { code?: string })?.code === '23505') {
    res.status(409).json({ error: 'They are already shown as in hospital. Record that discharge first, then add the new stay.', code: 'ALREADY_OPEN' });
    return true;
  }
  return false;
}

async function oneOut(profileId: string, id: string) {
  const row = (await db('hospital_stays').where({ id, care_profile_id: profileId }).first()) as StayRow | undefined;
  return row ? (await staysOut(db, profileId, [row]))[0]! : null;
}

hospitalStaysRouter.get('/', requireAuth, async (req, res) => {
  const profileId = profileIdOf(req);
  const rows = (await db('hospital_stays').where({ care_profile_id: profileId }).orderBy('admitted_on', 'desc')) as StayRow[];
  res.json({ stays: await staysOut(db, profileId, rows) });
});

hospitalStaysRouter.post('/', requireAuth, async (req, res) => {
  const parsed = stayInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which day they went in. The other boxes can wait.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  try {
    const made = await db.transaction(async (trx) => {
      const m = await createStay(trx, { profileId, actorId: req.account!.id, input: parsed.data, timeZone: tz(req) });
      // Recorded from a journey step: the step is done.
      await doneFromItem(trx, { profileId, itemId: fromItemOf(req.body), actorId: req.account!.id, record: { kind: 'hospital-stays', id: m.stay.id } });
      return m;
    });
    res.status(201).json({ stay: await oneOut(profileId, made.stay.id), filed: made.filed });
  } catch (err) {
    if (sendProblem(res, err)) return;
    throw err;
  }
});

hospitalStaysRouter.patch('/:stayId', requireAuth, async (req, res) => {
  const parsed = stayInputSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read. Check the dates.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  try {
    const stay = await db.transaction((trx) =>
      updateStay(trx, { profileId, stayId: String(req.params['stayId']), actorId: req.account!.id, input: parsed.data, timeZone: tz(req) })
    );
    if (!stay) {
      res.status(404).json({ error: 'That hospital stay was not found.', code: 'NOT_FOUND' });
      return;
    }
    res.json({ stay: await oneOut(profileId, stay.id) });
  } catch (err) {
    if (sendProblem(res, err)) return;
    throw err;
  }
});

hospitalStaysRouter.post('/:stayId/discharge', requireAuth, async (req, res) => {
  const parsed = dischargeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which day they left hospital.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  try {
    const stay = await db.transaction((trx) =>
      dischargeStay(trx, { profileId, stayId: String(req.params['stayId']), actorId: req.account!.id, input: parsed.data, timeZone: tz(req) })
    );
    res.locals['auditEntries'] = [{ action: 'updated', entity_id: stay.id, summary: `recorded the discharge on ${stay.discharged_on}` }];
    res.json({ stay: await oneOut(profileId, stay.id) });
  } catch (err) {
    if (sendProblem(res, err)) return;
    throw err;
  }
});

hospitalStaysRouter.delete('/:stayId', requireAuth, async (req, res) => {
  const ok = await db.transaction((trx) => deleteStay(trx, { profileId: profileIdOf(req), stayId: String(req.params['stayId']) }));
  if (!ok) {
    res.status(404).json({ error: 'That hospital stay was not found.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Hospital stay deleted.' });
});
