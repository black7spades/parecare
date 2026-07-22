import { Knex } from 'knex';
import { getHealthCurrency } from '../config/settings';

/**
 * Health spend: the yearly cost of keeping someone's care going, worked out
 * from the prices already captured on their medications and treatments. Price
 * is stored per pack (medications) or per session (treatments); the yearly
 * figure is always derived here, never stored packed together with anything.
 *
 * A medication's yearly cost comes from how many packs a year its schedule
 * gets through: units used a year divided by the pack size, times the pack
 * price. A treatment's comes from its cost per session times the sessions a
 * year. Anything the maths cannot be done for (an as-needed medication with no
 * set schedule, a missing pack size, a treatment with no session count) has no
 * yearly figure rather than a wrong one.
 */

export const DAYS_PER_YEAR = 365;

const CURRENCY_SYMBOLS: Record<string, string> = {
  AUD: '$',
  USD: '$',
  GBP: '£',
  EUR: '€',
  NZD: '$',
  CAD: '$',
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? '$';
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface MedForSpend {
  price: unknown;
  supply: unknown; // pack size: units a full pack provides
  units_per_dose: unknown;
  schedule_times: unknown; // array of HH:MM, or null
  as_needed?: unknown;
}

/**
 * Yearly cost of a medication, or null when it cannot be worked out. Needs a
 * pack price, a pack size, a per-dose amount, and a daily schedule; an
 * as-needed medication has no predictable yearly count, so it returns null.
 */
export function annualMedicationCost(med: MedForSpend): number | null {
  const price = toNum(med.price);
  const packSize = toNum(med.supply);
  const perDose = toNum(med.units_per_dose);
  const times = Array.isArray(med.schedule_times) ? med.schedule_times.length : 0;
  if (med.as_needed) return null;
  if (price === null || price <= 0) return null;
  if (packSize === null || packSize <= 0) return null;
  if (perDose === null || perDose <= 0) return null;
  if (times <= 0) return null;
  const unitsPerYear = perDose * times * DAYS_PER_YEAR;
  const packsPerYear = unitsPerYear / packSize;
  return round2(price * packsPerYear);
}

export interface TreatmentForSpend {
  price: unknown;
  sessions_per_year: unknown;
}

/**
 * Yearly cost of a treatment, or null when it cannot be worked out. Needs a
 * per-session price and how many sessions are expected in a year.
 */
export function annualTreatmentCost(t: TreatmentForSpend): number | null {
  const price = toNum(t.price);
  const sessions = toNum(t.sessions_per_year);
  if (price === null || price <= 0) return null;
  if (sessions === null || sessions <= 0) return null;
  return round2(price * sessions);
}

export interface MedicationSpendLine {
  id: string;
  name: string;
  price: number | null;
  annual_cost: number | null;
}

export interface TreatmentSpendLine {
  id: string;
  name: string;
  price: number | null;
  sessions_per_year: number | null;
  annual_cost: number | null;
}

export interface ProfileHealthSpend {
  currency: string;
  currency_symbol: string;
  medications: MedicationSpendLine[];
  treatments: TreatmentSpendLine[];
  medication_annual_total: number;
  treatment_annual_total: number;
  annual_total: number;
}

/**
 * The full yearly spend for one person or pet: every active medication and
 * treatment with a price, each line's own yearly cost, and the rolled-up
 * medication, treatment and combined totals.
 */
export async function profileHealthSpend(profileId: string, db: Knex): Promise<ProfileHealthSpend> {
  const currency = getHealthCurrency();
  const meds = await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where('m.care_profile_id', profileId)
    .andWhere('m.active', true)
    .select('m.id', 'c.name as name', 'm.price', 'm.supply', 'm.units_per_dose', 'm.schedule_times', 'm.as_needed');

  const treatments = await db('treatments')
    .where('care_profile_id', profileId)
    .andWhere('active', true)
    .select('id', 'name', 'price', 'sessions_per_year');

  const medLines: MedicationSpendLine[] = meds.map((m) => ({
    id: m.id,
    name: m.name,
    price: toNum(m.price),
    annual_cost: annualMedicationCost(m),
  }));
  const treatmentLines: TreatmentSpendLine[] = treatments.map((t) => ({
    id: t.id,
    name: t.name,
    price: toNum(t.price),
    sessions_per_year: toNum(t.sessions_per_year),
    annual_cost: annualTreatmentCost(t),
  }));

  const medicationTotal = round2(medLines.reduce((sum, l) => sum + (l.annual_cost ?? 0), 0));
  const treatmentTotal = round2(treatmentLines.reduce((sum, l) => sum + (l.annual_cost ?? 0), 0));

  return {
    currency,
    currency_symbol: currencySymbol(currency),
    medications: medLines,
    treatments: treatmentLines,
    medication_annual_total: medicationTotal,
    treatment_annual_total: treatmentTotal,
    annual_total: round2(medicationTotal + treatmentTotal),
  };
}
