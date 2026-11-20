import type { Knex } from 'knex';
import { db } from '../config/database';
import { contactSummaries, personSummary, type ContactSummary } from './professionals';

type Conn = Knex | Knex.Transaction;

/**
 * Who to call in an emergency, stored by reference: someone in the circle,
 * the account holder, or a contact. Their phone is read live from their own
 * record, so a number changed in one place changes everywhere. Only someone
 * not in PareCare keeps a typed name and phone on the row.
 */
export type EmergencyContact = ContactSummary & {
  /** The emergency contact row; null for the worked-out default. */
  row_id: string | null;
  relationship: string | null;
  sort_order: number;
  /** Worked out from the profile, not chosen. */
  inferred: boolean;
};

export type EmergencyRef =
  | { circle_member_id: string }
  | { account_id: string }
  | { provider_id: string }
  | { name: string; phone?: string | null };

const SELF = new Set(['myself', 'self', 'me', 'i']);
export const isSelfRelationship = (rel: string | null | undefined) => SELF.has(String(rel ?? '').trim().toLowerCase());

/**
 * What the account holder is to the person, from what the person is to the
 * account holder: Dorothy is Linda's mother, so Linda is her daughter.
 * Gender on the account picks the word; otherwise the plain one.
 */
export function inverseRelationship(personIsMy: string | null | undefined, gender?: string | null): string | null {
  const rel = String(personIsMy ?? '').trim().toLowerCase();
  const g = String(gender ?? '').trim().toLowerCase();
  const female = /^(f|female|woman|girl)$/.test(g);
  const male = /^(m|male|man|boy)$/.test(g);
  const pick = (f: string, m: string, plain: string) => (female ? f : male ? m : plain);
  if (['mother', 'mum', 'mom', 'father', 'dad', 'parent'].includes(rel)) return pick('Daughter', 'Son', 'Child');
  if (['son', 'daughter', 'child'].includes(rel)) return pick('Mother', 'Father', 'Parent');
  if (['grandma', 'grandmother', 'grandpa', 'grandfather', 'grandparent'].includes(rel)) return pick('Granddaughter', 'Grandson', 'Grandchild');
  if (['grandson', 'granddaughter', 'grandchild'].includes(rel)) return pick('Grandmother', 'Grandfather', 'Grandparent');
  if (['sister', 'brother', 'sibling'].includes(rel)) return pick('Sister', 'Brother', 'Sibling');
  if (['aunt', 'uncle'].includes(rel)) return pick('Niece', 'Nephew', 'Niece or nephew');
  if (['niece', 'nephew'].includes(rel)) return pick('Aunt', 'Uncle', 'Aunt or uncle');
  if (['mother-in-law', 'father-in-law'].includes(rel)) return pick('Daughter-in-law', 'Son-in-law', 'Child-in-law');
  if (['partner', 'wife', 'husband', 'spouse'].includes(rel)) return 'Partner';
  if (['friend'].includes(rel)) return 'Friend';
  if (['neighbour', 'neighbor'].includes(rel)) return 'Neighbour';
  if (['cousin'].includes(rel)) return 'Cousin';
  if (['client', 'resident'].includes(rel)) return 'Carer';
  return null;
}

/** "Niece or nephew" breaks the one-thing-per-label rule; keep it plain instead. */
const tidyRelationship = (rel: string | null) => (rel && / or /.test(rel) ? null : rel);

const typedSummary = (name: string, phone: string | null): ContactSummary => ({
  source: 'typed',
  id: null,
  name,
  role_label: null,
  organisation: null,
  phone: phone?.trim() || null,
  after_hours_phone: null,
  fax: null,
  email: null,
  booking_link: null,
  order_link: null,
  directions_link: null,
  address: null,
  opening_hours: null,
  inherited: [],
  is_main: false,
  ended_on: null,
});

/**
 * The worked-out emergency contact when none has been chosen: a resident's
 * named contact (Helen Hughes, daughter), else the account holder when the
 * person is not themselves (Linda for Dorothy). Someone managing their own
 * health gets none.
 */
async function inferredContact(conn: Conn, profileId: string): Promise<EmergencyContact | null> {
  const p = (await conn('care_profiles as cp')
    .join('accounts as a', 'a.id', 'cp.account_id')
    .where('cp.id', profileId)
    .first(
      'cp.kind', 'cp.owner_relationship', 'cp.contact_kind', 'cp.contact_name', 'cp.contact_phone', 'cp.contact_relationship',
      'cp.contact_account_id', 'cp.contact_provider_id', 'cp.contact_profile_id', 'a.id as account_id', 'a.gender'
    )) as Record<string, string | null> | undefined;
  if (!p) return null;
  const base = { row_id: null, sort_order: 0, inferred: true };
  const kind = p['contact_kind'];
  if (kind === 'contact' && p['contact_name']?.trim()) {
    return { ...typedSummary(p['contact_name']!.trim(), p['contact_phone']), ...base, relationship: p['contact_relationship']?.trim() || null };
  }
  if (kind === 'user' && p['contact_account_id']) {
    const s = await personSummary(conn, { account_id: p['contact_account_id']! });
    if (s) return { ...s, ...base, relationship: p['contact_relationship']?.trim() || null };
  }
  if (kind === 'provider' && p['contact_provider_id']) {
    const s = (await contactSummaries(conn, [p['contact_provider_id']], profileId)).get(p['contact_provider_id']!);
    if (s) return { ...s, ...base, relationship: p['contact_relationship']?.trim() || s.role_label };
  }
  if (kind === 'profile' && p['contact_profile_id']) {
    const carer = (await conn('care_profiles').where({ id: p['contact_profile_id'] }).first('full_name', 'contact_phone')) as
      | { full_name: string; contact_phone: string | null }
      | undefined;
    if (carer) return { ...typedSummary(carer.full_name, carer.contact_phone), ...base, relationship: p['contact_relationship']?.trim() || null };
  }
  if (p['kind'] === 'pet' || isSelfRelationship(p['owner_relationship'])) return null;
  const holder = await personSummary(conn, { account_id: p['account_id']! });
  if (!holder) return null;
  return { ...holder, ...base, relationship: tidyRelationship(inverseRelationship(p['owner_relationship'], p['gender'])) };
}

/** Everyone to call in an emergency, first to call first; the worked-out one when none is chosen. */
export async function emergencyContactsFor(profileId: string, conn: Conn = db): Promise<EmergencyContact[]> {
  const rows = (await conn('emergency_contacts').where({ care_profile_id: profileId }).orderBy([{ column: 'sort_order' }, { column: 'created_at' }])) as Array<{
    id: string; sort_order: number; circle_member_id: string | null; account_id: string | null; provider_id: string | null;
    name: string | null; phone: string | null; relationship: string | null;
  }>;
  if (rows.length === 0) {
    const inferred = await inferredContact(conn, profileId);
    return inferred ? [inferred] : [];
  }
  const contacts = await contactSummaries(conn, rows.map((r) => r.provider_id), profileId);
  const out: EmergencyContact[] = [];
  for (const r of rows) {
    let s: ContactSummary | null = null;
    if (r.circle_member_id) s = await personSummary(conn, { circle_member_id: r.circle_member_id });
    else if (r.account_id) s = await personSummary(conn, { account_id: r.account_id });
    else if (r.provider_id) s = contacts.get(r.provider_id) ?? null;
    else if (r.name) s = typedSummary(r.name, r.phone);
    if (!s) continue;
    out.push({ ...s, row_id: r.id, relationship: r.relationship, sort_order: r.sort_order, inferred: false });
  }
  return out;
}

/** The same list as plain name, relationship and phone, for reports, Pare and the care plan. */
export async function emergencyContactLines(profileId: string, conn: Conn = db): Promise<Array<{ name: string; relationship: string | null; phone: string | null }>> {
  return (await emergencyContactsFor(profileId, conn)).map((c) => ({ name: c.name, relationship: c.relationship, phone: c.phone }));
}

export class EmergencyContactError extends Error {}

/** Save a phone on the person's own record, only where they have none. */
async function savePhoneOnRecord(conn: Conn, ref: EmergencyRef, phone: string | null | undefined): Promise<void> {
  const p = phone?.trim();
  if (!p) return;
  const empty = (w: Knex.QueryBuilder) => w.whereNull('phone').orWhereRaw("trim(phone) = ''");
  if ('circle_member_id' in ref) {
    const m = (await conn('care_circle_members').where({ id: ref.circle_member_id }).first('account_id')) as { account_id: string | null } | undefined;
    // Someone with a login keeps their number on their account.
    if (m?.account_id) await conn('accounts').where({ id: m.account_id }).where(empty).update({ phone: p.slice(0, 50) });
    else await conn('care_circle_members').where({ id: ref.circle_member_id }).where(empty).update({ phone: p.slice(0, 50) });
  } else if ('account_id' in ref) {
    await conn('accounts').where({ id: ref.account_id }).where(empty).update({ phone: p.slice(0, 50) });
  } else if ('provider_id' in ref) {
    await conn('providers').where({ id: ref.provider_id }).where(empty).update({ phone: p.slice(0, 50) });
  }
}

/** Check a reference belongs with this person: their circle, their account holder, their contacts. */
async function checkRef(conn: Conn, profileId: string, ref: EmergencyRef): Promise<void> {
  if ('circle_member_id' in ref) {
    const m = await conn('care_circle_members').where({ id: ref.circle_member_id, care_profile_id: profileId }).first('id');
    if (!m) throw new EmergencyContactError('That person is not in this care circle.');
  } else if ('account_id' in ref) {
    const ok =
      (await conn('care_profiles').where({ id: profileId, account_id: ref.account_id }).first('id')) ??
      (await conn('care_circle_members').where({ care_profile_id: profileId, account_id: ref.account_id, invite_accepted: true }).first('id'));
    if (!ok) throw new EmergencyContactError('That person is not in this care circle.');
  } else if ('provider_id' in ref) {
    const link = await conn('care_profile_providers').where({ care_profile_id: profileId, provider_id: ref.provider_id }).first('id');
    if (!link) throw new EmergencyContactError("That contact is not in this person's contacts.");
  } else if (!ref.name?.trim()) {
    throw new EmergencyContactError('Write their name.');
  }
}

/**
 * A member with a login is stored as their account, so the same person is
 * never in the list twice and their phone comes from one place.
 */
async function canonicalRef(conn: Conn, ref: EmergencyRef): Promise<EmergencyRef> {
  if ('circle_member_id' in ref) {
    const m = (await conn('care_circle_members').where({ id: ref.circle_member_id }).first('account_id', 'invite_accepted')) as
      | { account_id: string | null; invite_accepted: boolean }
      | undefined;
    if (m?.account_id && m.invite_accepted) return { account_id: m.account_id };
  }
  return ref;
}

function refColumns(ref: EmergencyRef): Record<string, unknown> {
  if ('circle_member_id' in ref) return { circle_member_id: ref.circle_member_id };
  if ('account_id' in ref) return { account_id: ref.account_id };
  if ('provider_id' in ref) return { provider_id: ref.provider_id };
  return { name: ref.name.trim().slice(0, 255), phone: ref.phone?.trim().slice(0, 50) || null };
}

/**
 * Add someone to call. Their phone, when given and they have none on file,
 * is saved on their own record. Adding someone already listed updates them.
 * `first` puts them at the top.
 */
export async function addEmergencyContact(
  conn: Conn,
  profileId: string,
  input: { ref: EmergencyRef; relationship?: string | null; phone?: string | null; first?: boolean }
): Promise<string> {
  await checkRef(conn, profileId, input.ref);
  const ref = await canonicalRef(conn, input.ref);
  await savePhoneOnRecord(conn, ref, input.phone);
  const cols = refColumns(ref);
  const existing = 'name' in ref
    ? null
    : ((await conn('emergency_contacts').where({ care_profile_id: profileId, ...cols }).first('id')) as { id: string } | undefined);
  let id: string;
  if (existing) {
    id = existing.id;
    if (input.relationship !== undefined) await conn('emergency_contacts').where({ id }).update({ relationship: input.relationship?.trim() || null, updated_at: conn.fn.now() });
  } else {
    const max = (await conn('emergency_contacts').where({ care_profile_id: profileId }).max('sort_order as m').first()) as { m: number | null } | undefined;
    const [row] = (await conn('emergency_contacts')
      .insert({ care_profile_id: profileId, ...cols, relationship: input.relationship?.trim().slice(0, 100) || null, sort_order: (max?.m ?? -1) + 1 })
      .returning('id')) as Array<{ id: string }>;
    id = row!.id;
  }
  if (input.first) await moveToTop(conn, profileId, id);
  return id;
}

async function moveToTop(conn: Conn, profileId: string, id: string): Promise<void> {
  const ids = ((await conn('emergency_contacts').where({ care_profile_id: profileId }).orderBy(['sort_order', 'created_at']).select('id')) as Array<{ id: string }>).map((r) => r.id);
  await setEmergencyOrder(conn, profileId, [id, ...ids.filter((x) => x !== id)]);
}

/** Change how they are related, their typed name, or their phone (saved on their own record). */
export async function updateEmergencyContact(
  conn: Conn,
  profileId: string,
  id: string,
  input: { relationship?: string | null; phone?: string | null; name?: string | null }
): Promise<boolean> {
  const row = (await conn('emergency_contacts').where({ id, care_profile_id: profileId }).first()) as Record<string, string | null> | undefined;
  if (!row) return false;
  const update: Record<string, unknown> = {};
  if (input.relationship !== undefined) update['relationship'] = input.relationship?.trim().slice(0, 100) || null;
  const typed = !row['circle_member_id'] && !row['account_id'] && !row['provider_id'];
  if (typed) {
    if (input.name !== undefined && input.name?.trim()) update['name'] = input.name.trim().slice(0, 255);
    if (input.phone !== undefined) update['phone'] = input.phone?.trim().slice(0, 50) || null;
  } else if (input.phone !== undefined && input.phone?.trim()) {
    const ref: EmergencyRef = row['circle_member_id']
      ? { circle_member_id: row['circle_member_id']! }
      : row['account_id']
        ? { account_id: row['account_id']! }
        : { provider_id: row['provider_id']! };
    // A changed number is the person's number: it changes everywhere.
    const p = input.phone.trim().slice(0, 50);
    if ('circle_member_id' in ref) {
      const m = (await conn('care_circle_members').where({ id: ref.circle_member_id }).first('account_id')) as { account_id: string | null } | undefined;
      if (m?.account_id) await conn('accounts').where({ id: m.account_id }).update({ phone: p });
      else await conn('care_circle_members').where({ id: ref.circle_member_id }).update({ phone: p });
    } else if ('account_id' in ref) {
      await conn('accounts').where({ id: ref.account_id }).update({ phone: p });
    } else {
      await savePhoneOnRecord(conn, ref, p);
    }
  }
  if (Object.keys(update).length) await conn('emergency_contacts').where({ id }).update({ ...update, updated_at: conn.fn.now() });
  return true;
}

export async function removeEmergencyContact(conn: Conn, profileId: string, id: string): Promise<boolean> {
  return (await conn('emergency_contacts').where({ id, care_profile_id: profileId }).delete()) > 0;
}

/** Who to call first: the order given, anyone not named keeps their place after. */
export async function setEmergencyOrder(conn: Conn, profileId: string, ids: string[]): Promise<void> {
  const all = ((await conn('emergency_contacts').where({ care_profile_id: profileId }).orderBy(['sort_order', 'created_at']).select('id')) as Array<{ id: string }>).map((r) => r.id);
  const ordered = [...ids.filter((id) => all.includes(id)), ...all.filter((id) => !ids.includes(id))];
  for (let i = 0; i < ordered.length; i++) await conn('emergency_contacts').where({ id: ordered[i] }).update({ sort_order: i });
}
