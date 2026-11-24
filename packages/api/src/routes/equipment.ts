import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { accountIdForProfile } from '../services/documentCategories';
import { doneFromItem, journeyItemRef } from '../services/journeyItems';
import { assetColumns, assetOut, assetSchema, assetSupplierColumns, equipmentFor, syncEquipmentTasks } from '../services/equipment';

/**
 * One person's equipment: the same records as the account's equipment
 * register, linked to this person. Adding one here files it in the register
 * and links it; Remove unlinks it from this person and keeps the record.
 */
export const equipmentRouter = Router({ mergeParams: true });

const profileIdOf = (req: { params: unknown }) => String((req.params as Record<string, string>)['id']);

equipmentRouter.get('/', requireAuth, async (req, res) => {
  res.json({ equipment: await equipmentFor(db, profileIdOf(req)) });
});

const createSchema = assetSchema.extend({
  // Saved from an "Equipment to get" step: the step is done once it is on file.
  from_task_id: z.string().uuid().optional().nullable(),
  // Saved from a journey step such as "Keep an equipment list": the step is done.
  from_journey_item_id: journeyItemRef,
});

equipmentRouter.post('/', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Write the name of the equipment first, then save.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  const accountId = (await accountIdForProfile(profileId, db))!;
  const { from_task_id, from_journey_item_id, ...data } = parsed.data;
  const asset = await db.transaction(async (trx) => {
    const supplier = await assetSupplierColumns(trx, accountId, data);
    const [row] = await trx('assets').insert({ account_id: accountId, ...assetColumns(data), ...(supplier ?? {}) }).returning('*');
    await trx('care_profile_assets').insert({ care_profile_id: profileId, asset_id: row.id }).onConflict(['care_profile_id', 'asset_id']).ignore();
    if (from_task_id) {
      await trx('reminders')
        .where({ id: from_task_id, care_profile_id: profileId })
        .update({ asset_id: row.id, completed: true, completed_at: trx.fn.now(), completed_by_account_id: req.account!.id });
    }
    await syncEquipmentTasks(trx, row.id, req.account!.id);
    await doneFromItem(trx, { profileId, itemId: from_journey_item_id, actorId: req.account!.id, record: { kind: 'assets', id: row.id } });
    return row as Record<string, unknown> & { id: string };
  });
  res.status(201).json({ asset: await assetOut(asset) });
});

async function linked(profileId: string, assetId: string) {
  return db('care_profile_assets').where({ care_profile_id: profileId, asset_id: assetId }).first('id');
}

equipmentRouter.patch('/:assetId', requireAuth, async (req, res) => {
  const parsed = assetSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read. Check the dates and the price.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = profileIdOf(req);
  const assetId = String(req.params['assetId']);
  if (!(await linked(profileId, assetId))) {
    res.status(404).json({ error: 'That equipment is not linked to this person.', code: 'NOT_FOUND' });
    return;
  }
  const current = (await db('assets').where({ id: assetId }).first('account_id')) as { account_id: string };
  const asset = await db.transaction(async (trx) => {
    const supplier = await assetSupplierColumns(trx, current.account_id, parsed.data);
    const [row] = await trx('assets').where({ id: assetId }).update({ ...assetColumns(parsed.data), ...(supplier ?? {}) }).returning('*');
    await syncEquipmentTasks(trx, assetId, req.account!.id);
    return row as Record<string, unknown>;
  });
  res.json({ asset: await assetOut(asset) });
});

equipmentRouter.delete('/:assetId', requireAuth, async (req, res) => {
  const profileId = profileIdOf(req);
  const assetId = String(req.params['assetId']);
  const n = await db('care_profile_assets').where({ care_profile_id: profileId, asset_id: assetId }).delete();
  if (!n) {
    res.status(404).json({ error: 'That equipment is not linked to this person.', code: 'NOT_FOUND' });
    return;
  }
  // Its open return and service tasks were for this person.
  await db('reminders').where({ care_profile_id: profileId, asset_id: assetId, completed: false }).delete();
  res.json({ message: 'Removed from their equipment. It is still in the equipment register.' });
});
