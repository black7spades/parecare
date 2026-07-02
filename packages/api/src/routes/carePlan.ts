import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import type { CarePlan } from '../types';

export const carePlanRouter = Router({ mergeParams: true });

const planSchema = z.object({
  conditions: z.array(z.string()).default([]),
  medications: z
    .array(
      z.object({
        name: z.string(),
        dose: z.string().optional(),
        frequency: z.string().optional(),
        prescriber: z.string().optional(),
      })
    )
    .default([]),
  dietary_requirements: z.array(z.string()).default([]),
  mobility_aids: z.array(z.string()).default([]),
  communication_preferences: z.string().optional().nullable(),
  advance_care_directive: z.boolean().default(false),
  advance_care_directive_location: z.string().optional().nullable(),
  gp_name: z.string().max(255).optional().nullable(),
  gp_practice: z.string().max(255).optional().nullable(),
  gp_phone: z.string().max(50).optional().nullable(),
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

  // jsonb columns need explicit JSON serialisation — knex treats raw JS
  // arrays as Postgres array literals, which corrupts the stored value.
  const values = {
    ...parsed.data,
    medications: db.raw('?::jsonb', [JSON.stringify(parsed.data.medications)]),
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

  res.json({ plan });
});
