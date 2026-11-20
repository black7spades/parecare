import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { identifiersFor, saveIdentifiers, IDENTIFIER_FIELDS } from '../services/identifiers';

/**
 * A person's ID numbers: Medicare, the Individual Healthcare Identifier,
 * DVA, NDIS, their health fund and My Aged Care. Each number is checked; one
 * that does not look right is not saved and says what it should look like,
 * and every other number still saves.
 */
export const identifiersRouter = Router({ mergeParams: true });

identifiersRouter.get('/', requireAuth, async (req, res) => {
  res.json({ identifiers: await identifiersFor(String(req.params['id'])) });
});

const field = z.union([z.string().max(200), z.number(), z.null()]).optional();
const putSchema = z.object(
  Object.fromEntries(IDENTIFIER_FIELDS.map((k) => [k, field])) as Record<(typeof IDENTIFIER_FIELDS)[number], typeof field>
);

identifiersRouter.put('/', requireAuth, async (req, res) => {
  const parsed = putSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those ID numbers could not be read. Type each number in its own box.', code: 'VALIDATION_ERROR' });
    return;
  }
  const result = await saveIdentifiers(String(req.params['id']), req.account!.id, parsed.data);
  res.json(result);
});
