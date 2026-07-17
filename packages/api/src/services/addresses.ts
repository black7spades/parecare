import { db } from '../config/database';

/**
 * Shared helpers for the reusable address book. An address is segmented
 * into parts, each its own column, with a one-line `formatted` display kept
 * in step on write. Addresses are account-scoped and linked to any number
 * of care profiles, the same way providers are.
 */

export interface AddressParts {
  address_line1?: string | null;
  address_line2?: string | null;
  address_suburb?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  address_country?: string | null;
}

export const ADDRESS_PART_KEYS = [
  'address_line1',
  'address_line2',
  'address_suburb',
  'address_state',
  'address_postcode',
  'address_country',
] as const;

const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : '');

/** The one-line display, parts joined in reading order. */
export function composeFormatted(parts: AddressParts): string {
  return ADDRESS_PART_KEYS.map((k) => clean(parts[k])).filter(Boolean).join(', ');
}

/** True when at least one part is filled. */
export function hasAnyPart(parts: AddressParts): boolean {
  return ADDRESS_PART_KEYS.some((k) => clean(parts[k]) !== '');
}

/** A normalised key for de-duplicating addresses within an account. */
function normalKey(parts: AddressParts): string {
  return ADDRESS_PART_KEYS.map((k) => clean(parts[k]).toLowerCase().replace(/\s+/g, ' ')).join('|');
}

/** The columns to write for an address, formatted line kept in step. */
export function addressColumns(parts: AddressParts, label?: string | null): Record<string, string | null> {
  const cols: Record<string, string | null> = {};
  for (const k of ADDRESS_PART_KEYS) cols[k] = clean(parts[k]) || null;
  cols['formatted'] = composeFormatted(parts) || null;
  if (label !== undefined) cols['label'] = clean(label) || null;
  return cols;
}

/**
 * Find an address in the account's book that matches these parts, or create
 * one. Returns the id, or null when nothing was provided. Used to capture an
 * address entered elsewhere (a profile's residence) into the shared book.
 */
export async function resolveAddress(accountId: string, parts: AddressParts, label?: string | null): Promise<string | null> {
  if (!hasAnyPart(parts)) return null;
  const key = normalKey(parts);
  const candidates = await db('addresses').where({ account_id: accountId });
  const match = candidates.find((row) => normalKey(row as AddressParts) === key);
  if (match) return match.id as string;
  const [created] = await db('addresses')
    .insert({ account_id: accountId, ...addressColumns(parts, label) })
    .returning('id');
  return (created as { id: string }).id;
}

/** Ensure an address is linked to a profile with the given kind. */
export async function linkAddressToProfile(profileId: string, addressId: string, kind: string | null): Promise<void> {
  await db('care_profile_addresses')
    .insert({ care_profile_id: profileId, address_id: addressId, address_kind: kind })
    .onConflict(['care_profile_id', 'address_id'])
    .merge({ address_kind: kind, updated_at: db.fn.now() });
}
