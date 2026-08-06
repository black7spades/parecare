import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { actionSchema, toJsonSchema, executeActions, type AssistantAction } from '../services/aiActions';

/**
 * The machine layer: the same actions Pare carries out, offered as a plain
 * contract so an assistant or a script can drive PareCare the way a person
 * does, and no more. One endpoint discovers what can be done, one carries it
 * out with the caller's own permissions, and one undoes what can be undone.
 */

// ── The published contract ─────────────────────────────────────────────

/** Every action type, read off the schema so the list can never drift from it. */
const ACTION_TYPES = (actionSchema.options as unknown as { shape: { type: { value: string } } }[]).map(
  (o) => o.shape.type.value
);

export const actionsContractRouter = Router();

actionsContractRouter.get('/', requireAuth, (_req, res) => {
  res.json({
    // The exact schema that constrains Pare's own output, so the documentation
    // and the behaviour cannot come apart.
    schema: toJsonSchema(actionSchema),
    action_types: ACTION_TYPES,
    execute: 'POST /api/v1/care-profiles/:id/actions',
    undo: 'POST /api/v1/care-profiles/:id/actions/undo',
  });
});

// ── Execution and undo, scoped to one care profile ─────────────────────

/**
 * A create action records the row it made, so it can be removed to undo it.
 * Only these dependency-free records are offered: removing one takes nothing
 * else with it. The audit entity_type is the key.
 */
const UNDO_TABLES: Record<string, string> = {
  log: 'care_log_entries',
  reminders: 'reminders',
  allergies: 'allergies',
  questions: 'open_questions',
  treatments: 'treatments',
};

// How long a change stays undoable after it was made.
const UNDO_WINDOW_MS = 30 * 60 * 1000;

export const profileActionsRouter = Router({ mergeParams: true });

const applySchema = z.object({ actions: z.array(z.unknown()).min(1).max(50) });

profileActionsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  // Every action is re-checked against the real schema before it runs, so a
  // malformed one is rejected rather than half executed.
  const valid: AssistantAction[] = [];
  const errors: string[] = [];
  for (const raw of parsed.data.actions) {
    const a = actionSchema.safeParse(raw);
    if (a.success) valid.push(a.data);
    else errors.push('Skipped an item that was not a valid action.');
  }
  if (valid.length === 0) {
    res.status(400).json({ error: 'No valid actions were supplied.', code: 'VALIDATION_ERROR', outcomes: errors });
    return;
  }

  const profileId = String(req.params['id']);
  const undoBatch = randomUUID();
  const outcomes = await executeActions(
    valid,
    profileId,
    req.account!,
    req.careAccess!,
    (req.headers['x-time-zone'] as string) || null,
    { source: 'assistant', undoBatch }
  );

  // Reversible when this batch left at least one row we know how to remove.
  const [{ count }] = (await db('audit_log')
    .where({ undo_batch: undoBatch, care_profile_id: profileId })
    .whereIn('entity_type', Object.keys(UNDO_TABLES))
    .whereNotNull('entity_id')
    .count<{ count: string }[]>('id as count')) as { count: string }[];
  const reversible = Number(count) > 0;

  res.json({ outcomes: [...outcomes, ...errors], undo_batch: reversible ? undoBatch : null, reversible });
});

profileActionsRouter.post('/undo', requireAuth, async (req, res) => {
  const parsed = z.object({ batch: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  const rows = await db('audit_log').where({ undo_batch: parsed.data.batch, care_profile_id: profileId });
  if (rows.length === 0) {
    res.status(404).json({ error: 'There is nothing to undo for that change.', code: 'NOT_FOUND' });
    return;
  }
  const newest = Math.max(...rows.map((r) => new Date(r.created_at as string).getTime()));
  if (Date.now() - newest > UNDO_WINDOW_MS) {
    res.status(409).json({ error: 'That change is too old to undo now.', code: 'UNDO_EXPIRED' });
    return;
  }
  const isAdmin = req.account!.role === 'admin' || req.account!.role === 'super_admin';

  let undone = 0;
  for (const r of rows) {
    const table = UNDO_TABLES[r.entity_type as string];
    if (!table || !r.entity_id) continue;
    // A person may undo their own change; an admin may undo any.
    if (!isAdmin && r.actor_account_id && r.actor_account_id !== req.account!.id) continue;
    try {
      const n = await db(table).where({ id: r.entity_id, care_profile_id: profileId }).del();
      undone += n;
    } catch {
      // A record something else now depends on cannot be removed cleanly; it is
      // left in place and reported as not undone rather than cascading.
    }
  }

  if (undone > 0) {
    await db('audit_log')
      .insert({
        care_profile_id: profileId,
        actor_account_id: req.account!.id,
        action: 'deleted',
        entity_type: 'undo',
        summary: `undid ${undone} ${undone === 1 ? 'change' : 'changes'}`,
      })
      .catch(() => {});
  }

  res.json({
    undone,
    not_reversible: rows.length - undone,
    message:
      undone === 0
        ? 'Nothing here could be undone. A dose drawn from supply or a care phase, for instance, cannot be reversed this way.'
        : `Undone ${undone} ${undone === 1 ? 'change' : 'changes'}.`,
  });
});
