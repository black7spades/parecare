import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { resolveOptions } from './optionCatalogue';
import type { CarePlan } from '../types';

export const carePlanRouter = Router({ mergeParams: true });

/**
 * The care plan holds only what has no first-class table of its own:
 * day-to-day needs (each a list of values picked from the shared option
 * catalogue), the advance care directive facts, and emergency contacts.
 * Conditions live in medical_conditions, medications in medications, and
 * the GP in providers; the plan page surfaces those, it does not store
 * them. The legacy conditions/medications/gp columns are never written.
 */
const planSchema = z.object({
  dietary_requirements: z.array(z.string().min(1).max(255)).default([]),
  mobility_aids: z.array(z.string().min(1).max(255)).default([]),
  communication_needs: z.array(z.string().min(1).max(255)).default([]),
  advance_care_directive: z.boolean().default(false),
  advance_care_directive_location: z.string().max(255).optional().nullable(),
  emergency_contacts: z
    .array(
      z.object({
        name: z.string(),
        relationship: z.string().optional(),
        phone: z.string(),
      })
    )
    .default([]),
});

carePlanRouter.get('/', requireAuth, async (req, res) => {
  const plan = await db<CarePlan>('care_plans')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('updated_at', 'desc')
    .first();
  res.json({ plan: plan ?? null });
});

carePlanRouter.put('/', requireAuth, async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const existing = await db('care_plans').where({ care_profile_id: req.params['id'] }).first();

  // dietary_requirements and mobility_aids are text[] columns, which knex
  // maps from plain JS arrays; the jsonb columns need explicit JSON
  // serialisation instead, because knex would treat their raw JS arrays as
  // Postgres array literals and corrupt the stored value.
  const values = {
    advance_care_directive: parsed.data.advance_care_directive,
    advance_care_directive_location: parsed.data.advance_care_directive_location ?? null,
    dietary_requirements: parsed.data.dietary_requirements,
    mobility_aids: parsed.data.mobility_aids,
    communication_needs: db.raw('?::jsonb', [JSON.stringify(parsed.data.communication_needs)]),
    emergency_contacts: db.raw('?::jsonb', [JSON.stringify(parsed.data.emergency_contacts)]),
  };

  let plan: CarePlan;
  if (existing) {
    const [updated] = await db<CarePlan>('care_plans')
      .where({ id: existing.id })
      .update({ ...values, updated_at: db.fn.now() })
      .returning('*');
    plan = updated;
  } else {
    const [created] = await db<CarePlan>('care_plans')
      .insert({ care_profile_id: req.params['id'], ...values })
      .returning('*');
    plan = created;
  }

  // Anything picked that is not in the shared lists yet joins them, so it
  // is offered to everyone from now on.
  await Promise.all([
    resolveOptions('dietary_requirement', parsed.data.dietary_requirements, req.account!.id),
    resolveOptions('mobility_aid', parsed.data.mobility_aids, req.account!.id),
    resolveOptions('communication_need', parsed.data.communication_needs, req.account!.id),
    resolveOptions('directive_location', [parsed.data.advance_care_directive_location], req.account!.id),
  ]);

  res.json({ plan });
});
