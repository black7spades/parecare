import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { resolveConditionCatalogueId } from './conditionCatalogue';
import { resolveOptions } from './optionCatalogue';

/**
 * Structured health facts on a care profile: allergies (what they must
 * not be given, and what happens if they are) and medical conditions
 * (what they live with, tied to the medications that treat it). One
 * fact, one column, everywhere.
 */

export const allergiesRouter = Router({ mergeParams: true });

allergiesRouter.get('/', requireAuth, async (req, res) => {
  const allergies = await db('allergies')
    .where({ care_profile_id: req.params['id'] })
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'substance', order: 'asc' }]);
  res.json({ allergies });
});

const allergySchema = z.object({
  substance: z.string().min(1).max(255),
  reaction: z.string().max(2000).optional().nullable(),
  sort_order: z.number().int().optional(),
});

allergiesRouter.post('/', requireAuth, async (req, res) => {
  const parsed = allergySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [allergy] = await db('allergies')
    .insert({ care_profile_id: req.params['id'], ...parsed.data })
    .returning('*');
  // The substance and reaction join the shared lists so they are offered
  // as suggestions to everyone from now on.
  await Promise.all([
    resolveOptions('allergen', [parsed.data.substance], req.account!.id),
    resolveOptions('allergy_reaction', [parsed.data.reaction], req.account!.id),
  ]);
  res.status(201).json({ allergy });
});

allergiesRouter.patch('/:allergyId', requireAuth, async (req, res) => {
  const parsed = allergySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [allergy] = await db('allergies')
    .where({ id: req.params['allergyId'], care_profile_id: req.params['id'] })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!allergy) {
    res.status(404).json({ error: 'Allergy not found', code: 'NOT_FOUND' });
    return;
  }
  await Promise.all([
    resolveOptions('allergen', [parsed.data.substance], req.account!.id),
    resolveOptions('allergy_reaction', [parsed.data.reaction], req.account!.id),
  ]);
  res.json({ allergy });
});

allergiesRouter.delete('/:allergyId', requireAuth, async (req, res) => {
  const deleted = await db('allergies')
    .where({ id: req.params['allergyId'], care_profile_id: req.params['id'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Allergy not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Allergy removed.' });
});

export const conditionsRouter = Router({ mergeParams: true });

// A plain date as YYYY-MM-DD, without a timezone shift, for the two
// lifecycle dates on a condition.
const dateOrNull = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const serializeCondition = <T extends Record<string, unknown>>(c: T): T => ({
  ...c,
  started_on: dateOrNull(c['started_on']),
  resolved_on: dateOrNull(c['resolved_on']),
});

conditionsRouter.get('/', requireAuth, async (req, res) => {
  const conditions = await db('medical_conditions')
    .where({ care_profile_id: req.params['id'] })
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'name', order: 'asc' }]);
  // The medications treating each condition, so the tie is visible.
  const meds = await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where('m.care_profile_id', req.params['id'])
    .whereNotNull('m.medical_condition_id')
    .select('m.medical_condition_id', 'c.name', 'm.active');
  const medsByCondition = new Map<string, Array<{ name: string; active: boolean }>>();
  for (const m of meds) {
    const arr = medsByCondition.get(m.medical_condition_id) ?? [];
    arr.push({ name: m.name, active: m.active });
    medsByCondition.set(m.medical_condition_id, arr);
  }
  // And the other treatments managing each condition, the same way.
  const treatments = await db('treatments')
    .where({ care_profile_id: req.params['id'] })
    .whereNotNull('medical_condition_id')
    .select('medical_condition_id', 'name', 'active');
  const treatmentsByCondition = new Map<string, Array<{ name: string; active: boolean }>>();
  for (const t of treatments) {
    const arr = treatmentsByCondition.get(t.medical_condition_id) ?? [];
    arr.push({ name: t.name, active: t.active });
    treatmentsByCondition.set(t.medical_condition_id, arr);
  }
  res.json({
    conditions: conditions.map((c) =>
      serializeCondition({
        ...c,
        medications: medsByCondition.get(c.id) ?? [],
        treatments: treatmentsByCondition.get(c.id) ?? [],
      })
    ),
  });
});

const conditionSchema = z.object({
  name: z.string().min(1).max(255),
  notes: z.string().max(2000).optional().nullable(),
  sort_order: z.number().int().optional(),
  // A condition's lifecycle, one fact per field: whether it is expected to
  // pass, how it stands now, and when it started and cleared.
  is_temporary: z.boolean().optional(),
  status: z.enum(['active', 'improving', 'managed', 'resolved']).optional(),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  resolved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

conditionsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = conditionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  // Every recorded condition joins the shared catalogue, so a name typed
  // once is suggested to everyone from then on.
  const catalogueId = await resolveConditionCatalogueId(parsed.data.name, req.account!.id);
  const [condition] = await db('medical_conditions')
    .insert({ care_profile_id: req.params['id'], ...parsed.data, condition_catalogue_id: catalogueId })
    .returning('*');
  res.status(201).json({ condition: serializeCondition(condition) });
});

conditionsRouter.patch('/:conditionId', requireAuth, async (req, res) => {
  const parsed = conditionSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  // A rename re-links the catalogue entry so suggestions follow the new name.
  const catalogueId = parsed.data.name
    ? await resolveConditionCatalogueId(parsed.data.name, req.account!.id)
    : undefined;
  const [condition] = await db('medical_conditions')
    .where({ id: req.params['conditionId'], care_profile_id: req.params['id'] })
    .update({
      ...parsed.data,
      ...(catalogueId ? { condition_catalogue_id: catalogueId } : {}),
      updated_at: db.fn.now(),
    })
    .returning('*');
  if (!condition) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ condition: serializeCondition(condition) });
});

conditionsRouter.delete('/:conditionId', requireAuth, async (req, res) => {
  const deleted = await db('medical_conditions')
    .where({ id: req.params['conditionId'], care_profile_id: req.params['id'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Condition removed.' });
});
