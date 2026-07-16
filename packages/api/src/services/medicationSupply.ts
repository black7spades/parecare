/**
 * How a dose draws down a medication's supply.
 *
 * The rule, shared by every path that records a dose (the REST routes and the
 * conversational assistant), is: supply on hand goes down by the number of
 * units taken each time ([supply] - [units per dose]). The dose amount only
 * enters the equation for measured, liquid-style forms, where stock is held as
 * a volume and a dose removes that volume from it, such as an injection drawn
 * from a vial or a spoon of liquid from a bottle.
 */

import { db } from '../config/database';

// Forms given as a measured volume rather than a counted number of units.
const MEASURED_FORMS = new Set(['liquid', 'injection', 'cream', 'ointment', 'drops']);

export function isMeasuredForm(form: string | null | undefined): boolean {
  return MEASURED_FORMS.has(String(form ?? '').toLowerCase());
}

// How much one dose removes from supply: the unit count taken each time for a
// countable form, or units × dose volume for a measured, liquid-style form.
export function perDoseDrawdown(med: { form: string | null; units_per_dose: unknown; dose_amount: unknown }): number {
  const units = Number(med.units_per_dose) > 0 ? Number(med.units_per_dose) : 1;
  if (isMeasuredForm(med.form)) {
    const volume = parseFloat(String(med.dose_amount ?? '').replace(/[^0-9.]/g, ''));
    return units * (Number.isFinite(volume) && volume > 0 ? volume : 1);
  }
  return units;
}

/**
 * Remove the given amount from what is on hand, never below zero. The open
 * pack (supply_remaining) is used first; when it runs out and unopened packs
 * are on hand, the next pack is opened automatically: packs on hand goes
 * down by one and its units become the loose supply. Shared by every path
 * that records a dose.
 */
export async function drawDownOnHand(medId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const row = await db('medications')
    .where({ id: medId })
    .select('supply', 'supply_remaining', 'packs_on_hand')
    .first();
  if (!row || row.supply_remaining == null) return;
  let loose = Math.max(0, Number(row.supply_remaining));
  const packSize = row.supply == null ? null : Number(row.supply);
  const trackingPacks = row.packs_on_hand != null;
  let packs = trackingPacks ? Math.max(0, Number(row.packs_on_hand)) : 0;
  let need = amount;

  const takeLoose = Math.min(loose, need);
  loose -= takeLoose;
  need -= takeLoose;
  while (need > 0 && packs >= 1 && packSize != null && packSize > 0) {
    packs -= 1;
    loose += packSize;
    const take = Math.min(loose, need);
    loose -= take;
    need -= take;
  }

  await db('medications')
    .where({ id: medId })
    .update({
      supply_remaining: loose,
      ...(trackingPacks ? { packs_on_hand: packs } : {}),
    });
}
