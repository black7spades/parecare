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
