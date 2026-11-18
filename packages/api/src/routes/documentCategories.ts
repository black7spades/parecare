import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import {
  KEPT_CATEGORY_KEYS,
  KEPT_REASON,
  accountIdForProfile,
  categoryIdByKey,
  findCategoryByName,
  listCategories,
  resolveCategoryByName,
  type DocumentCategory,
} from '../services/documentCategories';

/**
 * The account's document categories, reached from any of its people. Anyone
 * who can file a document can add a category. Renaming, combining and
 * deleting change every document the account holds, so only the account
 * owner can do those.
 */
export const documentCategoriesRouter = Router({ mergeParams: true });

const nameSchema = z.object({ name: z.string().trim().min(1).max(100) });
const combineSchema = z.object({ into_id: z.string().uuid() });
const restoreSchema = z.object({ document_ids: z.array(z.string().uuid()).max(5000) });

const isOwner = (req: Request): boolean => req.careAccess?.level === 'owner';
const accountOf = async (req: Request): Promise<string> =>
  (await accountIdForProfile(String((req.params as Record<string, string>)['id'])))!;

function ownerOnly(req: Request, res: Response): boolean {
  if (isOwner(req)) return true;
  res.status(403).json({ error: 'Only the account owner can change categories.', code: 'FORBIDDEN' });
  return false;
}

/** The category, when it belongs to this account and is not deleted. */
async function ownCategory(req: Request, res: Response, accountId: string): Promise<DocumentCategory | null> {
  const cat = (await db('document_categories')
    .where({ id: String(req.params['catId']), account_id: accountId })
    .first()) as DocumentCategory | undefined;
  if (!cat) {
    res.status(404).json({ error: 'That category could not be found.', code: 'NOT_FOUND' });
    return null;
  }
  return cat;
}

const shape = (c: DocumentCategory, count?: number) => ({
  id: c.id,
  name: c.name,
  system_key: c.system_key,
  kept: !!c.system_key && KEPT_CATEGORY_KEYS.has(c.system_key),
  kept_reason: c.system_key ? KEPT_REASON[c.system_key] ?? null : null,
  ...(count === undefined ? {} : { document_count: count }),
});

documentCategoriesRouter.get('/', requireAuth, async (req, res) => {
  const accountId = await accountOf(req);
  const cats = await listCategories(accountId);
  // Counts span every person in the account, so only the owner sees them.
  let counts = new Map<string, number>();
  if (isOwner(req)) {
    const rows = await db('documents')
      .whereIn('category_id', cats.map((c) => c.id))
      .groupBy('category_id')
      .select('category_id')
      .count<{ category_id: string; count: string }[]>('* as count');
    counts = new Map(rows.map((r) => [r.category_id, Number(r.count)]));
  }
  res.json({
    can_manage: isOwner(req),
    categories: cats.map((c) => shape(c, isOwner(req) ? counts.get(c.id) ?? 0 : undefined)),
  });
});

documentCategoriesRouter.post('/', requireAuth, async (req, res) => {
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Give the category a name.', code: 'VALIDATION_ERROR' });
    return;
  }
  const accountId = await accountOf(req);
  const id = await resolveCategoryByName(accountId, parsed.data.name);
  const cat = (await db('document_categories').where({ id }).first()) as DocumentCategory;
  res.status(201).json({ category: shape(cat, 0) });
});

documentCategoriesRouter.patch('/:catId', requireAuth, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Give the category a name.', code: 'VALIDATION_ERROR' });
    return;
  }
  const accountId = await accountOf(req);
  const cat = await ownCategory(req, res, accountId);
  if (!cat) return;
  const name = parsed.data.name.replace(/\s+/g, ' ');
  const clash = await findCategoryByName(accountId, name);
  if (clash && clash.id !== cat.id) {
    // Renaming onto an existing name means combining them; the page asks first.
    res.status(409).json({
      error: `There is already a category called ${clash.name}.`,
      code: 'CATEGORY_EXISTS',
      existing: shape(clash),
    });
    return;
  }
  await db('document_categories').where({ id: cat.id }).update({ name, updated_at: db.fn.now() });
  res.json({ category: shape({ ...cat, name }) });
});

/** Move every document in this category into another, then remove this one. */
documentCategoriesRouter.post('/:catId/combine', requireAuth, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const parsed = combineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose the category to combine with.', code: 'VALIDATION_ERROR' });
    return;
  }
  const accountId = await accountOf(req);
  const cat = await ownCategory(req, res, accountId);
  if (!cat) return;
  const into = (await db('document_categories')
    .where({ id: parsed.data.into_id, account_id: accountId })
    .whereNull('deleted_at')
    .first()) as DocumentCategory | undefined;
  if (!into || into.id === cat.id) {
    res.status(404).json({ error: 'That category could not be found.', code: 'NOT_FOUND' });
    return;
  }
  // A kept category can take others in, but is never folded away itself. If
  // it is the one being renamed, fold the other one into it instead.
  const keptSource = !!cat.system_key && KEPT_CATEGORY_KEYS.has(cat.system_key);
  const [from, to] = keptSource ? [into, cat] : [cat, into];
  if (from.system_key && KEPT_CATEGORY_KEYS.has(from.system_key)) {
    res.status(409).json({ error: 'Both of these are always kept, so they cannot be combined.', code: 'CATEGORY_KEPT' });
    return;
  }
  const moved = await db.transaction(async (trx) => {
    const n = await trx('documents').where({ category_id: from.id }).update({ category_id: to.id });
    await trx('document_categories').where({ id: from.id }).delete();
    return n;
  });
  res.json({ category: shape(to), moved });
});

documentCategoriesRouter.delete('/:catId', requireAuth, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const accountId = await accountOf(req);
  const cat = await ownCategory(req, res, accountId);
  if (!cat) return;
  if (cat.system_key && KEPT_CATEGORY_KEYS.has(cat.system_key)) {
    res.status(409).json({ error: KEPT_REASON[cat.system_key], code: 'CATEGORY_KEPT' });
    return;
  }
  const otherId = await categoryIdByKey(accountId, 'other');
  const movedIds = await db.transaction(async (trx) => {
    const ids = (await trx('documents').where({ category_id: cat.id }).pluck('id')) as string[];
    if (ids.length) await trx('documents').whereIn('id', ids).update({ category_id: otherId });
    await trx('document_categories').where({ id: cat.id }).update({ deleted_at: trx.fn.now() });
    return ids;
  });
  // The moved documents come back with the category on Undo.
  res.json({ category: shape(cat), moved_document_ids: movedIds });
});

/** Undo a delete: bring the category back, and its documents still in Other. */
documentCategoriesRouter.post('/:catId/restore', requireAuth, async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const parsed = restoreSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const accountId = await accountOf(req);
  const cat = await ownCategory(req, res, accountId);
  if (!cat) return;
  if (cat.deleted_at) {
    const clash = await findCategoryByName(accountId, cat.name);
    if (clash) {
      res.status(409).json({ error: `A new category called ${clash.name} was added since, so this one cannot come back.`, code: 'CATEGORY_EXISTS' });
      return;
    }
  }
  const otherId = await categoryIdByKey(accountId, 'other');
  await db.transaction(async (trx) => {
    await trx('document_categories').where({ id: cat.id }).update({ deleted_at: null });
    if (parsed.data.document_ids.length) {
      await trx('documents')
        .whereIn('id', parsed.data.document_ids)
        .where({ category_id: otherId })
        .update({ category_id: cat.id });
    }
  });
  res.json({ category: shape({ ...cat, deleted_at: null }) });
});
