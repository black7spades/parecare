import type { Knex } from 'knex';
import { db } from '../config/database';

/**
 * Document categories: one list per account, shared by everyone the account
 * cares for. Built-in categories carry a `system_key` so the code finds them
 * whatever they are called. Three of them are kept for good: Care plan and
 * Advance care directive, which Pare and the Care needs page rely on, and
 * Other, where documents go when their category is deleted.
 */
export const BUILT_IN_CATEGORIES: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'poa', name: 'Power of attorney' },
  { key: 'will', name: 'Will' },
  { key: 'advance_care_directive', name: 'Advance care directive' },
  { key: 'insurance', name: 'Insurance' },
  { key: 'identity', name: 'Identity' },
  { key: 'medical_record', name: 'Medical record' },
  { key: 'medical_certificate', name: 'Medical certificate' },
  { key: 'facility_contract', name: 'Facility contract' },
  { key: 'financial', name: 'Financial' },
  { key: 'care_plan', name: 'Care plan' },
  { key: 'referral', name: 'Referral' },
  { key: 'prescription', name: 'Prescription' },
  { key: 'test_request', name: 'Test request' },
  { key: 'results', name: 'Results' },
  { key: 'letter', name: 'Letter' },
  { key: 'service_agreement', name: 'Service agreement' },
  { key: 'behaviour_support_plan', name: 'Behaviour support plan' },
  { key: 'other', name: 'Other' },
];

export const KEPT_CATEGORY_KEYS = new Set(['care_plan', 'advance_care_directive', 'other']);

/** Why a kept category has no delete, in words for the person asking. */
export const KEPT_REASON: Record<string, string> = {
  care_plan: 'Pare files each new care plan here, so it is always kept. Rename it if you like.',
  advance_care_directive: 'The Care needs page looks here for the advance care directive, so it is always kept. Rename it if you like.',
  other: 'Documents move here when their category is deleted, so it is always kept. Rename it if you like.',
};

export interface DocumentCategory {
  id: string;
  account_id: string;
  name: string;
  system_key: string | null;
  deleted_at: string | Date | null;
}

type Conn = Knex | Knex.Transaction;

export async function accountIdForProfile(profileId: string, conn: Conn = db): Promise<string | null> {
  const row = await conn('care_profiles').where({ id: profileId }).select('account_id').first();
  return (row as { account_id?: string } | undefined)?.account_id ?? null;
}

/**
 * Make sure the account has its built-in categories. New accounts get them the
 * first time anything asks; existing ones were filled when categories arrived.
 */
export async function ensureCategories(accountId: string, conn: Conn = db): Promise<void> {
  const have = await conn('document_categories').where({ account_id: accountId }).whereNotNull('system_key').pluck('system_key');
  const missing = BUILT_IN_CATEGORIES.filter((c) => !have.includes(c.key));
  if (missing.length === 0) return;
  // A category the account already typed with the same name becomes the
  // built-in, so "Referral" typed while filing is not listed twice.
  const fresh: typeof missing = [];
  for (const c of missing) {
    const adopted = await conn('document_categories')
      .where({ account_id: accountId })
      .whereNull('system_key')
      .whereNull('deleted_at')
      .whereRaw('lower(name) = lower(?)', [c.name])
      .update({ system_key: c.key });
    if (!adopted) fresh.push(c);
  }
  if (fresh.length === 0) return;
  await conn('document_categories')
    .insert(fresh.map((c) => ({ account_id: accountId, system_key: c.key, name: c.name })))
    .onConflict()
    .ignore();
}

/** The account's live categories, in name order. */
export async function listCategories(accountId: string, conn: Conn = db): Promise<DocumentCategory[]> {
  await ensureCategories(accountId, conn);
  return conn('document_categories')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .orderByRaw('lower(name)')
    .select('id', 'account_id', 'name', 'system_key', 'deleted_at');
}

/** The id of a built-in category, by its key. */
export async function categoryIdByKey(accountId: string, key: string, conn: Conn = db): Promise<string> {
  await ensureCategories(accountId, conn);
  const row = await conn('document_categories').where({ account_id: accountId, system_key: key }).select('id').first();
  return (row as { id: string }).id;
}

/** The live category with this name, ignoring case. */
export async function findCategoryByName(accountId: string, name: string, conn: Conn = db): Promise<DocumentCategory | undefined> {
  return conn('document_categories')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .whereRaw('lower(name) = lower(?)', [name.trim()])
    .first();
}

/**
 * The category with this name, added to the account's list when it is new.
 * This is how a category is created while filing: type a name, and it exists.
 */
export async function resolveCategoryByName(accountId: string, name: string, conn: Conn = db): Promise<string> {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!clean) return categoryIdByKey(accountId, 'other', conn);
  await ensureCategories(accountId, conn);
  const existing = await findCategoryByName(accountId, clean, conn);
  if (existing) return existing.id;
  try {
    const [row] = await conn('document_categories').insert({ account_id: accountId, name: clean }).returning('id');
    return (row as { id: string }).id;
  } catch {
    // Someone added the same name a moment ago; use theirs.
    const again = await findCategoryByName(accountId, clean, conn);
    if (again) return again.id;
    throw new Error('Could not add that category');
  }
}

/**
 * The columns a document is shown with: the document itself plus its
 * category's name and key, joined in rather than stored twice.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withCategory(query: Knex.QueryBuilder): Knex.QueryBuilder<any, any[]> {
  return query
    .leftJoin('document_categories as dc', 'dc.id', 'documents.category_id')
    .select('documents.*', 'dc.name as category_name', 'dc.system_key as category_key');
}
