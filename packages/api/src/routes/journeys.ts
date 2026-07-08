import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import {
  enrolProfileInTemplate,
  phaseState,
  setCurrentJourneyPhase,
  syncLegacyPhaseFromJourney,
  type JourneyPhaseRow,
} from '../services/journeys';

/**
 * A person's care journeys: enrolment from the library, bespoke
 * journeys, phase progression with locked history, per-person
 * personalisation of phases, and handovers between journeys. Mounted
 * under /care-profiles/:id with the standard access middleware.
 */
export const journeysRouter = Router({ mergeParams: true });

async function loadJourney(profileId: string, journeyId: string) {
  return db('care_journeys').where({ id: journeyId, care_profile_id: profileId }).first();
}

async function journeyWithPhases(journey: { id: string; template_id?: string | null }) {
  const phases: JourneyPhaseRow[] = await db('care_journey_phases')
    .where({ care_journey_id: journey.id as string })
    .orderBy('sort_order', 'asc');
  const counts = await db('checklist_items')
    .whereIn('care_journey_phase_id', phases.map((p) => p.id))
    .groupBy('care_journey_phase_id')
    .select('care_journey_phase_id')
    .select(db.raw('count(*) as total, count(*) filter (where completed) as done'));
  const countByPhase = new Map(counts.map((c) => [String(c.care_journey_phase_id), c]));
  let handovers: Array<Record<string, unknown>> = [];
  if (journey.template_id) {
    handovers = await db('journey_template_handovers')
      .join('journey_templates as target', 'journey_template_handovers.to_template_id', 'target.id')
      .where('journey_template_handovers.from_template_id', journey.template_id as string)
      .where('target.status', 'published')
      .select(
        'journey_template_handovers.id',
        'journey_template_handovers.to_template_id',
        'journey_template_handovers.label',
        'target.name as to_template_name'
      );
  }
  return {
    ...journey,
    phases: phases.map((p) => {
      const c = countByPhase.get(p.id) as { total?: unknown; done?: unknown } | undefined;
      return { ...p, state: phaseState(p), task_count: Number(c?.total ?? 0), tasks_done: Number(c?.done ?? 0) };
    }),
    handovers,
  };
}

journeysRouter.get('/', requireAuth, async (req, res) => {
  const journeys = await db('care_journeys')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('started_at', 'asc');
  res.json({ journeys: await Promise.all(journeys.map((j) => journeyWithPhases(j))) });
});

// Enrol in a template, or start a bespoke journey with its own phases.
journeysRouter.post('/', requireAuth, async (req, res) => {
  const schema = z.union([
    z.object({ template_id: z.string().uuid(), start_phase_sort_order: z.number().int().min(0).optional() }),
    z.object({
      name: z.string().min(1).max(150),
      phases: z
        .array(z.object({ name: z.string().min(1).max(150), description: z.string().max(2000).optional().nullable() }))
        .min(1),
    }),
  ]);
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const journey = await db.transaction(async (trx) => {
    if ('template_id' in parsed.data) {
      const template = await trx('journey_templates')
        .where({ id: parsed.data.template_id, status: 'published' })
        .first();
      if (!template) return null;
      return enrolProfileInTemplate(trx, {
        careProfileId: req.params['id'],
        templateId: template.id,
        createdByAccountId: req.account!.id,
        startAtSortOrder: parsed.data.start_phase_sort_order,
      });
    }
    const [row] = await trx('care_journeys')
      .insert({
        care_profile_id: req.params['id'],
        template_id: null,
        name: parsed.data.name,
        status: 'active',
        created_by_account_id: req.account!.id,
      })
      .returning('*');
    await trx('care_journey_phases').insert(
      parsed.data.phases.map((p, i) => ({
        care_journey_id: row.id,
        name: p.name,
        description: p.description ?? null,
        sort_order: i,
        entered_at: i === 0 ? new Date() : null,
      }))
    );
    return row;
  });

  if (!journey) {
    res.status(404).json({ error: 'Journey not found in the library', code: 'NOT_FOUND' });
    return;
  }
  res.status(201).json({ journey: await journeyWithPhases(journey) });
});

journeysRouter.patch('/:journeyId', requireAuth, async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(150).optional(),
    status: z.enum(['active', 'paused', 'completed']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const journey = await loadJourney(req.params['id'], req.params['journeyId']);
  if (!journey) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  const update: Record<string, unknown> = { ...parsed.data, updated_at: db.fn.now() };
  if (parsed.data.status === 'completed' && journey.status !== 'completed') update.ended_at = db.fn.now();
  if (parsed.data.status === 'active') update.ended_at = null;
  const [updated] = await db('care_journeys').where({ id: journey.id }).update(update).returning('*');
  res.json({ journey: await journeyWithPhases(updated) });
});

// The journey moves forward only; a super admin can reopen an earlier
// phase to correct records, exactly like the legacy pipeline.
journeysRouter.post('/:journeyId/set-phase', requireAuth, async (req, res) => {
  const parsed = z.object({ phase_id: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const journey = await loadJourney(req.params['id'], req.params['journeyId']);
  if (!journey) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  const result = await db.transaction(async (trx) =>
    setCurrentJourneyPhase(trx, {
      journey,
      targetPhaseId: parsed.data.phase_id,
      actorAccountId: req.account!.id,
      actorIsSuperAdmin: req.account!.role === 'super_admin',
    })
  );
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') {
      res.status(404).json({ error: 'Phase not found', code: 'NOT_FOUND' });
    } else {
      res.status(403).json({
        error: 'Journeys only move forward. A super admin can reopen an earlier phase to correct records.',
        code: 'PHASE_LOCKED',
      });
    }
    return;
  }
  res.json({ journey: await journeyWithPhases((await loadJourney(req.params['id'], req.params['journeyId']))!) });
});

// Hand over to another journey: this one completes with a link to the
// new journey, chosen by a human from the labelled options.
journeysRouter.post('/:journeyId/handover', requireAuth, async (req, res) => {
  const parsed = z.object({ to_template_id: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const journey = await loadJourney(req.params['id'], req.params['journeyId']);
  if (!journey) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  const target = await db('journey_templates').where({ id: parsed.data.to_template_id, status: 'published' }).first();
  if (!target) {
    res.status(404).json({ error: 'Journey not found in the library', code: 'NOT_FOUND' });
    return;
  }
  const created = await db.transaction(async (trx) => {
    const next = await enrolProfileInTemplate(trx, {
      careProfileId: req.params['id'],
      templateId: target.id,
      createdByAccountId: req.account!.id,
    });
    await trx('care_journeys')
      .where({ id: journey.id })
      .update({ status: 'handed_over', ended_at: trx.fn.now(), handed_over_to_journey_id: next.id, updated_at: trx.fn.now() });
    return next;
  });
  res.status(201).json({ journey: await journeyWithPhases(created) });
});

// ---------------------------------------------------------------- phases
// Personalising one person's journey: their journey is a copy, so these
// edits never touch the template.

journeysRouter.post('/:journeyId/phases', requireAuth, async (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(1).max(150),
      description: z.string().max(2000).optional().nullable(),
      sort_order: z.number().int().min(0).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const journey = await loadJourney(req.params['id'], req.params['journeyId']);
  if (!journey) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  const maxRow = await db('care_journey_phases')
    .where({ care_journey_id: journey.id })
    .max('sort_order as max')
    .first();
  const [phase] = await db('care_journey_phases')
    .insert({
      care_journey_id: journey.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      sort_order: parsed.data.sort_order ?? Number(maxRow?.max ?? -1) + 1,
    })
    .returning('*');
  res.status(201).json({ phase: { ...phase, state: phaseState(phase) } });
});

journeysRouter.patch('/:journeyId/phases/:phaseId', requireAuth, async (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(1).max(150).optional(),
      description: z.string().max(2000).optional().nullable(),
      sort_order: z.number().int().min(0).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const journey = await loadJourney(req.params['id'], req.params['journeyId']);
  if (!journey) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  const phase = await db('care_journey_phases').where({ id: req.params['phaseId'], care_journey_id: journey.id }).first();
  if (!phase) {
    res.status(404).json({ error: 'Phase not found', code: 'NOT_FOUND' });
    return;
  }
  if (phase.locked_at && req.account!.role !== 'super_admin') {
    res.status(403).json({ error: 'This phase is locked as a record. A super admin can reopen it.', code: 'PHASE_LOCKED' });
    return;
  }
  const [updated] = await db('care_journey_phases').where({ id: phase.id }).update(parsed.data).returning('*');
  res.json({ phase: { ...updated, state: phaseState(updated) } });
});

// A phase with completed items is part of the record and cannot be
// removed; locked phases likewise.
journeysRouter.delete('/:journeyId/phases/:phaseId', requireAuth, async (req, res) => {
  const journey = await loadJourney(req.params['id'], req.params['journeyId']);
  if (!journey) {
    res.status(404).json({ error: 'Journey not found', code: 'NOT_FOUND' });
    return;
  }
  const phase = await db('care_journey_phases').where({ id: req.params['phaseId'], care_journey_id: journey.id }).first();
  if (!phase) {
    res.status(404).json({ error: 'Phase not found', code: 'NOT_FOUND' });
    return;
  }
  if (phase.locked_at) {
    res.status(403).json({ error: 'Locked phases are a permanent record and cannot be removed.', code: 'PHASE_LOCKED' });
    return;
  }
  const completed = await db('checklist_items')
    .where({ care_journey_phase_id: phase.id, completed: true })
    .count('id as count')
    .first();
  if (Number(completed?.count ?? 0) > 0) {
    res.status(400).json({
      error: 'This phase holds completed items, which are part of the record. Un-complete them first if this is a correction.',
      code: 'PHASE_HAS_RECORD',
    });
    return;
  }
  await db.transaction(async (trx) => {
    await trx('care_journey_phases').where({ id: phase.id }).delete();
    await syncLegacyPhaseFromJourney(trx, journey.id);
  });
  res.json({ message: 'Phase removed.' });
});
