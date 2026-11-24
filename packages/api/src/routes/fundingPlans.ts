import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireProfileOwner } from '../middleware/permissions';
import { PlanProblem, planInputSchema, plansOut, savePlan } from '../services/fundingPlans';

/**
 * Funding plans for one person: an NDIS plan or an aged care package. Like
 * care costs, only whoever manages the profile, or an admin, sees and
 * changes them, because the budgets are the household's money.
 */
export const fundingPlansRouter = Router({ mergeParams: true });

fundingPlansRouter.use(requireAuth, requireProfileOwner('see or change the funding plan'));

const profileIdOf = (req: { params: unknown }) => String((req.params as Record<string, string>)['id']);
const tz = (req: { headers: Record<string, unknown> }) => (req.headers['x-time-zone'] as string) || null;

async function oneOut(profileId: string, id: string, timeZone?: string | null) {
  const row = await db('funding_plans').where({ id, care_profile_id: profileId }).first();
  return row ? (await plansOut(db, profileId, [row], timeZone))[0]! : null;
}

fundingPlansRouter.get('/', async (req, res) => {
  const profileId = profileIdOf(req);
  const rows = await db('funding_plans').where({ care_profile_id: profileId }).orderByRaw('coalesce(starts_on, created_at::date) desc');
  res.json({ plans: await plansOut(db, profileId, rows, tz(req)) });
});

fundingPlansRouter.post('/', async (req, res) => {
  const parsed = planInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Say what kind of plan it is. Each budget needs a name and an amount.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  try {
    const saved = await db.transaction((trx) => savePlan(trx, { profileId, actorId: req.account!.id, input: parsed.data, timeZone: tz(req) }));
    res.status(201).json({ plan: await oneOut(profileId, saved.id, tz(req)), filed: saved.filed, report_tasks: saved.report_tasks });
  } catch (err) {
    if (err instanceof PlanProblem) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
});

fundingPlansRouter.patch('/:planId', async (req, res) => {
  const parsed = planInputSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read. Each budget needs a name and an amount.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  try {
    const saved = await db.transaction((trx) =>
      savePlan(trx, { profileId, actorId: req.account!.id, planId: String(req.params['planId']), input: parsed.data, timeZone: tz(req) })
    );
    res.json({ plan: await oneOut(profileId, saved.id, tz(req)), filed: saved.filed, report_tasks: saved.report_tasks });
  } catch (err) {
    if (err instanceof PlanProblem) {
      res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
});

fundingPlansRouter.delete('/:planId', async (req, res) => {
  const profileId = profileIdOf(req);
  const id = String(req.params['planId']);
  const plan = await db('funding_plans').where({ id, care_profile_id: profileId }).first('id');
  if (!plan) {
    res.status(404).json({ error: 'That plan was not found.', code: 'NOT_FOUND' });
    return;
  }
  await db.transaction(async (trx) => {
    // Report tasks still open belong to the plan and go with it.
    await trx('reminders').where({ funding_plan_id: id, completed: false }).delete();
    await trx('document_links').where({ entity_type: 'funding-plans', entity_id: id }).delete();
    await trx('funding_plans').where({ id }).delete();
  });
  res.json({ message: 'Plan deleted.' });
});
