import { Router } from 'express';
import { z } from 'zod';
import type { Knex } from 'knex';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

/**
 * The journey template library. Everyone signed in can browse published
 * templates to enrol from; admins author, clone, compose, publish and
 * archive. System templates can only be edited by super admins, and
 * every enrolment is a copy, so library edits never touch anyone's
 * journey.
 */
export const journeyTemplatesRouter = Router();

const isAdmin = (role?: string) => role === 'admin' || role === 'super_admin';

journeyTemplatesRouter.get('/', requireAuth, async (req, res) => {
  const includeAll = req.query['all'] === '1' && isAdmin(req.account?.role);
  const query = db('journey_templates').orderBy('name', 'asc');
  if (!includeAll) query.where({ status: 'published' });
  const templates = await query;
  const ids = templates.map((t) => t.id);

  const [stageLinks, phaseCounts, taskCounts] = await Promise.all([
    db('journey_template_life_stages').whereIn('template_id', ids).select('template_id', 'life_stage_id'),
    db('journey_template_phases').whereIn('template_id', ids).groupBy('template_id').select('template_id').count('id as count'),
    db('journey_template_tasks')
      .join('journey_template_phases', 'journey_template_tasks.template_phase_id', 'journey_template_phases.id')
      .whereIn('journey_template_phases.template_id', ids)
      .groupBy('journey_template_phases.template_id')
      .select('journey_template_phases.template_id')
      .count('journey_template_tasks.id as count'),
  ]);
  const stagesByTemplate = new Map<string, string[]>();
  for (const link of stageLinks) {
    const arr = stagesByTemplate.get(link.template_id) ?? [];
    arr.push(link.life_stage_id);
    stagesByTemplate.set(link.template_id, arr);
  }
  const phaseCountById = new Map(phaseCounts.map((c) => [String(c.template_id), Number(c.count)]));
  const taskCountById = new Map(taskCounts.map((c) => [String(c.template_id), Number(c.count)]));

  res.json({
    templates: templates.map((t) => ({
      ...t,
      life_stage_ids: stagesByTemplate.get(t.id) ?? [],
      phase_count: phaseCountById.get(t.id) ?? 0,
      task_count: taskCountById.get(t.id) ?? 0,
    })),
  });
});

async function loadFullTemplate(templateId: string) {
  const template = await db('journey_templates').where({ id: templateId }).first();
  if (!template) return null;
  const [stageLinks, phases, handovers] = await Promise.all([
    db('journey_template_life_stages').where({ template_id: templateId }).select('life_stage_id'),
    db('journey_template_phases').where({ template_id: templateId }).orderBy('sort_order', 'asc'),
    db('journey_template_handovers')
      .join('journey_templates as target', 'journey_template_handovers.to_template_id', 'target.id')
      .where({ from_template_id: templateId })
      .select('journey_template_handovers.id', 'journey_template_handovers.to_template_id', 'journey_template_handovers.label', 'target.name as to_template_name'),
  ]);
  const tasks = await db('journey_template_tasks')
    .whereIn('template_phase_id', phases.map((p) => p.id))
    .orderBy('sort_order', 'asc');
  const tasksByPhase = new Map<string, unknown[]>();
  for (const task of tasks) {
    const arr = tasksByPhase.get(task.template_phase_id) ?? [];
    arr.push(task);
    tasksByPhase.set(task.template_phase_id, arr);
  }
  return {
    ...template,
    life_stage_ids: stageLinks.map((l) => l.life_stage_id),
    phases: phases.map((p) => ({ ...p, tasks: tasksByPhase.get(p.id) ?? [] })),
    handovers,
  };
}

journeyTemplatesRouter.get('/:templateId', requireAuth, async (req, res) => {
  const template = await loadFullTemplate(req.params['templateId']);
  if (!template || (template.status !== 'published' && !isAdmin(req.account?.role))) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ template });
});

const taskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  is_milestone: z.boolean().optional(),
});
const phaseSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional().nullable(),
  tasks: z.array(taskSchema).optional(),
});
const templateSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional().nullable(),
  kind: z.enum(['life_stage', 'condition', 'event', 'end_of_life']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  life_stage_ids: z.array(z.string().uuid()).optional(),
  phases: z.array(phaseSchema).min(1).optional(),
  handovers: z.array(z.object({ to_template_id: z.string().uuid(), label: z.string().min(1).max(255) })).optional(),
  source_template_id: z.string().uuid().optional().nullable(),
});

type TemplateInput = Partial<z.infer<typeof templateSchema>>;

async function writeTemplateChildren(trx: Knex.Transaction, templateId: string, input: TemplateInput) {
  if (input.life_stage_ids) {
    await trx('journey_template_life_stages').where({ template_id: templateId }).delete();
    if (input.life_stage_ids.length > 0) {
      await trx('journey_template_life_stages').insert(
        input.life_stage_ids.map((life_stage_id) => ({ template_id: templateId, life_stage_id }))
      );
    }
  }
  if (input.phases) {
    await trx('journey_template_phases').where({ template_id: templateId }).delete();
    for (const [i, phase] of input.phases.entries()) {
      const [phaseRow] = await trx('journey_template_phases')
        .insert({
          template_id: templateId,
          name: phase.name,
          description: phase.description ?? null,
          sort_order: i,
        })
        .returning('id');
      const tasks = phase.tasks ?? [];
      if (tasks.length > 0) {
        await trx('journey_template_tasks').insert(
          tasks.map((task, j) => ({
            template_phase_id: phaseRow.id,
            title: task.title,
            description: task.description ?? null,
            is_milestone: task.is_milestone ?? false,
            sort_order: j,
          }))
        );
      }
    }
  }
  if (input.handovers) {
    await trx('journey_template_handovers').where({ from_template_id: templateId }).delete();
    if (input.handovers.length > 0) {
      await trx('journey_template_handovers').insert(
        input.handovers.map((h) => ({ from_template_id: templateId, to_template_id: h.to_template_id, label: h.label }))
      );
    }
  }
}

// Brand-new library items, built from scratch or composed from
// cherry-picked phases the client sends along.
journeyTemplatesRouter.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const template = await db.transaction(async (trx) => {
    const [row] = await trx('journey_templates')
      .insert({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        kind: parsed.data.kind ?? 'life_stage',
        status: parsed.data.status ?? 'draft',
        source_template_id: parsed.data.source_template_id ?? null,
        created_by_account_id: req.account!.id,
      })
      .returning('*');
    await writeTemplateChildren(trx, row.id, parsed.data);
    return row;
  });
  res.status(201).json({ template: await loadFullTemplate(template.id) });
});

journeyTemplatesRouter.patch('/:templateId', requireAuth, requireRole('admin'), async (req, res) => {
  const existing = await db('journey_templates').where({ id: req.params['templateId'] }).first();
  if (!existing) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  if (existing.is_system && req.account!.role !== 'super_admin') {
    res.status(403).json({
      error: 'Built-in journeys can only be changed by a super admin. Clone it to make your own version.',
      code: 'SYSTEM_TEMPLATE',
    });
    return;
  }
  const parsed = templateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  await db.transaction(async (trx) => {
    const fields: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'kind', 'status'] as const) {
      if (key in parsed.data) fields[key] = parsed.data[key];
    }
    if (Object.keys(fields).length > 0) {
      await trx('journey_templates').where({ id: existing.id }).update({ ...fields, updated_at: trx.fn.now() });
    }
    await writeTemplateChildren(trx, existing.id, parsed.data);
  });
  res.json({ template: await loadFullTemplate(existing.id) });
});

journeyTemplatesRouter.post('/:templateId/clone', requireAuth, requireRole('admin'), async (req, res) => {
  const source = await loadFullTemplate(req.params['templateId']);
  if (!source) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  const template = await db.transaction(async (trx) => {
    const [row] = await trx('journey_templates')
      .insert({
        name: `${source.name} copy`,
        description: source.description,
        kind: source.kind,
        status: 'draft',
        source_template_id: source.id,
        created_by_account_id: req.account!.id,
      })
      .returning('*');
    await writeTemplateChildren(trx, row.id, {
      name: row.name,
      life_stage_ids: source.life_stage_ids,
      phases: source.phases.map((p: { name: string; description: string | null; tasks: Array<{ title: string; description: string | null; is_milestone: boolean }> }) => ({
        name: p.name,
        description: p.description,
        tasks: p.tasks.map((task) => ({ title: task.title, description: task.description, is_milestone: task.is_milestone })),
      })),
      handovers: source.handovers.map((h: { to_template_id: string; label: string }) => ({ to_template_id: h.to_template_id, label: h.label })),
    });
    return row;
  });
  res.status(201).json({ template: await loadFullTemplate(template.id) });
});

// Deleting is for unused drafts; anything enrolled or published archives
// instead, so the library never breaks a person's journey record.
journeyTemplatesRouter.delete('/:templateId', requireAuth, requireRole('admin'), async (req, res) => {
  const existing = await db('journey_templates').where({ id: req.params['templateId'] }).first();
  if (!existing) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  if (existing.is_system) {
    res.status(403).json({ error: 'Built-in journeys cannot be deleted. Archive to hide them.', code: 'SYSTEM_TEMPLATE' });
    return;
  }
  const enrolments = await db('care_journeys').where({ template_id: existing.id }).count('id as count').first();
  if (existing.status !== 'draft' || Number(enrolments?.count ?? 0) > 0) {
    res.status(400).json({
      error: 'This journey has been published or used. Archive it instead so existing records keep their source.',
      code: 'TEMPLATE_IN_USE',
    });
    return;
  }
  await db('journey_templates').where({ id: existing.id }).delete();
  res.json({ message: 'Journey deleted.' });
});
