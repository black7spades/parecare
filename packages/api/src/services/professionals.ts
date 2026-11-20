import type { Knex } from 'knex';
import { db } from '../config/database';
import { providerWriteColumns } from '../routes/providers';
import { whereNamed } from './providerPractices';
import { ADDRESS_PART_KEYS, composeFormatted, hasAnyPart, type AddressParts } from './addresses';
import { providerTypeLabel } from '../lib/providerTypes';
import { effectiveMainSql, kindSql } from '../lib/mainContact';

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
    await linkContactToSuppliers(conn, provider.id);
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

const SUMMARY_FIELDS = ['phone', 'after_hours_phone', 'fax', 'email', 'booking_link', 'directions_link', 'address'] as const;

/** Opening hours as stored, checked: each day 1 to 7, HH:MM, opens before closes. */
export function cleanOpeningHours(raw: unknown): OpeningHours | null {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const out: OpeningHours = [];
  for (const h of list as Array<Record<string, unknown>>) {
    const day = Number(h?.['day']);
    const opens = String(h?.['opens'] ?? '');
    const closes = String(h?.['closes'] ?? '');
    if (!Number.isInteger(day) || day < 1 || day > 7 || !hm.test(opens) || !hm.test(closes) || opens >= closes) continue;
    out.push({ day: day as OpeningHours[number]['day'], opens, closes });
  }
  return out.length ? out.sort((a, b) => a.day - b.day || a.opens.localeCompare(b.opens)) : null;
}

/**
 * Contact summaries for several contacts in one query, keyed by id. Each
 * detail is the contact's own, else their practice's, else the practice's
 * own practice (a clinic inside a health hub). Given the person, it also
 * says whether this is their main contact of its kind and whether they
 * still see them.
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
      'p.opening_hours as p_opening_hours', 'pr.opening_hours as pr_opening_hours', 'pr2.opening_hours as pr2_opening_hours',
      ...SUMMARY_FIELDS.flatMap((f) => [`p.${f} as p_${f}`, `pr.${f} as pr_${f}`, `pr2.${f} as pr2_${f}`]),
      'pr.name as practice_name'
    );
  if (profileId) {
    q.leftJoin('care_profile_providers as cpp', function () {
      this.on('cpp.provider_id', '=', 'p.id').andOn('cpp.care_profile_id', '=', conn.raw('?', [profileId]));
    }).select(conn.raw(`${effectiveMainSql()} as is_main`), conn.raw("to_char(cpp.ended_on, 'YYYY-MM-DD') as ended_on"));
  }
  const rows = (await q) as Array<Record<string, unknown>>;
  const known = [...SUMMARY_FIELDS, 'opening_hours'] as readonly string[];
  for (const r of rows) {
    const inherited = new Set<string>(((r['inherited_fields'] as string[] | null) ?? []).filter((f) => known.includes(f)));
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
    let hours = cleanOpeningHours(r['p_opening_hours']);
    for (const level of ['pr', 'pr2']) {
      if (hours) break;
      hours = cleanOpeningHours(r[`${level}_opening_hours`]);
      if (hours) inherited.add('opening_hours');
    }
    const orgName = (r['practice_name'] as string | null) ?? (r['organisation'] as string | null);
    out.set(String(r['id']), {
      source: 'contact',
      id: String(r['id']),
      name: String(r['name']),
      role_label: providerTypeLabel(r['provider_type'] as string | null),
      organisation: orgName ? { id: (r['practice_id'] as string | null) ?? null, name: orgName } : null,
      phone: values.phone,
      after_hours_phone: values.after_hours_phone,
      fax: values.fax,
      email: values.email,
      booking_link: values.booking_link,
      order_link: null,
      directions_link: values.directions_link,
      address: values.address,
      opening_hours: hours,
      inherited: [...inherited],
      is_main: r['is_main'] === true,
      ended_on: (r['ended_on'] as string | null) ?? null,
    });
  }
  return out;
}

/** One contact's summary, or null when there is no such contact. */
export async function contactSummary(conn: Conn, providerId: string | null | undefined, profileId?: string): Promise<ContactSummary | null> {
  if (!providerId) return null;
  return (await contactSummaries(conn, [providerId], profileId)).get(providerId) ?? null;
}

/**
 * Suppliers in the same shape. A supplier that is the same business as a
 * contact starts from that contact, with its order link added; otherwise it
 * is built from the supplier row.
 */
export async function supplierContacts(
  conn: Conn,
  supplierIds: Array<string | null | undefined>,
  profileId?: string
): Promise<Map<string, ContactSummary>> {
  const ids = [...new Set(supplierIds.filter((v): v is string => !!v))];
  const out = new Map<string, ContactSummary>();
  if (ids.length === 0) return out;
  const rows = (await conn('suppliers').whereIn('id', ids).select('id', 'name', 'phone', 'email', 'address', 'order_url', 'provider_id')) as Array<{
    id: string; name: string; phone: string | null; email: string | null; address: string | null; order_url: string | null; provider_id: string | null;
  }>;
  const asContacts = await contactSummaries(conn, rows.map((r) => r.provider_id), profileId);
  for (const r of rows) {
    const base = r.provider_id ? asContacts.get(r.provider_id) : undefined;
    if (base) {
      out.set(r.id, {
        ...base,
        phone: base.phone ?? (r.phone?.trim() || null),
        email: base.email ?? (r.email?.trim() || null),
        order_link: r.order_url?.trim() || null,
      });
      continue;
    }
    out.set(r.id, {
      source: 'supplier',
      id: r.id,
      name: r.name,
      role_label: 'Supplier',
      organisation: null,
      phone: r.phone?.trim() || null,
      after_hours_phone: null,
      fax: null,
      email: r.email?.trim() || null,
      booking_link: null,
      order_link: r.order_url?.trim() || null,
      directions_link: null,
      address: r.address?.trim() || null,
      opening_hours: null,
      inherited: [],
      is_main: false,
      ended_on: null,
    });
  }
  return out;
}

/** Types that are the same kind of contact when picking a main one. */
export function sameKindTypes(type: string): string[] {
  const low = type.trim().toLowerCase();
  if (low === 'pharmacy' || low === 'pharmacist') return ['pharmacy', 'pharmacist'];
  if (low === 'gp' || low === 'doctor') return ['gp'];
  return [low];
}

/**
 * Their main contact of a kind: the one marked main, else the first linked,
 * never one they no longer see. "Their GP" everywhere comes from here.
 */
export async function mainContact(conn: Conn, profileId: string, providerType: string): Promise<ContactSummary | null> {
  const row = (await conn('care_profile_providers as cpp')
    .join('providers as p', 'p.id', 'cpp.provider_id')
    .where('cpp.care_profile_id', profileId)
    .whereNull('cpp.ended_on')
    .whereRaw('lower(p.provider_type) = ANY(?)', [sameKindTypes(providerType)])
    .orderBy([{ column: 'cpp.is_main', order: 'desc' }, { column: 'cpp.created_at', order: 'asc' }, { column: 'cpp.id', order: 'asc' }])
    .first('p.id')) as { id: string } | undefined;
  return row ? contactSummary(conn, row.id, profileId) : null;
}

/** Someone from the circle, or the account holder. */
export type PersonRef = { account_id: string } | { circle_member_id: string };

const NOTHING_ELSE = {
  organisation: null,
  after_hours_phone: null,
  fax: null,
  booking_link: null,
  order_link: null,
  directions_link: null,
  address: null,
  opening_hours: null,
  inherited: [] as string[],
  is_main: false,
  ended_on: null,
};

/**
 * A circle person or the account holder in the same shape as a contact. A
 * member with a login keeps their phone on their account; someone added by
 * name keeps it on their circle row.
 */
export async function personSummary(conn: Conn, ref: PersonRef, label?: string | null): Promise<ContactSummary | null> {
  if ('account_id' in ref) {
    const a = (await conn('accounts').where({ id: ref.account_id }).first('id', 'display_name', 'email', 'phone')) as
      | { id: string; display_name: string | null; email: string; phone: string | null }
      | undefined;
    if (!a) return null;
    return { ...NOTHING_ELSE, source: 'account', id: a.id, name: a.display_name || a.email, role_label: label ?? null, phone: a.phone?.trim() || null, email: a.email };
  }
  const m = (await conn('care_circle_members as m')
    .leftJoin('accounts as a', 'a.id', 'm.account_id')
    .where('m.id', ref.circle_member_id)
    .first('m.id', 'm.display_name', 'm.relationship', 'm.phone', 'm.email', 'a.phone as account_phone', 'a.email as account_email')) as
    | { id: string; display_name: string; relationship: string | null; phone: string | null; email: string | null; account_phone: string | null; account_email: string | null }
    | undefined;
  if (!m) return null;
  return {
    ...NOTHING_ELSE,
    source: 'circle',
    id: m.id,
    name: m.display_name,
    role_label: label ?? m.relationship ?? null,
    phone: m.account_phone?.trim() || m.phone?.trim() || null,
    email: m.account_email ?? m.email ?? null,
  };
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

/**
 * Mark a linked contact as the person's main one of its kind, or as no
 * longer seen since a date (null: seeing them again). Making one main
 * clears it from the others of that kind for this person. Returns what
 * changed in words, or null when the contact is not linked to them.
 */
export async function setContactStanding(
  conn: Conn,
  profileId: string,
  providerId: string,
  change: { is_main?: boolean; ended_on?: string | null }
): Promise<string | null> {
  const link = (await conn('care_profile_providers as cpp')
    .join('providers as p', 'p.id', 'cpp.provider_id')
    .where({ 'cpp.care_profile_id': profileId, 'cpp.provider_id': providerId })
    .first('cpp.id', 'p.name', 'p.provider_type')) as { id: string; name: string; provider_type: string } | undefined;
  if (!link) return null;
  const said: string[] = [];
  const updates: Record<string, unknown> = {};
  if (change.ended_on !== undefined) {
    updates['ended_on'] = change.ended_on;
    // Someone no longer seen is never the main one.
    if (change.ended_on) updates['is_main'] = false;
    said.push(change.ended_on ? `${link.name} is now under past contacts.` : `${link.name} is a current contact again.`);
  }
  if (change.is_main !== undefined && !(change.ended_on && change.is_main)) {
    if (change.is_main) {
      const sameKind = (await conn('care_profile_providers as c')
        .join('providers as p', 'p.id', 'c.provider_id')
        .where('c.care_profile_id', profileId)
        .whereRaw(`${kindSql('p.provider_type')} = ${kindSql('?')}`, [link.provider_type, link.provider_type])
        .select('c.id')) as Array<{ id: string }>;
      await conn('care_profile_providers').whereIn('id', sameKind.map((r) => r.id)).update({ is_main: false });
      updates['ended_on'] = updates['ended_on'] ?? null;
      const typeWords = providerTypeLabel(link.provider_type) ?? 'contact';
      const label = typeWords === 'GP' ? typeWords : typeWords.toLowerCase();
      said.push(`${link.name} is now the main ${label}.`);
    }
    updates['is_main'] = change.is_main;
  }
  if (Object.keys(updates).length) await conn('care_profile_providers').where({ id: link.id }).update(updates);
  return said.join(' ') || 'Nothing changed.';
}

/**
 * Who a record is with, from a form or Pare: a contact picked by id (linked
 * to the person when picked from the account's directory, and given the
 * phone typed with them when they had none), a new name filed in Contacts
 * with what they do and their phone, or nobody. `undefined` means the write
 * did not mention them.
 */
export async function resolveContactInput(
  conn: Conn,
  profileId: string,
  input: { id?: string | null; name?: string | null; type?: string | null; phone?: string | null },
  defaultType: string
): Promise<{ id: string | null; filed: { id: string; name: string } | null } | { error: string }> {
  if (input.id) {
    const linked = await conn('care_profile_providers').where({ care_profile_id: profileId, provider_id: input.id }).first('id');
    if (!linked && !(await linkContact(conn, profileId, input.id))) {
      return { error: "That contact is not in this person's contacts. Add them to Contacts first, then pick them here." };
    }
    const phone = input.phone?.trim();
    if (phone) {
      await conn('providers')
        .where({ id: input.id })
        .where((w) => w.whereNull('phone').orWhereRaw("trim(phone) = ''"))
        .update({ phone: phone.slice(0, 50) });
    }
    return { id: input.id, filed: null };
  }
  if (input.name?.trim()) {
    const pro = await ensureProfessional(conn, { profileId, name: input.name, providerType: input.type?.trim() || defaultType, phone: input.phone });
    if (!pro) return { id: null, filed: null };
    return { id: pro.id, filed: pro.created ? { id: pro.id, name: pro.name } : null };
  }
  return { id: null, filed: null };
}

const SAME_NAME_SQL = "lower(regexp_replace(trim(??), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(?), '\\s+', ' ', 'g'))";

/**
 * A supplier and an organisation in Contacts with the same name are the
 * same business: link them, so the supplier's order link and the contact's
 * phone and hours show together. Called whenever either is filed.
 */
export async function linkSupplierToContact(conn: Conn, supplierId: string): Promise<void> {
  const s = (await conn('suppliers').where({ id: supplierId }).first('id', 'account_id', 'name', 'provider_id')) as
    | { id: string; account_id: string; name: string; provider_id: string | null }
    | undefined;
  if (!s || s.provider_id) return;
  const p = (await conn('providers')
    .where({ account_id: s.account_id, kind: 'organisation' })
    .whereRaw(SAME_NAME_SQL, ['name', s.name])
    .orderBy('created_at', 'asc')
    .first('id')) as { id: string } | undefined;
  if (p) await conn('suppliers').where({ id: s.id }).update({ provider_id: p.id });
}

export async function linkContactToSuppliers(conn: Conn, providerId: string): Promise<void> {
  const p = (await conn('providers').where({ id: providerId }).first('id', 'account_id', 'name', 'kind')) as
    | { id: string; account_id: string; name: string; kind: string }
    | undefined;
  if (!p || p.kind !== 'organisation') return;
  await conn('suppliers').where({ account_id: p.account_id }).whereNull('provider_id').whereRaw(SAME_NAME_SQL, ['name', p.name]).update({ provider_id: p.id });
}

/**
 * The supplier an equipment record names, as an account supplier: picked by
 * id, or found by name and filed when new. Empty clears it.
 */
export async function resolveAssetSupplier(
  conn: Conn,
  accountId: string,
  input: { supplier_id?: string | null; supplier?: string | null }
): Promise<{ supplier_id: string | null; supplier: string | null } | null> {
  if (input.supplier_id) {
    const s = (await conn('suppliers').where({ id: input.supplier_id, account_id: accountId }).first('id', 'name')) as { id: string; name: string } | undefined;
    return s ? { supplier_id: s.id, supplier: s.name } : null;
  }
  const name = input.supplier?.trim();
  if (!name) return { supplier_id: null, supplier: null };
  const found = (await conn('suppliers')
    .where({ account_id: accountId })
    .whereRaw('lower(trim(name)) = lower(?)', [name])
    .orderBy('created_at', 'asc')
    .first('id', 'name')) as { id: string; name: string } | undefined;
  if (found) return { supplier_id: found.id, supplier: found.name };
  const [created] = (await conn('suppliers').insert({ account_id: accountId, name: name.slice(0, 255) }).returning(['id', 'name'])) as Array<{ id: string; name: string }>;
  await linkSupplierToContact(conn, created!.id);
  return { supplier_id: created!.id, supplier: created!.name };
}
