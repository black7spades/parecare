import type { Knex } from 'knex';
import { db } from '../config/database';
import { providerWriteColumns } from '../routes/providers';
import { whereNamed } from './providerPractices';
import { ADDRESS_PART_KEYS, composeFormatted, hasAnyPart, type AddressParts } from './addresses';
import { providerTypeLabel } from '../lib/providerTypes';

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
  opts: { profileId: string; name: string; providerType?: string | null; place?: KnownPlace | null; phone?: string | null }
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
  // Their number, typed where they were named, fills an empty phone. A number
  // already in Contacts is never overwritten.
  const phone = opts.phone?.trim();
  if (phone) {
    await conn('providers')
      .where({ id: provider.id })
      .where((w) => w.whereNull('phone').orWhereRaw("trim(phone) = ''"))
      .update({ phone: phone.slice(0, 50), inherited_fields: conn.raw("array_remove(coalesce(inherited_fields, '{}'), 'phone')") });
  }
  return { ...provider, created };
}

/**
 * Someone picked from the account's directory who is not linked to this
 * person yet is linked now. Returns false when they belong to another account.
 */
export async function linkContact(conn: Conn, profileId: string, providerId: string): Promise<boolean> {
  const row = (await conn('providers as p')
    .join('care_profiles as cp', 'cp.account_id', 'p.account_id')
    .where({ 'p.id': providerId, 'cp.id': profileId })
    .first('p.id')) as { id: string } | undefined;
  if (!row) return false;
  await conn('care_profile_providers')
    .insert({ care_profile_id: profileId, provider_id: providerId })
    .onConflict(['care_profile_id', 'provider_id'])
    .ignore();
  return true;
}

/** Each day of the week a place opens, Monday = 1, times as HH:MM. */
export type OpeningHours = Array<{ day: 1 | 2 | 3 | 4 | 5 | 6 | 7; opens: string; closes: string }>;

/**
 * One shape for anyone to call, wherever they are named: a task's contact,
 * an appointment's, a next step's, the GP on a health alert. Details a
 * professional takes from their practice are filled from it and listed in
 * `inherited`, so the screen can say "the practice's number".
 */
export interface ContactSummary {
  source: 'contact' | 'supplier' | 'circle' | 'account' | 'typed';
  id: string | null;
  name: string;
  role_label: string | null;
  organisation: { id: string | null; name: string } | null;
  phone: string | null;
  after_hours_phone: string | null;
  fax: string | null;
  email: string | null;
  booking_link: string | null;
  order_link: string | null;
  directions_link: string | null;
  address: string | null;
  opening_hours: OpeningHours | null;
  inherited: string[];
  is_main: boolean;
  ended_on: string | null;
}

const SUMMARY_FIELDS = ['phone', 'email', 'booking_link', 'directions_link', 'address'] as const;

/**
 * Contact summaries for several contacts in one query, keyed by id. Each
 * detail is the contact's own, else their practice's, else the practice's
 * own practice (a clinic inside a health hub).
 */
export async function contactSummaries(
  conn: Conn,
  providerIds: Array<string | null | undefined>,
  profileId?: string
): Promise<Map<string, ContactSummary>> {
  const ids = [...new Set(providerIds.filter((v): v is string => !!v))];
  const out = new Map<string, ContactSummary>();
  if (ids.length === 0) return out;
  const q = conn('providers as p')
    .leftJoin('providers as pr', 'p.practice_id', 'pr.id')
    .leftJoin('providers as pr2', 'pr.practice_id', 'pr2.id')
    .whereIn('p.id', ids)
    .select(
      'p.id', 'p.name', 'p.provider_type', 'p.organisation', 'p.practice_id', 'p.inherited_fields',
      ...SUMMARY_FIELDS.flatMap((f) => [`p.${f} as p_${f}`, `pr.${f} as pr_${f}`, `pr2.${f} as pr2_${f}`]),
      'pr.name as practice_name'
    );
  // profileId is for what a link to this person adds (main contact, no
  // longer seeing them), which arrives with the next set of contact changes.
  void profileId;
  const rows = (await q) as Array<Record<string, unknown>>;
  for (const r of rows) {
    const inherited = new Set<string>(((r['inherited_fields'] as string[] | null) ?? []).filter((f) => (SUMMARY_FIELDS as readonly string[]).includes(f)));
    const pick = (f: (typeof SUMMARY_FIELDS)[number]): string | null => {
      const own = String(r[`p_${f}`] ?? '').trim();
      if (own) return own;
      for (const level of ['pr', 'pr2']) {
        const v = String(r[`${level}_${f}`] ?? '').trim();
        if (v) {
          inherited.add(f);
          return v;
        }
      }
      return null;
    };
    const values = Object.fromEntries(SUMMARY_FIELDS.map((f) => [f, pick(f)])) as Record<(typeof SUMMARY_FIELDS)[number], string | null>;
    const orgName = (r['practice_name'] as string | null) ?? (r['organisation'] as string | null);
    out.set(String(r['id']), {
      source: 'contact',
      id: String(r['id']),
      name: String(r['name']),
      role_label: providerTypeLabel(r['provider_type'] as string | null),
      organisation: orgName ? { id: (r['practice_id'] as string | null) ?? null, name: orgName } : null,
      phone: values.phone,
      after_hours_phone: null,
      fax: null,
      email: values.email,
      booking_link: values.booking_link,
      order_link: null,
      directions_link: values.directions_link,
      address: values.address,
      opening_hours: null,
      inherited: [...inherited],
      is_main: false,
      ended_on: null,
    });
  }
  return out;
}

/** One contact's summary, or null when there is no such contact. */
export async function contactSummary(conn: Conn, providerId: string | null | undefined, profileId?: string): Promise<ContactSummary | null> {
  if (!providerId) return null;
  return (await contactSummaries(conn, [providerId], profileId)).get(providerId) ?? null;
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
