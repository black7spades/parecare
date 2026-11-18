import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { accountIdForProfile } from '../services/documentCategories';
import {
  KEPT_NEXT_STEP_KEYS,
  KEPT_NEXT_STEP_REASON,
  findNextStepTypeByName,
  listNextStepTypes,
  resolveNextStepTypeByName,
  stepBooks,
  type NextStepType,
} from '../services/nextStepTypes';

/**
 * The account's kinds of next step, reached from any of its people. Anyone
 * who can record an outcome can add one by typing it. Renaming, combining and
 * deleting change the list for everyone the account cares for, so only the
 * account owner can do those, exactly as with document categories.
 */
export const nextStepTypesRouter = Router({ mergeParams: true });

const nameSchema = z.object({ name: z.string().trim().min(1).max(100) });
const combineSchema = z.object({ into_id: z.string().uuid() });

const isOwner = (req: Request): boolean => req.careAccess?.level === 'owner';
const accountOf = async (req: Request): Promise<string> =>
  (await accountIdForProfile(String((req.params as Record<string, string>)['id'])))!;

function ownerOnly(req: Request, res: Response): boolean {
  if (isOwner(req)) return true;
  res.status(403).json({ error: 'Only the account owner can change this list.', code: 'FORBIDDEN' });
  return false;
}

async function ownType(req: Request, res: Response, accountId: string): Promise<NextStepType | null> {
  const t = (await db('next_step_types')
    .where({ id: String(req.params['typeId']), account_id: accountId })
    .first()) as NextStepType | undefined;
  if (!t) {
    res.status(404).json({ error: 'That kind of next step could not be found.', code: 'NOT_FOUND' });
    return null;
  }
  return t;
}

const shape = (t: NextStepType, count?: number) => ({
  id: t.id,
  name: t.name,
  system_key: t.system_key,
  books: stepBooks(t.system_key),
  kept: !!t.system_key && KEPT_NEXT_STEP_KEYS.has(t.system_key),
  kept_reason: t.system_key ? KEPT_NEXT_STEP_REASON[t.system_key] ?? null : null,
  ...(count === undefined ? {} : { task_count: count }),
});

nextStepTypesRouter.get('/', requireAuth, async (req, res) => {
  const accountId = await accountOf(req);
  const types = await listNextStepTypes(accountId);
  let counts = new Map<string, number>();
  if (isOwner(req)) {
    const rows = await db('reminders')
      .whereIn('next_step_type_id', types.map((t) => t.id))
      .groupBy('next_step_type_id')
      .select('next_step_type_id')
      .count<{ next_step_type_id: string; count: string }[]>('* as count');
    counts = new Map(rows.map((r) => [r.next_step_type_id, Number(r.count)]));
  }
  res.json({
    can_manage: isOwner(req),
    types: types.map((t) => shape(t, isOwner(req) ? counts.get(t.id) ?? 0 : undefined)),
  });
});

nextStepTypesRouter.post('/', requireAuth, async (req, res) => {
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Give it a name.', code: 'VALIDATION_ERROR' });
    return;
  }
  const accountId = await accountOf(req);
  const id = await resolveNextStepTypeByName(accountId, parsed.data.name);
  const t = (await db('next_step_types').where({ id }).first()) as NextStepType;
  res.status(201).json({ type: shape(t, 0) });
});

nextStepTypesRouter.patch('/:typeId', requireAuth, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Give it a name.', code: 'VALIDATION_ERROR' });
    return;
  }
  const accountId = await accountOf(req);
  const t = await ownType(req, res, accountId);
  if (!t) return;
  const name = parsed.data.name.replace(/\s+/g, ' ');
  const clash = await findNextStepTypeByName(accountId, name);
  if (clash && clash.id !== t.id) {
    res.status(409).json({ error: `There is already one called ${clash.name}.`, code: 'CATEGORY_EXISTS', existing: shape(clash) });
    return;
  }
  await db('next_step_types').where({ id: t.id }).update({ name, updated_at: db.fn.now() });
  res.json({ type: shape({ ...t, name }) });
});

/** Move every next step of this kind to another kind, then remove this one. */
nextStepTypesRouter.post('/:typeId/combine', requireAuth, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const parsed = combineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose the one to combine with.', code: 'VALIDATION_ERROR' });
    return;
  }
  const accountId = await accountOf(req);
  const t = await ownType(req, res, accountId);
  if (!t) return;
  const into = (await db('next_step_types')
    .where({ id: parsed.data.into_id, account_id: accountId })
    .whereNull('deleted_at')
    .first()) as NextStepType | undefined;
  if (!into || into.id === t.id) {
    res.status(404).json({ error: 'That kind of next step could not be found.', code: 'NOT_FOUND' });
    return;
  }
  const keptSource = !!t.system_key && KEPT_NEXT_STEP_KEYS.has(t.system_key);
  const [from, to] = keptSource ? [into, t] : [t, into];
  if (from.system_key && KEPT_NEXT_STEP_KEYS.has(from.system_key)) {
    res.status(409).json({ error: 'Both of these are always kept, so they cannot be combined.', code: 'CATEGORY_KEPT' });
    return;
  }
  const moved = await db.transaction(async (trx) => {
    const n = await trx('reminders').where({ next_step_type_id: from.id }).update({ next_step_type_id: to.id });
    await trx('next_step_types').where({ id: from.id }).update({ deleted_at: trx.fn.now() });
    return n;
  });
  res.json({ type: shape(to), moved });
});

/**
 * Take a kind off the list. Next steps already recorded keep it, so the
 * record still reads true; it just is not offered any more. Undo brings it back.
 */
nextStepTypesRouter.delete('/:typeId', requireAuth, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const accountId = await accountOf(req);
  const t = await ownType(req, res, accountId);
  if (!t) return;
  if (t.system_key && KEPT_NEXT_STEP_KEYS.has(t.system_key)) {
    res.status(409).json({ error: KEPT_NEXT_STEP_REASON[t.system_key], code: 'CATEGORY_KEPT' });
    return;
  }
  await db('next_step_types').where({ id: t.id }).update({ deleted_at: db.fn.now() });
  res.json({ type: shape(t) });
});

nextStepTypesRouter.post('/:typeId/restore', requireAuth, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const accountId = await accountOf(req);
  const t = await ownType(req, res, accountId);
  if (!t) return;
  if (t.deleted_at) {
    const clash = await findNextStepTypeByName(accountId, t.name);
    if (clash) {
      res.status(409).json({ error: `A new one called ${clash.name} was added since, so this one cannot come back.`, code: 'CATEGORY_EXISTS' });
      return;
    }
  }
  await db('next_step_types').where({ id: t.id }).update({ deleted_at: null });
  res.json({ type: shape({ ...t, deleted_at: null }) });
});
