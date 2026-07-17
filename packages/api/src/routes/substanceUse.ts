import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { resolveSubstanceCatalogueId, SUBSTANCE_CLASSES } from './substanceCatalogue';

/**
 * Substance use on a care profile: which substances a person takes (legal or
 * illegal), how, how much, how often, and where each sits in a lifecycle
 * from active use to recovery. One record per substance. Each fact is its
 * own column, and the substance itself lives in the shared catalogue.
 */
export const substanceUseRouter = Router({ mergeParams: true });

export const SUBSTANCE_STATUSES = ['active', 'reducing', 'in_recovery', 'in_remission', 'former'] as const;
export const SUBSTANCE_ROUTES = ['smoked', 'vaped', 'oral', 'drunk', 'injected', 'inhaled', 'other'] as const;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bodySchema = z.object({
  substance: z.string().min(1).max(255),
  substance_class: z.enum(SUBSTANCE_CLASSES).optional().nullable(),
  status: z.enum(SUBSTANCE_STATUSES).optional(),
  route: z.enum(SUBSTANCE_ROUTES).optional().nullable(),
  quantity: z.string().max(100).optional().nullable(),
  quantity_unit: z.string().max(60).optional().nullable(),
  frequency: z.string().max(120).optional().nullable(),
  started_on: DATE.optional().nullable(),
  quit_on: DATE.optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  sort_order: z.number().int().optional(),
});

/** List one profile's substance-use records, joined with the catalogue. */
const listSelect = (profileId: string) =>
  db('substance_use as su')
    .join('substance_catalogue as sc', 'su.substance_catalogue_id', 'sc.id')
    .where('su.care_profile_id', profileId)
    .select(
      'su.*',
      'sc.name as substance',
      'sc.substance_class',
    );

substanceUseRouter.get('/', requireAuth, async (req, res) => {
  const rows = await listSelect(req.params['id'] as string).orderBy([
    { column: 'su.sort_order', order: 'asc' },
    { column: 'sc.name', order: 'asc' },
  ]);
  res.json({ substance_use: rows });
});

substanceUseRouter.post('/', requireAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const { substance, substance_class, ...rest } = parsed.data;
  const catalogueId = await resolveSubstanceCatalogueId(substance, substance_class, req.account!.id);
  try {
    await db('substance_use').insert({
      care_profile_id: req.params['id'],
      substance_catalogue_id: catalogueId,
      ...rest,
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'That substance is already recorded for this person', code: 'ALREADY_RECORDED' });
      return;
    }
    throw err;
  }
  const [row] = await listSelect(req.params['id'] as string).andWhere('su.substance_catalogue_id', catalogueId);
  res.status(201).json({ substance_use: row });
});

substanceUseRouter.patch('/:recordId', requireAuth, async (req, res) => {
  const parsed = bodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const existing = await db('substance_use').where({ id: req.params['recordId'], care_profile_id: req.params['id'] }).first();
  if (!existing) {
    res.status(404).json({ error: 'Substance record not found', code: 'NOT_FOUND' });
    return;
  }
  const { substance, substance_class, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest, updated_at: db.fn.now() };
  // Renaming the substance re-points the record at the catalogue entry.
  if (substance !== undefined && substance) {
    update['substance_catalogue_id'] = await resolveSubstanceCatalogueId(substance, substance_class, req.account!.id);
  }
  try {
    await db('substance_use').where({ id: req.params['recordId'] }).update(update);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'That substance is already recorded for this person', code: 'ALREADY_RECORDED' });
      return;
    }
    throw err;
  }
  const [row] = await listSelect(req.params['id'] as string).andWhere('su.id', req.params['recordId']);
  res.json({ substance_use: row });
});

substanceUseRouter.delete('/:recordId', requireAuth, async (req, res) => {
  const affected = await db('substance_use')
    .where({ id: req.params['recordId'], care_profile_id: req.params['id'] })
    .delete();
  if (!affected) {
    res.status(404).json({ error: 'Substance record not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Substance record deleted.' });
});
