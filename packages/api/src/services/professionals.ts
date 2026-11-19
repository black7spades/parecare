import type { Knex } from 'knex';
import { db } from '../config/database';
import { providerWriteColumns } from '../routes/providers';
import { whereNamed } from './providerPractices';
import { ADDRESS_PART_KEYS, composeFormatted, hasAnyPart, type AddressParts } from './addresses';

type Conn = Knex | Knex.Transaction;

/**
 * Make sure a professional is in Contacts and linked to this person, without
 * ever filing them twice. A name already in the account's directory is
 * linked as it is; a new name is filed as a professional, with what they do
 * when known (plain words such as "Neurologist" join the shared list).
 * Used wherever someone is named who will be seen: a referral, a booking
 * with a new name, Pare.
 */
/** Where someone is, as already typed elsewhere: carried into Contacts with them. */
export type KnownPlace = AddressParts & { directions_link?: string | null };

/**
 * Fill in what Contacts does not know yet about a professional from what was
 * typed elsewhere, such as the address of their appointment. Only empty
 * details are filled: nothing already in Contacts is ever overwritten, and
 * someone who shares their practice's address keeps sharing it.
 */
export async function fillProfessionalGaps(conn: Conn, providerId: string, place: KnownPlace | null | undefined): Promise<void> {
  if (!place) return;
  const p = (await conn('providers').where({ id: providerId }).first()) as Record<string, unknown> | undefined;
  if (!p) return;
  const fields: Record<string, unknown> = {};
  const hasOwnAddress = ADDRESS_PART_KEYS.some((k) => String(p[k] ?? '').trim() !== '');
  const sharesPractice = !!p['practice_id'] && p['uses_practice_address'] !== false;
  if (!hasOwnAddress && !sharesPractice && hasAnyPart(place)) {
    for (const k of ADDRESS_PART_KEYS) fields[k] = (place[k] ?? '').trim() || null;
    fields['address'] = composeFormatted(place) || null;
  }
  if (!String(p['directions_link'] ?? '').trim() && place.directions_link?.trim()) {
    fields['directions_link'] = place.directions_link.trim();
  }
  if (Object.keys(fields).length) await conn('providers').where({ id: providerId }).update(fields);
}

export async function ensureProfessional(
  conn: Conn,
  opts: { profileId: string; name: string; providerType?: string | null; place?: KnownPlace | null }
): Promise<{ id: string; name: string; created: boolean } | null> {
  const name = opts.name.trim();
  if (!name) return null;
  const profile = (await conn('care_profiles').where({ id: opts.profileId }).first('account_id')) as { account_id: string } | undefined;
  if (!profile) return null;
  const accountId = profile.account_id;

  const existing = (await conn('providers')
    .where({ account_id: accountId })
    .where((w) => whereNamed(w as unknown as Knex.QueryBuilder, name))
    .first('id', 'name', 'provider_type')) as { id: string; name: string; provider_type: string } | undefined;

  let provider: { id: string; name: string };
  let created = false;
  if (existing) {
    provider = existing;
    // Filed earlier with no idea what they do: learn it now.
    if (opts.providerType?.trim() && (!existing.provider_type || existing.provider_type === 'other')) {
      const { columns } = await providerWriteColumns(accountId, { provider_type: opts.providerType.trim() }, existing.id);
      if (columns['provider_type']) await conn('providers').where({ id: existing.id }).update({ provider_type: columns['provider_type'] });
    }
  } else {
    const { columns } = await providerWriteColumns(accountId, {
      name,
      kind: 'person',
      provider_type: opts.providerType?.trim() || 'specialist',
    });
    const [row] = await conn('providers').insert({ account_id: accountId, ...columns }).returning(['id', 'name']);
    provider = row as { id: string; name: string };
    created = true;
  }
  await conn('care_profile_providers')
    .insert({ care_profile_id: opts.profileId, provider_id: provider.id })
    .onConflict(['care_profile_id', 'provider_id'])
    .ignore();
  // Everything already typed about them goes into Contacts too.
  await fillProfessionalGaps(conn, provider.id, opts.place);
  return { ...provider, created };
}

const isUrl = (v: string | null | undefined) => !!v && /^\s*https?:\/\//i.test(v);

/**
 * The columns for where an appointment is: the address parts, its own map
 * link, and the one-line location kept in step for display, calendars and
 * reminders. Takes the parts from the form, or, from Pare or older callers,
 * one line of text: a link becomes the map link and anything else the first
 * address line.
 */
export function appointmentPlaceColumns(input: AddressParts & { location?: string | null; directions_link?: string | null }) {
  const out: Record<string, string | null> = {};
  const partsGiven = ADDRESS_PART_KEYS.some((k) => k in input);
  if (partsGiven) {
    for (const k of ADDRESS_PART_KEYS) out[k] = (input[k] ?? '').trim() || null;
    out['location'] = hasAnyPart(input) ? composeFormatted(input) : null;
  } else if (input.location !== undefined) {
    const text = (input.location ?? '').trim();
    for (const k of ADDRESS_PART_KEYS) out[k] = null;
    if (isUrl(text)) {
      out['location'] = null;
      if (input.directions_link === undefined) out['directions_link'] = text;
    } else {
      out['address_line1'] = text.slice(0, 255) || null;
      out['location'] = text || null;
    }
  }
  if (input.directions_link !== undefined) out['directions_link'] = (input.directions_link ?? '').trim() || null;
  return out;
}
