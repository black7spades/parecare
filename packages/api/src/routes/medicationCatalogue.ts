import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

// Instance-wide shared medication catalogue.
// - Read (search/autocomplete): any authenticated user.
// - Add a new drug: admin or super admin (owners also create implicitly when
//   they add a medication for their person, via resolveCatalogueId).
// - Edit or delete a shared entry: super admin only (it affects everyone),
//   and a drug still prescribed to anyone cannot be deleted.
export const medicationCatalogueRouter = Router();

/** Find the shared catalogue entry for a drug, creating it if new. */
export async function resolveCatalogueId(name: string, form: string | null | undefined, accountId?: string): Promise<string> {
  const n = name.trim();
  const f = (form ?? '').trim() || null;
  const find = () =>
    db('medication_catalogue')
      .whereRaw('lower(name) = lower(?)', [n])
      .whereRaw("lower(coalesce(form, '')) = lower(coalesce(?, ''))", [f])
      .first();
  const existing = await find();
  if (existing) return existing.id as string;
  try {
    const [row] = await db('medication_catalogue')
      .insert({ name: n, form: f, created_by_account_id: accountId ?? null })
      .returning('id');
    return (row as { id: string }).id;
  } catch {
    // Lost a race on the unique index — the entry now exists, so reuse it.
    const again = await find();
    if (again) return again.id as string;
    throw new Error('Could not resolve medication catalogue entry');
  }
}

medicationCatalogueRouter.get('/', requireAuth, async (req, res) => {
  const q = String(req.query['search'] ?? '').trim();
  let query = db('medication_catalogue').select('id', 'name', 'form');
  if (q) query = query.whereILike('name', `%${q}%`);
  const items = await query.orderBy('name', 'asc').limit(200);
  res.json({ items });
});

const catalogueSchema = z.object({
  name: z.string().min(1).max(255),
  form: z.string().max(100).optional().nullable(),
});

// Add a drug to the shared catalogue (admin or super admin).
medicationCatalogueRouter.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = catalogueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const id = await resolveCatalogueId(parsed.data.name, parsed.data.form ?? null, req.account!.id);
  const item = await db('medication_catalogue').where({ id }).first();
  res.status(201).json({ item });
});

// Edit a shared entry — super admin only, since it affects everyone using it.
medicationCatalogueRouter.patch('/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  const parsed = catalogueSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [item] = await db('medication_catalogue')
    .where({ id: req.params['id'] })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!item) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ item });
});

// Delete a shared entry — super admin only, and blocked while in use.
medicationCatalogueRouter.delete('/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  const inUse = await db('medications').where({ medication_catalogue_id: req.params['id'] }).count({ n: '*' }).first();
  if (Number(inUse?.n ?? 0) > 0) {
    res.status(409).json({
      error: `This medication is still prescribed to ${inUse!.n} ${Number(inUse!.n) === 1 ? 'person' : 'people'}. Remove it from them first.`,
      code: 'IN_USE',
      count: Number(inUse!.n),
    });
    return;
  }
  const affected = await db('medication_catalogue').where({ id: req.params['id'] }).del();
  if (!affected) {
    res.status(404).json({ error: 'Medication not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Medication removed from the catalogue.' });
});
