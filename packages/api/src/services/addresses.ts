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

/** The link kind that means "this is where they live". */
export const RESIDENCE_KIND = 'residence';

/**
 * Copy an address's segmented parts into a profile's residence columns so the
 * "where they live" section stays in step when an address is linked as a
 * residence. Only touches the segmented address columns; the facility, room
 * and area fields are left alone. When no residence type is recorded yet, it
 * is set to a private residence so the address reads as their home.
 */
export async function syncProfileResidence(profileId: string, parts: AddressParts): Promise<void> {
  if (!hasAnyPart(parts)) return;
  const profile = await db('care_profiles').where({ id: profileId }).first();
  if (!profile) return;
  const updates: Record<string, string | null> = {};
  for (const k of ADDRESS_PART_KEYS) updates[k] = clean(parts[k]) || null;
  if (!profile.residence_type) updates['residence_type'] = 'private_residence';
  await db('care_profiles').where({ id: profileId }).update({ ...updates, updated_at: db.fn.now() });
}

/**
 * Re-sync the residence of every profile this address is linked to as a
 * residence. Used when the shared address is edited in the directory so the
 * change reaches each person's "where they live".
 */
export async function syncResidenceForAddress(addressId: string, parts: AddressParts): Promise<void> {
  const links = await db('care_profile_addresses')
    .where({ address_id: addressId, address_kind: RESIDENCE_KIND })
    .select('care_profile_id');
  for (const link of links) {
    await syncProfileResidence(link.care_profile_id as string, parts);
  }
}
