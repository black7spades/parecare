import type { Knex } from 'knex';
import { db } from '../config/database';
import { contactSummaries, mainContact, supplierContacts, type ContactSummary } from './professionals';
import { perDoseDrawdown } from './medicationSupply';

type Conn = Knex | Knex.Transaction;

/**
 * What an alert offers to do next, so it never stops at a list: call, email
 * or order from the right place, book, or open the record.
 */
export interface NextAction {
  kind: 'call' | 'email' | 'order_online' | 'book' | 'mark_ordered' | 'log_doses' | 'open';
  label: string;
  href: string | null;
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * The quickest way to reach someone: their order site, else a call, else an
 * email (with a ready subject and body when given).
 */
export function reachAction(c: ContactSummary | null, email?: { subject: string; body: string }): NextAction | null {
  if (!c) return null;
  if (c.order_link) return { kind: 'order_online', label: `Order online from ${c.name}`, href: c.order_link };
  if (c.phone) return { kind: 'call', label: `Call ${c.name}`, href: telHref(c.phone) };
  if (c.email) {
    const q = email ? `?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}` : '';
    return { kind: 'email', label: `Email ${c.name}`, href: `mailto:${c.email}${q}` };
  }
  return null;
}

/** "Hello, please prepare a repeat of ..." for a medicine, written once for every channel. */
export function repeatEmail(o: { medicine: string; dose: string | null; person: string; born: string | null; holder: string | null }) {
  const what = [o.medicine, o.dose].filter(Boolean).join(' ');
  return {
    subject: `Repeat for ${o.person}: ${what}`,
    body: `Hello, please prepare a repeat of ${what} for ${o.person}${o.born ? `, born ${o.born}` : ''}. Thank you${o.holder ? `, ${o.holder}` : ''}.`,
  };
}

interface MedRow {
  id: string;
  care_profile_id: string;
  supplier_id: string | null;
  name: string;
  dose: string | null;
  form: string | null;
  units_per_dose: unknown;
  dose_amount: unknown;
  schedule_times: unknown;
  supply: unknown;
  supply_remaining: unknown;
  packs_on_hand: unknown;
}

/** About how many days a medicine's supply lasts, or null when it cannot be told. */
export function daysLeft(m: Pick<MedRow, 'form' | 'units_per_dose' | 'dose_amount' | 'schedule_times' | 'supply' | 'supply_remaining' | 'packs_on_hand'>): number | null {
  const times = Array.isArray(m.schedule_times) ? m.schedule_times.length : 0;
  if (times === 0 || m.supply_remaining == null) return null;
  const packUnits = m.packs_on_hand != null && m.supply != null ? Number(m.packs_on_hand) * Number(m.supply) : 0;
  const onHand = Number(m.supply_remaining) + packUnits;
  const perDay = times * perDoseDrawdown({ form: m.form, units_per_dose: m.units_per_dose, dose_amount: m.dose_amount });
  if (!Number.isFinite(onHand) || !(perDay > 0)) return null;
  return Math.max(0, Math.floor(onHand / perDay));
}

/** Where each medicine is reordered from: its supplier, else the person's main pharmacy. */
export async function medicineSuppliers(meds: Array<Pick<MedRow, 'id' | 'care_profile_id' | 'supplier_id'>>, conn: Conn = db): Promise<Map<string, ContactSummary | null>> {
  const suppliers = await supplierContacts(conn, meds.map((m) => m.supplier_id));
  const pharmacyByProfile = new Map<string, ContactSummary | null>();
  const out = new Map<string, ContactSummary | null>();
  for (const m of meds) {
    let c = (m.supplier_id && suppliers.get(m.supplier_id)) || null;
    if (!c) {
      if (!pharmacyByProfile.has(m.care_profile_id)) pharmacyByProfile.set(m.care_profile_id, await mainContact(conn, m.care_profile_id, 'pharmacy'));
      c = pharmacyByProfile.get(m.care_profile_id) ?? null;
    }
    out.set(m.id, c);
  }
  return out;
}

/** The medicine rows supply alerts need, by id. */
export async function medicineRows(ids: string[], conn: Conn = db): Promise<Map<string, MedRow & { full_name: string; date_of_birth: string | null; holder: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = (await conn('medications as m')
    .join('medication_catalogue as c', 'c.id', 'm.medication_catalogue_id')
    .join('care_profiles as cp', 'cp.id', 'm.care_profile_id')
    .join('accounts as a', 'a.id', 'cp.account_id')
    .whereIn('m.id', ids)
    .select(
      'm.id', 'm.care_profile_id', 'm.supplier_id', 'c.name', 'm.dose', 'c.form', 'm.units_per_dose', 'm.dose_amount', 'm.schedule_times',
      'm.supply', 'm.supply_remaining', 'm.packs_on_hand', 'cp.full_name', conn.raw("to_char(cp.date_of_birth, 'DD/MM/YYYY') as date_of_birth"),
      'a.display_name as holder'
    )) as Array<MedRow & { full_name: string; date_of_birth: string | null; holder: string | null }>;
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * The contact and next action for a supply alert on one medicine: order
 * online, else call, else email the supplier or main pharmacy, with the
 * repeat request already written.
 */
export async function supplyContext(medIds: string[], conn: Conn = db) {
  const rows = await medicineRows(medIds, conn);
  const suppliers = await medicineSuppliers([...rows.values()], conn);
  const out = new Map<string, { contact: ContactSummary | null; next_action: NextAction | null; days_left: number | null }>();
  for (const [id, m] of rows) {
    const contact = suppliers.get(id) ?? null;
    const email = repeatEmail({ medicine: m.name, dose: m.dose, person: m.full_name, born: m.date_of_birth, holder: m.holder });
    out.set(id, { contact, next_action: reachAction(contact, email), days_left: daysLeft(m) });
  }
  return out;
}

/** The contact on each task, for an overdue-task alert. */
export async function taskContacts(rows: Array<{ id: string; care_profile_id: string; provider_id: string | null }>, conn: Conn = db) {
  const out = new Map<string, ContactSummary | null>();
  const byProfile = new Map<string, string[]>();
  for (const r of rows) byProfile.set(r.care_profile_id, [...(byProfile.get(r.care_profile_id) ?? []), r.provider_id ?? '']);
  for (const [profileId, providerIds] of byProfile) {
    const summaries = await contactSummaries(conn, providerIds, profileId);
    for (const r of rows.filter((x) => x.care_profile_id === profileId)) out.set(r.id, (r.provider_id && summaries.get(r.provider_id)) || null);
  }
  return out;
}

/** "Terry White Chemmart Box Hill, 03 9890 1234." for outbound text. */
export const contactLine = (c: ContactSummary | null): string => (c ? ` ${[c.name, c.phone].filter(Boolean).join(', ')}.` : '');
