import type { Knex } from 'knex';
import { db } from '../config/database';

/**
 * Kinds of next step that come out of an appointment: one list per account,
 * shared by everyone it cares for, like document categories. The built-in
 * list casts a wide net over what a GP, specialist, dentist, therapist or vet
 * commonly sends someone away with. Anything else is added by typing it.
 *
 * `books` marks a step that is done by booking another appointment, so the
 * page can offer "Book it" and link the two.
 */
export const BUILT_IN_NEXT_STEPS: ReadonlyArray<{ key: string; name: string; books?: boolean }> = [
  { key: 'referral', name: 'Referral to see someone', books: true },
  { key: 'follow_up', name: 'Follow-up appointment', books: true },
  { key: 'prescription', name: 'Prescription to fill' },
  { key: 'medication_change', name: 'Change to medication' },
  { key: 'blood_test', name: 'Blood test', books: true },
  { key: 'urine_sample', name: 'Urine sample' },
  { key: 'stool_sample', name: 'Stool sample' },
  { key: 'semen_sample', name: 'Semen sample' },
  { key: 'swab', name: 'Swab test' },
  { key: 'xray', name: 'X-ray', books: true },
  { key: 'ultrasound', name: 'Ultrasound', books: true },
  { key: 'ct_scan', name: 'CT scan', books: true },
  { key: 'mri_scan', name: 'MRI scan', books: true },
  { key: 'heart_test', name: 'Heart rhythm test', books: true },
  { key: 'biopsy', name: 'Biopsy', books: true },
  { key: 'hearing_test', name: 'Hearing test', books: true },
  { key: 'eye_test', name: 'Eye test', books: true },
  { key: 'procedure', name: 'Procedure to book', books: true },
  { key: 'vaccination', name: 'Vaccination', books: true },
  { key: 'therapy', name: 'Therapy to start', books: true },
  { key: 'results', name: 'Results to chase' },
  { key: 'report', name: 'Report to get' },
  { key: 'readings', name: 'Readings to take at home' },
  { key: 'symptoms', name: 'Symptoms to watch for' },
  { key: 'lifestyle', name: 'Lifestyle advice to follow' },
  { key: 'equipment', name: 'Equipment to get' },
  { key: 'form', name: 'Form to fill in' },
  { key: 'certificate', name: 'Medical certificate to hand in' },
  { key: 'document', name: 'Document to file' },
  { key: 'bill', name: 'Bill to pay' },
  { key: 'other', name: 'Other' },
];

const BOOKS = new Set(BUILT_IN_NEXT_STEPS.filter((s) => s.books).map((s) => s.key));

/** Other is kept: a next step whose kind is unclear goes there. */
export const KEPT_NEXT_STEP_KEYS = new Set(['other']);
export const KEPT_NEXT_STEP_REASON: Record<string, string> = {
  other: 'Next steps go here when nothing else fits, so it is always kept. Rename it if you like.',
};

export interface NextStepType {
  id: string;
  account_id: string;
  name: string;
  system_key: string | null;
  deleted_at: string | Date | null;
}

type Conn = Knex | Knex.Transaction;

/** Whether this kind of step is carried out by booking another appointment. */
export const stepBooks = (systemKey: string | null): boolean => !!systemKey && BOOKS.has(systemKey);

export async function ensureNextStepTypes(accountId: string, conn: Conn = db): Promise<void> {
  const have = await conn('next_step_types').where({ account_id: accountId }).whereNotNull('system_key').pluck('system_key');
  const missing = BUILT_IN_NEXT_STEPS.filter((s) => !have.includes(s.key));
  if (missing.length === 0) return;
  await conn('next_step_types')
    .insert(missing.map((s) => ({ account_id: accountId, system_key: s.key, name: s.name })))
    .onConflict()
    .ignore();
}

/** The account's live kinds, built-ins in their natural order, then its own by name. */
export async function listNextStepTypes(accountId: string, conn: Conn = db): Promise<NextStepType[]> {
  await ensureNextStepTypes(accountId, conn);
  const rows = (await conn('next_step_types')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .select('id', 'account_id', 'name', 'system_key', 'deleted_at')) as NextStepType[];
  const order = new Map(BUILT_IN_NEXT_STEPS.map((s, i) => [s.key, i]));
  const rank = (t: NextStepType) => (t.system_key && order.has(t.system_key) ? order.get(t.system_key)! : 1000);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export async function nextStepTypeIdByKey(accountId: string, key: string, conn: Conn = db): Promise<string> {
  await ensureNextStepTypes(accountId, conn);
  const row = await conn('next_step_types').where({ account_id: accountId, system_key: key }).select('id').first();
  return (row as { id: string }).id;
}

export async function findNextStepTypeByName(accountId: string, name: string, conn: Conn = db): Promise<NextStepType | undefined> {
  return conn('next_step_types')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .whereRaw('lower(name) = lower(?)', [name.trim()])
    .first();
}

/** The kind with this name, added to the account's list when it is new. */
export async function resolveNextStepTypeByName(accountId: string, name: string, conn: Conn = db): Promise<string> {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!clean) return nextStepTypeIdByKey(accountId, 'other', conn);
  await ensureNextStepTypes(accountId, conn);
  const existing = await findNextStepTypeByName(accountId, clean, conn);
  if (existing) return existing.id;
  try {
    const [row] = await conn('next_step_types').insert({ account_id: accountId, name: clean }).returning('id');
    return (row as { id: string }).id;
  } catch {
    const again = await findNextStepTypeByName(accountId, clean, conn);
    if (again) return again.id;
    throw new Error('Could not add that kind of next step');
  }
}
