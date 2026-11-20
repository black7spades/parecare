import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireProfileOwner } from '../middleware/permissions';
import {
  addEmergencyContact,
  EmergencyContactError,
  emergencyContactsFor,
  removeEmergencyContact,
  setEmergencyOrder,
  updateEmergencyContact,
  type EmergencyRef,
} from '../services/emergencyContacts';

/**
 * Who to call in an emergency, for one person. Each row points at someone
 * in the circle, the account holder or a contact, so their phone is read
 * from their own record; only someone not in PareCare is typed.
 */
export const emergencyContactsRouter = Router({ mergeParams: true });

const refSchema = z.union([
  z.object({ circle_member_id: z.string().uuid() }),
  z.object({ account_id: z.string().uuid() }),
  z.object({ provider_id: z.string().uuid() }),
  z.object({ name: z.string().trim().min(1).max(255), phone: z.string().trim().max(50).optional().nullable() }),
]);

const addSchema = z.object({
  ref: refSchema,
  relationship: z.string().trim().max(100).optional().nullable(),
  /** Their phone when their record has none: saved on their own record. */
  phone: z.string().trim().max(50).optional().nullable(),
  first: z.boolean().optional(),
});

const updateSchema = z.object({
  relationship: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  name: z.string().trim().max(255).optional().nullable(),
});

const answer = async (res: import('express').Response, profileId: string, status = 200, message?: string) => {
  res.status(status).json({ contacts: await emergencyContactsFor(profileId), ...(message ? { message } : {}) });
};

emergencyContactsRouter.get('/', requireAuth, async (req, res) => {
  await answer(res, req.params['id'] as string);
});

emergencyContactsRouter.post('/', requireAuth, requireProfileOwner('choose who to call in an emergency'), async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose who to call, or write their name and phone.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = req.params['id'] as string;
  try {
    await db.transaction((trx) => addEmergencyContact(trx, profileId, { ...parsed.data, ref: parsed.data.ref as EmergencyRef }, req.account!.id));
  } catch (err) {
    if (err instanceof EmergencyContactError) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
  await answer(res, profileId, 201);
});

emergencyContactsRouter.patch('/order', requireAuth, requireProfileOwner('change who to call first'), async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Give the order as a list.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = req.params['id'] as string;
  await setEmergencyOrder(db, profileId, parsed.data.ids);
  await answer(res, profileId);
});

emergencyContactsRouter.patch('/:contactId', requireAuth, requireProfileOwner('change an emergency contact'), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Check the relationship and phone.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = req.params['id'] as string;
  let ok: boolean;
  try {
    ok = await updateEmergencyContact(db, profileId, req.params['contactId'] as string, parsed.data, req.account!.id);
  } catch (err) {
    if (err instanceof EmergencyContactError) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
  if (!ok) {
    res.status(404).json({ error: 'That emergency contact is not on file any more.', code: 'NOT_FOUND' });
    return;
  }
  await answer(res, profileId);
});

emergencyContactsRouter.delete('/:contactId', requireAuth, requireProfileOwner('remove an emergency contact'), async (req, res) => {
  const profileId = req.params['id'] as string;
  const ok = await removeEmergencyContact(db, profileId, req.params['contactId'] as string);
  if (!ok) {
    res.status(404).json({ error: 'That emergency contact is not on file any more.', code: 'NOT_FOUND' });
    return;
  }
  await answer(res, profileId);
});
