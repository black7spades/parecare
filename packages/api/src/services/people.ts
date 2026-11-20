import type { Knex } from 'knex';
import { db } from '../config/database';

type Conn = Knex | Knex.Transaction;

/**
 * Someone who can be picked for a job around a person: assigned a task, going
 * to an appointment, driving. The account holder comes first (Linda for
 * Dorothy, who is not a circle member), then the circle in circle order.
 */
export interface PickablePerson {
  ref: { account_id: string } | { circle_member_id: string };
  name: string;
  label: string | null;
  phone: string | null;
  email: string | null;
  has_login: boolean;
}

const ROLE_WORDS: Record<string, string> = {
  family: 'Family', friend: 'Friend', carer: 'Carer', support_worker: 'Support worker', nurse: 'Nurse', organisation: 'Organisation', legal: 'Legal', other: 'In the care circle',
};

export async function pickablePeople(profileId: string, viewerAccountId: string | null, conn: Conn = db): Promise<PickablePerson[]> {
  const profile = (await conn('care_profiles as cp')
    .join('accounts as a', 'cp.account_id', 'a.id')
    .where('cp.id', profileId)
    .first('a.id', 'a.display_name', 'a.email', 'a.phone')) as { id: string; display_name: string; email: string; phone: string | null } | undefined;
  const out: PickablePerson[] = [];
  if (profile) {
    out.push({
      ref: { account_id: profile.id },
      name: profile.display_name,
      label: profile.id === viewerAccountId ? 'You' : 'Manages this profile',
      phone: profile.phone?.trim() || null,
      email: profile.email,
      has_login: true,
    });
  }
  const members = (await conn('care_circle_members as m')
    .leftJoin('accounts as a', 'm.account_id', 'a.id')
    .where('m.care_profile_id', profileId)
    .orderBy('m.created_at', 'asc')
    .select('m.id', 'm.display_name', 'm.role', 'm.relationship', 'm.phone', 'm.email', 'm.account_id', 'm.invite_accepted', 'a.email as account_email', 'a.phone as account_phone')) as Array<{
    id: string; display_name: string; role: string; relationship: string | null; phone: string | null; email: string | null;
    account_id: string | null; invite_accepted: boolean; account_email: string | null; account_phone: string | null;
  }>;
  for (const m of members) {
    // The account holder is already first.
    if (profile && m.account_id === profile.id) continue;
    out.push({
      ref: { circle_member_id: m.id },
      name: m.display_name,
      label: m.account_id && m.account_id === viewerAccountId ? 'You' : m.relationship?.trim() || ROLE_WORDS[m.role] || null,
      // Someone with a login keeps their phone on their account, once.
      phone: m.account_phone?.trim() || m.phone?.trim() || null,
      email: m.account_email ?? m.email,
      has_login: !!m.account_id && m.invite_accepted,
    });
  }
  return out;
}

/**
 * Find someone by a spoken name among the people who can be picked: "me" is
 * whoever is speaking, otherwise the closest name.
 */
export async function findPickablePerson(profileId: string, viewerAccountId: string, name: string, conn: Conn = db): Promise<PickablePerson | undefined> {
  const people = await pickablePeople(profileId, viewerAccountId, conn);
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  if (['me', 'myself', 'i', 'you'].includes(needle)) return people.find((p) => p.label === 'You');
  return (
    people.find((p) => p.name.toLowerCase() === needle) ??
    people.find((p) => p.name.toLowerCase().split(/\s+/)[0] === needle) ??
    people.find((p) => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase()))
  );
}
