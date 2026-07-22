import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { resolveConditionCatalogueId } from './conditionCatalogue';
import { resolveOptions } from './optionCatalogue';
import {
  ATTRIBUTE_DOMAINS,
  ATTRIBUTE_KINDS,
  resolveNeurotypeAttributeCatalogueId,
  type AttributeKind,
} from './neurotypeAttributeCatalogue';

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
  // Also a plain date; sending the raw timestamp broke the edit forms,
  // whose date inputs and the schema above both expect YYYY-MM-DD.
  diagnosis_date: dateOrNull(c['diagnosis_date']),
});

conditionsRouter.get('/', requireAuth, async (req, res) => {
  const conditions = await db('medical_conditions as mc')
    .leftJoin('condition_catalogue as cc', 'mc.condition_catalogue_id', 'cc.id')
    .where({ 'mc.care_profile_id': req.params['id'] })
    .orderBy([{ column: 'mc.sort_order', order: 'asc' }, { column: 'mc.name', order: 'asc' }])
    .select('mc.*', 'cc.icd10_code as catalogue_icd10_code', 'cc.snomed_code as catalogue_snomed_code');
  const ids = conditions.map((c) => c.id as string);

  // The medications treating each condition, so the tie is visible.
  const meds = await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where('m.care_profile_id', req.params['id'])
    .whereNotNull('m.medical_condition_id')
    .select('m.medical_condition_id', 'm.id', 'c.name', 'm.active');
  const medsByCondition = new Map<string, Array<{ id: string; name: string; active: boolean }>>();
  for (const m of meds) {
    const arr = medsByCondition.get(m.medical_condition_id) ?? [];
    arr.push({ id: m.id, name: m.name, active: m.active });
    medsByCondition.set(m.medical_condition_id, arr);
  }
  // And the other treatments managing each condition, the same way.
  const treatments = await db('treatments')
    .where({ care_profile_id: req.params['id'] })
    .whereNotNull('medical_condition_id')
    .select('medical_condition_id', 'id', 'name', 'category', 'current_status', 'last_review_date', 'active');
  const treatmentsByCondition = new Map<string, Array<Record<string, unknown>>>();
  for (const t of treatments) {
    const arr = treatmentsByCondition.get(t.medical_condition_id) ?? [];
    arr.push({
      id: t.id,
      name: t.name,
      category: t.category,
      current_status: t.current_status,
      last_review_date: dateOrNull(t.last_review_date),
      active: t.active,
    });
    treatmentsByCondition.set(t.medical_condition_id, arr);
  }
  // Standard diagnosis codes and functional impacts, one row each.
  const codes = ids.length
    ? await db('condition_codes').whereIn('condition_id', ids).orderBy([{ column: 'system' }, { column: 'code' }])
    : [];
  const codesByCondition = new Map<string, unknown[]>();
  for (const code of codes) {
    const arr = codesByCondition.get(code.condition_id) ?? [];
    arr.push(code);
    codesByCondition.set(code.condition_id, arr);
  }
  const functions = ids.length
    ? await db('condition_functions').whereIn('condition_id', ids).orderBy('created_at', 'asc')
    : [];
  const functionsByCondition = new Map<string, unknown[]>();
  for (const fn of functions) {
    const arr = functionsByCondition.get(fn.condition_id) ?? [];
    arr.push(fn);
    functionsByCondition.set(fn.condition_id, arr);
  }

  const symptoms = ids.length
    ? await db('condition_symptoms').whereIn('condition_id', ids).orderBy('noted_at', 'desc')
    : [];
  const symptomsByCondition = new Map<string, unknown[]>();
  for (const s of symptoms) {
    const arr = symptomsByCondition.get(s.condition_id) ?? [];
    arr.push(s);
    symptomsByCondition.set(s.condition_id, arr);
  }

  // Neurotype traits, needs and supports, each joined with its library entry
  // so the label, domain and plain-language description come along.
  const attributes = ids.length
    ? await db('neurotype_attributes as na')
        .join('neurotype_attribute_catalogue as nac', 'na.catalogue_id', 'nac.id')
        .whereIn('na.condition_id', ids)
        .orderBy([{ column: 'nac.kind' }, { column: 'na.sort_order' }, { column: 'nac.label' }])
        .select(
          'na.id',
          'na.condition_id',
          'na.catalogue_id',
          'na.notes',
          'na.sort_order',
          'nac.kind',
          'nac.label',
          'nac.domain',
          'nac.description'
        )
    : [];
  const attributesByCondition = new Map<string, unknown[]>();
  for (const a of attributes) {
    const arr = attributesByCondition.get(a.condition_id) ?? [];
    arr.push(a);
    attributesByCondition.set(a.condition_id, arr);
  }

  res.json({
    conditions: conditions.map((c) =>
      serializeCondition({
        ...c,
        medications: medsByCondition.get(c.id) ?? [],
        treatments: treatmentsByCondition.get(c.id) ?? [],
        codes: codesByCondition.get(c.id) ?? [],
        functions: functionsByCondition.get(c.id) ?? [],
        symptoms: symptomsByCondition.get(c.id) ?? [],
        attributes: attributesByCondition.get(c.id) ?? [],
      })
    ),
  });
});

const conditionSchema = z.object({
  name: z.string().min(1).max(255),
  notes: z.string().max(2000).optional().nullable(),
  sort_order: z.number().int().optional(),
  is_temporary: z.boolean().optional(),
  status: z.enum(['active', 'improving', 'managed', 'resolved']).optional(),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  resolved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  condition_type: z.enum(['chronic', 'acute', 'disability', 'other']).optional().nullable(),
  severity: z.enum(['mild', 'moderate', 'severe', 'profound']).optional().nullable(),
  // The person's normal level on the 1 to 10 symptom scale for a long-term
  // condition. Health alerts fire only above this, so a chronic condition that
  // sits high every day does not alarm at its usual level. Null clears it.
  baseline_severity: z.number().int().min(1).max(10).optional().nullable(),
  is_permanent: z.boolean().optional().nullable(),
  expected_duration: z.enum(['self_limiting', 'short_term', 'long_term', 'lifelong']).optional().nullable(),
  category: z.enum(['illness', 'injury', 'post_operative', 'recovery', 'mental_health', 'chronic_flare', 'acute_illness', 'disability', 'neurotype', 'other']).optional().nullable(),
  is_contagious: z.boolean().optional(),
  isolation_required: z.boolean().optional(),
  region: z.string().max(255).optional().nullable(),
  neurotype: z.enum(['autism', 'adhd', 'dyslexia', 'dyspraxia', 'dyscalculia', 'tourette', 'intellectual_disability', 'sensory_processing', 'other']).optional().nullable(),
  diagnosis_status: z.enum(['formal', 'self_identified', 'suspected', 'in_assessment']).optional().nullable(),
  diagnosis_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  diagnosing_provider: z.string().max(255).optional().nullable(),
  diagnosis_document_id: z.union([z.string().uuid(), z.null()]).optional(),
});

/**
 * Fill in what can be worked out from the dates when the user has not said
 * explicitly: a resolved condition was acute; an unresolved one that began
 * more than three months ago is chronic.
 */
function classifyCondition(data: Partial<z.infer<typeof conditionSchema>>): Partial<z.infer<typeof conditionSchema>> {
  const out = { ...data };
  if (out.condition_type === undefined || out.condition_type === null) {
    if (out.resolved_on) out.condition_type = 'acute';
    else if (out.started_on) {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      out.condition_type = new Date(out.started_on) < threeMonthsAgo ? 'chronic' : 'acute';
    }
  }
  // A resolution date means the condition is resolved unless told otherwise.
  if (out.resolved_on && out.status === undefined) out.status = 'resolved';
  // A lifelong condition is not a temporary one, and vice versa.
  if (out.expected_duration && out.is_temporary === undefined) {
    out.is_temporary = out.expected_duration === 'self_limiting' || out.expected_duration === 'short_term';
  }
  // Neurotypes are always lifelong.
  if (out.category === 'neurotype') {
    out.expected_duration = 'lifelong';
    out.is_temporary = false;
    out.condition_type = 'disability';
  }
  return out;
}

/** Name the field that failed, so the form's error is actionable. */
const conditionValidationError = (err: z.ZodError): string => {
  const first = err.issues[0];
  return first && first.path.length > 0 ? `Check the ${first.path.join('.')} field: ${first.message}` : 'Invalid request';
};

conditionsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = conditionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: conditionValidationError(parsed.error), code: 'VALIDATION_ERROR' });
    return;
  }
  // Every recorded condition joins the shared catalogue, so a name typed
  // once is suggested to everyone from then on.
  const catalogueId = await resolveConditionCatalogueId(parsed.data.name, req.account!.id);
  const data = classifyCondition(parsed.data);
  const [condition] = await db('medical_conditions')
    .insert({ care_profile_id: req.params['id'], ...data, condition_catalogue_id: catalogueId })
    .returning('*');
  // The catalogue's reference codes come along automatically, so a picked
  // condition starts with its standard ICD-10 and SNOMED CT codes.
  const catalogueEntry = await db('condition_catalogue').where({ id: catalogueId }).first();
  const seedCodes: Array<{ condition_id: string; system: string; code: string }> = [];
  if (catalogueEntry?.icd10_code) seedCodes.push({ condition_id: condition.id, system: 'icd10', code: catalogueEntry.icd10_code });
  if (catalogueEntry?.snomed_code) seedCodes.push({ condition_id: condition.id, system: 'snomed', code: catalogueEntry.snomed_code });
  if (seedCodes.length > 0) await db('condition_codes').insert(seedCodes).onConflict(['condition_id', 'system', 'code']).ignore();
  const codes = await db('condition_codes').where({ condition_id: condition.id });
  res.status(201).json({ condition: serializeCondition({ ...condition, codes, functions: [] }) });
});

conditionsRouter.patch('/:conditionId', requireAuth, async (req, res) => {
  const parsed = conditionSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: conditionValidationError(parsed.error), code: 'VALIDATION_ERROR' });
    return;
  }
  // A rename re-links the catalogue entry so suggestions follow the new name.
  const catalogueId = parsed.data.name
    ? await resolveConditionCatalogueId(parsed.data.name, req.account!.id)
    : undefined;
  const data = classifyCondition(parsed.data);
  const [condition] = await db('medical_conditions')
    .where({ id: req.params['conditionId'], care_profile_id: req.params['id'] })
    .update({
      ...data,
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

// A condition being edited must belong to this profile before any of its
// child records (codes, functional impacts) can be touched.
async function findProfileCondition(conditionId: string, profileId: string) {
  return db('medical_conditions').where({ id: conditionId, care_profile_id: profileId }).first();
}

// --- Standard diagnosis codes -------------------------------------------

const codeSchema = z.object({
  system: z.enum(['icd10', 'snomed']),
  code: z.string().min(1).max(30),
});

conditionsRouter.post('/:conditionId/codes', requireAuth, async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  const [code] = await db('condition_codes')
    .insert({ condition_id: req.params['conditionId'], ...parsed.data })
    .onConflict(['condition_id', 'system', 'code'])
    .ignore()
    .returning('*');
  const saved = code ?? (await db('condition_codes').where({ condition_id: req.params['conditionId'], ...parsed.data }).first());
  res.status(201).json({ code: saved });
});

conditionsRouter.delete('/:conditionId/codes/:codeId', requireAuth, async (req, res) => {
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  const deleted = await db('condition_codes')
    .where({ id: req.params['codeId'], condition_id: req.params['conditionId'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Code not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Code removed.' });
});

// --- Functional impact ----------------------------------------------------

const functionSchema = z.object({
  domain: z.enum(['mobility', 'cognition', 'sensation', 'self_care', 'communication', 'social', 'work_study', 'other']),
  limitation_level: z.enum(['none', 'mild', 'moderate', 'severe', 'complete']),
  temporal_pattern: z.enum(['constant', 'intermittent', 'progressive', 'improving']).optional().nullable(),
  impact_on_activities: z.string().max(2000).optional().nullable(),
});

conditionsRouter.post('/:conditionId/functions', requireAuth, async (req, res) => {
  const parsed = functionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  const [fn] = await db('condition_functions')
    .insert({ condition_id: req.params['conditionId'], ...parsed.data })
    .returning('*');
  res.status(201).json({ function: fn });
});

conditionsRouter.patch('/:conditionId/functions/:functionId', requireAuth, async (req, res) => {
  const parsed = functionSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  const [fn] = await db('condition_functions')
    .where({ id: req.params['functionId'], condition_id: req.params['conditionId'] })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!fn) {
    res.status(404).json({ error: 'Functional impact not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ function: fn });
});

conditionsRouter.delete('/:conditionId/functions/:functionId', requireAuth, async (req, res) => {
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  const deleted = await db('condition_functions')
    .where({ id: req.params['functionId'], condition_id: req.params['conditionId'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Functional impact not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Functional impact removed.' });
});

// --- Neurotype traits, needs and supports ---------------------------------

const attributeSelect = (conditionId: string) =>
  db('neurotype_attributes as na')
    .join('neurotype_attribute_catalogue as nac', 'na.catalogue_id', 'nac.id')
    .where('na.condition_id', conditionId)
    .select(
      'na.id',
      'na.condition_id',
      'na.catalogue_id',
      'na.notes',
      'na.sort_order',
      'nac.kind',
      'nac.label',
      'nac.domain',
      'nac.description'
    );

const attributeSchema = z.object({
  kind: z.enum(ATTRIBUTE_KINDS),
  label: z.string().min(1).max(255),
  domain: z.enum(ATTRIBUTE_DOMAINS).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  sort_order: z.number().int().optional(),
});

conditionsRouter.post('/:conditionId/attributes', requireAuth, async (req, res) => {
  const parsed = attributeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const condition = await findProfileCondition(String(req.params['conditionId']), String(req.params['id']));
  if (!condition) {
    res.status(404).json({ error: 'Neurotype not found', code: 'NOT_FOUND' });
    return;
  }
  const catalogueId = await resolveNeurotypeAttributeCatalogueId(parsed.data.kind, parsed.data.label, {
    neurotype: condition.neurotype ?? null,
    domain: parsed.data.domain ?? null,
    description: parsed.data.description ?? null,
    accountId: req.account!.id,
  });
  try {
    await db('neurotype_attributes').insert({
      condition_id: req.params['conditionId'],
      catalogue_id: catalogueId,
      notes: parsed.data.notes ?? null,
      sort_order: parsed.data.sort_order ?? 0,
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'That is already recorded for this neurotype', code: 'ALREADY_RECORDED' });
      return;
    }
    throw err;
  }
  const [row] = await attributeSelect(String(req.params['conditionId'])).andWhere('na.catalogue_id', catalogueId);
  res.status(201).json({ attribute: row });
});

conditionsRouter.patch('/:conditionId/attributes/:attributeId', requireAuth, async (req, res) => {
  const parsed = attributeSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const condition = await findProfileCondition(String(req.params['conditionId']), String(req.params['id']));
  if (!condition) {
    res.status(404).json({ error: 'Neurotype not found', code: 'NOT_FOUND' });
    return;
  }
  const existing = await db('neurotype_attributes')
    .where({ id: req.params['attributeId'], condition_id: req.params['conditionId'] })
    .first();
  if (!existing) {
    res.status(404).json({ error: 'Attribute not found', code: 'NOT_FOUND' });
    return;
  }
  const update: Record<string, unknown> = { updated_at: db.fn.now() };
  if (parsed.data.notes !== undefined) update['notes'] = parsed.data.notes;
  if (parsed.data.sort_order !== undefined) update['sort_order'] = parsed.data.sort_order;
  // Renaming (or re-kinding) re-points the record at the library entry.
  if (parsed.data.label !== undefined && parsed.data.label) {
    const kind: AttributeKind = parsed.data.kind ?? (existing.kind as AttributeKind);
    update['catalogue_id'] = await resolveNeurotypeAttributeCatalogueId(kind, parsed.data.label, {
      neurotype: condition.neurotype ?? null,
      domain: parsed.data.domain ?? null,
      description: parsed.data.description ?? null,
      accountId: req.account!.id,
    });
  }
  try {
    await db('neurotype_attributes').where({ id: req.params['attributeId'] }).update(update);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'That is already recorded for this neurotype', code: 'ALREADY_RECORDED' });
      return;
    }
    throw err;
  }
  const [row] = await attributeSelect(String(req.params['conditionId'])).andWhere('na.id', req.params['attributeId']);
  res.json({ attribute: row });
});

conditionsRouter.delete('/:conditionId/attributes/:attributeId', requireAuth, async (req, res) => {
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Neurotype not found', code: 'NOT_FOUND' });
    return;
  }
  const deleted = await db('neurotype_attributes')
    .where({ id: req.params['attributeId'], condition_id: req.params['conditionId'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Attribute not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Removed.' });
});

// --- Condition symptoms ---------------------------------------------------

const symptomSchema = z.object({
  name: z.string().min(1).max(255),
  severity: z.number().int().min(1).max(10).default(5),
  notes: z.string().max(2000).optional().nullable(),
});

async function resolveSymptomCatalogueId(name: string): Promise<string | null> {
  const n = name.trim();
  const existing = await db('symptom_catalogue').whereRaw('lower(name) = lower(?)', [n]).first();
  if (existing) return existing.id as string;
  try {
    const [row] = await db('symptom_catalogue').insert({ name: n }).returning('id');
    return (row as { id: string }).id;
  } catch {
    const again = await db('symptom_catalogue').whereRaw('lower(name) = lower(?)', [n]).first();
    return again ? (again.id as string) : null;
  }
}

conditionsRouter.get('/:conditionId/symptoms', requireAuth, async (req, res) => {
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  const symptoms = await db('condition_symptoms')
    .where({ condition_id: req.params['conditionId'] })
    .orderBy('noted_at', 'desc');
  // Each symptom carries its severity readings, oldest first, so the
  // course of the illness reads left to right.
  const readings = symptoms.length
    ? await db('condition_symptom_readings')
        .whereIn('symptom_id', symptoms.map((s) => s.id))
        .orderBy('recorded_at', 'asc')
    : [];
  const readingsBySymptom = new Map<string, unknown[]>();
  for (const r of readings) {
    const arr = readingsBySymptom.get(r.symptom_id) ?? [];
    arr.push(r);
    readingsBySymptom.set(r.symptom_id, arr);
  }
  res.json({
    symptoms: symptoms.map((s) => ({ ...s, readings: readingsBySymptom.get(s.id) ?? [] })),
  });
});

conditionsRouter.post('/:conditionId/symptoms', requireAuth, async (req, res) => {
  const parsed = symptomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  const catalogueId = await resolveSymptomCatalogueId(parsed.data.name);
  const [symptom] = await db('condition_symptoms')
    .insert({
      condition_id: req.params['conditionId'],
      symptom_catalogue_id: catalogueId,
      ...parsed.data,
    })
    .returning('*');
  // The starting severity is the first reading in the symptom's course.
  await db('condition_symptom_readings').insert({
    symptom_id: symptom.id,
    severity: symptom.severity,
    recorded_at: symptom.noted_at,
  });
  res.status(201).json({ symptom });
});

conditionsRouter.patch('/:conditionId/symptoms/:symptomId', requireAuth, async (req, res) => {
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  const allowed = z.object({
    resolved_at: z.string().datetime().nullable().optional(),
    severity: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(2000).nullable().optional(),
  }).safeParse(req.body);
  if (!allowed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const before = await db('condition_symptoms')
    .where({ id: req.params['symptomId'], condition_id: req.params['conditionId'] })
    .first();
  if (!before) {
    res.status(404).json({ error: 'Symptom not found', code: 'NOT_FOUND' });
    return;
  }
  const [symptom] = await db('condition_symptoms')
    .where({ id: req.params['symptomId'], condition_id: req.params['conditionId'] })
    .update({ ...allowed.data, updated_at: db.fn.now() })
    .returning('*');
  // A severity change is a new dated reading in the symptom's course.
  if (allowed.data.severity !== undefined && allowed.data.severity !== before.severity) {
    await db('condition_symptom_readings').insert({
      symptom_id: symptom.id,
      severity: allowed.data.severity,
    });
  }
  res.json({ symptom });
});

conditionsRouter.delete('/:conditionId/symptoms/:symptomId', requireAuth, async (req, res) => {
  if (!(await findProfileCondition(String(req.params['conditionId']), String(req.params['id'])))) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' });
    return;
  }
  const deleted = await db('condition_symptoms')
    .where({ id: req.params['symptomId'], condition_id: req.params['conditionId'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Symptom not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Symptom removed.' });
});

const extractSchema = z.object({
  document_id: z.string().uuid(),
  category: z.string().optional(),
});

conditionsRouter.post('/extract-from-document', requireAuth, async (req, res) => {
  const parsed = extractSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const doc = await db('documents')
    .where({ id: parsed.data.document_id, care_profile_id: req.params['id'] })
    .first();
  if (!doc) {
    res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
    return;
  }

  const { isAiConfigured, complete } = await import('../services/aiProvider');
  if (!isAiConfigured()) {
    res.json({ extracted: {} });
    return;
  }

  const category = parsed.data.category ?? 'condition';
  const systemPrompt =
    `You are a medical document analyser for a care coordination platform. ` +
    `A user has uploaded or selected a document labelled "${doc.label}" (${doc.mime_type ?? 'unknown type'}). ` +
    `Extract structured data from the document metadata. ` +
    `Return ONLY a JSON object with these optional fields: ` +
    `name (condition name), neurotype (one of: autism, adhd, dyslexia, dyspraxia, dyscalculia, tourette, ocd, spd, other), ` +
    `diagnosis_date (YYYY-MM-DD), diagnosing_provider (name of clinician/practice), ` +
    `severity (mild/moderate/severe), notes (brief summary). ` +
    `Only include fields you can confidently determine. Return {} if nothing can be extracted.`;

  try {
    const result = await complete(
      systemPrompt,
      [{ role: 'user', content: `Document: "${doc.label}". Category: ${category}. Please extract any available data.` }],
      1024,
      'chat',
    );
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    const extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    res.json({ extracted });
  } catch {
    res.json({ extracted: {} });
  }
});
