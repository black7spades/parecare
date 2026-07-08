import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

/**
 * Life stages: editable reference data that organises the journey
 * template library and drives suggestions. Anyone signed in can read
 * them; admins shape them.
 */
export const lifeStagesRouter = Router();

lifeStagesRouter.get('/', requireAuth, async (_req, res) => {
  const stages = await db('life_stages').orderBy('sort_order', 'asc');
  const counts = await db('journey_template_life_stages')
    .join('journey_templates', 'journey_template_life_stages.template_id', 'journey_templates.id')
    .where('journey_templates.status', 'published')
    .groupBy('journey_template_life_stages.life_stage_id')
    .select('journey_template_life_stages.life_stage_id')
    .count('journey_template_life_stages.id as count');
  const countById = new Map(counts.map((c) => [String(c.life_stage_id), Number(c.count)]));
  res.json({ stages: stages.map((s) => ({ ...s, template_count: countById.get(s.id) ?? 0 })) });
});

const stageSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional().nullable(),
  min_age_years: z.number().int().min(0).max(150).optional().nullable(),
  max_age_years: z.number().int().min(0).max(150).optional().nullable(),
  applies_before_birth: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  retired: z.boolean().optional(),
});

lifeStagesRouter.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [stage] = await db('life_stages')
    .insert({ ...parsed.data, created_by_account_id: req.account!.id })
    .returning('*');
  res.status(201).json({ stage });
});

lifeStagesRouter.patch('/:stageId', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = stageSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [stage] = await db('life_stages')
    .where({ id: req.params['stageId'] })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!stage) {
    res.status(404).json({ error: 'Life stage not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ stage });
});

// A stage with templates assigned cannot be deleted, only retired or
// edited, so no template silently loses its place in the library.
lifeStagesRouter.delete('/:stageId', requireAuth, requireRole('admin'), async (req, res) => {
  const assigned = await db('journey_template_life_stages')
    .where({ life_stage_id: req.params['stageId'] })
    .count('id as count')
    .first();
  if (Number(assigned?.count ?? 0) > 0) {
    res.status(400).json({
      error: 'This life stage still has journeys assigned to it. Reassign or unassign them first, or retire the stage instead.',
      code: 'STAGE_IN_USE',
    });
    return;
  }
  const deleted = await db('life_stages').where({ id: req.params['stageId'] }).delete();
  if (!deleted) {
    res.status(404).json({ error: 'Life stage not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Life stage deleted.' });
});
