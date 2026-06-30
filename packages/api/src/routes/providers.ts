import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import type { Provider } from '../types';

export const providersRouter = Router({ mergeParams: true });

const providerSchema = z.object({
  provider_type: z.enum([
    'gp',
    'specialist',
    'pharmacy',
    'care_facility',
    'allied_health',
    'legal',
    'financial',
    'social_worker',
    'other',
  ]),
  name: z.string().min(1).max(255),
  organisation: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

providersRouter.get('/', requireAuth, async (req, res) => {
  const providers = await db<Provider>('providers')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('name', 'asc');
  res.json({ providers });
});

providersRouter.post('/', requireAuth, async (req, res) => {
  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const [provider] = await db<Provider>('providers')
    .insert({ care_profile_id: req.params['id'], ...parsed.data })
    .returning('*');

  res.status(201).json({ provider });
});

providersRouter.patch('/:providerId', requireAuth, async (req, res) => {
  const parsed = providerSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [provider] = await db<Provider>('providers')
    .where({ id: req.params['providerId'], care_profile_id: req.params['id'] })
    .update(parsed.data)
    .returning('*');

  if (!provider) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ provider });
});

providersRouter.delete('/:providerId', requireAuth, async (req, res) => {
  const affected = await db('providers')
    .where({ id: req.params['providerId'], care_profile_id: req.params['id'] })
    .delete();
  if (!affected) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Provider removed.' });
});
