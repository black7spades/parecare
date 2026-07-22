import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireProfileOwner } from '../middleware/permissions';
import { summarizeSpend, serializeEntry, SPEND_CATEGORIES } from '../services/healthSpend';

/**
 * The health spend ledger for one person. Reads and writes are owner or admin
 * only, so the wider care circle does not see the household's care costs.
 * Medication and appointment entries are created by their own flows (a
 * replenishment, a booking); this router handles the ledger view, hand-entered
 * one-off costs, and edits.
 */
export const healthSpendRouter = Router({ mergeParams: true });

healthSpendRouter.use(requireAuth, requireProfileOwner);

// The care profile id comes from the parent route via mergeParams.
const profileIdOf = (req: { params: unknown }): string => String((req.params as Record<string, string>)['id']);

const entrySelect = () =>
  db('health_spend_entries as e')
    .leftJoin('medication_catalogue as mc', function joinMed() {
      this.on('mc.id', '=', db.raw('(select medication_catalogue_id from medications where id = e.medication_id)'));
    })
    .leftJoin('appointments as ap', 'ap.id', 'e.appointment_id')
    .select(
      'e.*',
      db.raw("coalesce(mc.name, ap.title, e.description) as item_name")
    );

healthSpendRouter.get('/', async (req, res) => {
  const from = req.query['from'] ? String(req.query['from']).slice(0, 10) : null;
  const to = req.query['to'] ? String(req.query['to']).slice(0, 10) : null;
  const profileId = profileIdOf(req);

  const summary = await summarizeSpend(profileId, { from, to }, db);

  let query = entrySelect().where('e.care_profile_id', profileId);
  if (from) query = query.where('e.spent_on', '>=', from);
  if (to) query = query.where('e.spent_on', '<=', to);
  const rows = await query.orderBy('e.spent_on', 'desc');

  res.json({ summary, entries: rows.map(serializeEntry) });
});

const manualSchema = z.object({
  amount: z.coerce.number().min(0).max(1e9),
  spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(2000).optional().nullable(),
});

healthSpendRouter.post('/', async (req, res) => {
  const parsed = manualSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [entry] = await db('health_spend_entries')
    .insert({
      care_profile_id: profileIdOf(req),
      amount: parsed.data.amount,
      spent_on: parsed.data.spent_on,
      category: 'other',
      status: 'confirmed',
      description: parsed.data.description ?? null,
      created_by_account_id: req.account!.id,
    })
    .returning('*');
  res.status(201).json({ entry: serializeEntry(entry as Record<string, unknown>) });
});

const editSchema = z.object({
  amount: z.coerce.number().min(0).max(1e9).optional(),
  spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['confirmed', 'estimated']).optional(),
  category: z.enum(SPEND_CATEGORIES as unknown as [string, ...string[]]).optional(),
  description: z.string().max(2000).optional().nullable(),
});

healthSpendRouter.patch('/:entryId', async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const update: Record<string, unknown> = { updated_at: db.fn.now() };
  if (parsed.data.amount !== undefined) update['amount'] = parsed.data.amount;
  if (parsed.data.spent_on !== undefined) update['spent_on'] = parsed.data.spent_on;
  if (parsed.data.status !== undefined) update['status'] = parsed.data.status;
  if (parsed.data.category !== undefined) update['category'] = parsed.data.category;
  if (parsed.data.description !== undefined) update['description'] = parsed.data.description ?? null;

  const [entry] = await db('health_spend_entries')
    .where({ id: req.params['entryId'], care_profile_id: profileIdOf(req) })
    .update(update)
    .returning('*');
  if (!entry) {
    res.status(404).json({ error: 'Spend entry not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ entry: serializeEntry(entry as Record<string, unknown>) });
});

healthSpendRouter.delete('/:entryId', async (req, res) => {
  const deleted = await db('health_spend_entries')
    .where({ id: req.params['entryId'], care_profile_id: profileIdOf(req) })
    .del();
  if (!deleted) {
    res.status(404).json({ error: 'Spend entry not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ ok: true });
});
