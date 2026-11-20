import { db } from '../config/database';
import { emergencyContactsFor, type EmergencyContact } from './emergencyContacts';

/**
 * One person's emergency sheet, composed on the server so many can be
 * printed at once. It holds the same sections, in the same order, as the
 * sheet a person opens on their own profile: where they are, allergies, who
 * to call, power of attorney, conditions, medicines, the advance care
 * directive, the GP, other providers and communication needs.
 */
export interface EmergencySheet {
  profile: {
    id: string;
    full_name: string;
    preferred_name: string | null;
    date_of_birth: string | null;
    primary_language: string | null;
  };
  residence: {
    residence_type: string | null;
    facility: { name: string; phone: string | null } | null;
    room_number: string | null;
    room_area_name: string | null;
    room_area_type: string | null;
    address: string | null;
  };
  allergies: Array<{ substance: string; reaction: string | null }>;
  emergency_contacts: EmergencyContact[];
  poa_holders: Array<{ name: string; poa_type: string | null; poa_activated: boolean; contact: string | null }>;
  conditions: string[];
  medications: Array<{ name: string; dose: string | null; as_needed: boolean; schedule_times: string[]; frequency: string | null }>;
  advance_care_directive: { in_place: boolean; location: string | null };
  gps: Array<{ name: string; organisation: string | null; phone: string | null }>;
  other_providers: Array<{ name: string; provider_type: string | null; phone: string | null }>;
  communication_needs: string[];
}

const dateOnly = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : []);

export async function composeEmergencySheet(profileId: string): Promise<EmergencySheet | null> {
  const p = (await db('care_profiles').where({ id: profileId }).first()) as Record<string, unknown> | undefined;
  if (!p) return null;
  const [facility, allergies, contacts, members, providers, conditions, meds, plan] = await Promise.all([
    p['residence_provider_id'] ? db('providers').where({ id: p['residence_provider_id'] as string }).first('name', 'phone') : Promise.resolve(null),
    db('allergies').where({ care_profile_id: profileId }).orderBy('substance', 'asc').select('substance', 'reaction'),
    emergencyContactsFor(profileId),
    db('care_circle_members').where({ care_profile_id: profileId }).whereNotNull('poa_type').select('display_name', 'poa_type', 'poa_activated', 'invited_email'),
    db('care_profile_providers as cpp')
      .join('providers as p', 'cpp.provider_id', 'p.id')
      .where('cpp.care_profile_id', profileId)
      .orderBy('p.name', 'asc')
      .select('p.name', 'p.provider_type', 'p.organisation', 'p.phone', 'p.email', 'cpp.poa_type', 'cpp.poa_activated'),
    db('medical_conditions').where({ care_profile_id: profileId }).orderBy('created_at', 'asc').pluck('name'),
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .where({ 'm.care_profile_id': profileId, 'm.active': true })
      .orderBy('c.name', 'asc')
      .select('c.name', 'm.dose', 'm.as_needed', 'm.schedule_times', 'm.frequency'),
    db('care_plans').where({ care_profile_id: profileId }).first('advance_care_directive', 'advance_care_directive_location', 'communication_needs'),
  ]);
  const provs = providers as Array<{ name: string; provider_type: string | null; organisation: string | null; phone: string | null; email: string | null; poa_type: string | null; poa_activated: boolean }>;
  const address = [p['address_line1'], p['address_line2'], p['address_suburb'], p['address_state'], p['address_postcode']]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(', ');
  return {
    profile: {
      id: profileId,
      full_name: String(p['full_name']),
      preferred_name: (p['preferred_name'] as string | null) ?? null,
      date_of_birth: dateOnly(p['date_of_birth']),
      primary_language: (p['primary_language'] as string | null) ?? null,
    },
    residence: {
      residence_type: (p['residence_type'] as string | null) ?? null,
      facility: facility ? { name: (facility as { name: string }).name, phone: (facility as { phone: string | null }).phone ?? null } : null,
      room_number: (p['room_number'] as string | null) ?? null,
      room_area_name: (p['room_area_name'] as string | null) ?? null,
      room_area_type: (p['room_area_type'] as string | null) ?? null,
      address: address || null,
    },
    allergies: allergies as Array<{ substance: string; reaction: string | null }>,
    emergency_contacts: contacts,
    poa_holders: [
      ...(members as Array<{ display_name: string; poa_type: string | null; poa_activated: boolean; invited_email: string | null }>).map((m) => ({
        name: m.display_name,
        poa_type: m.poa_type,
        poa_activated: !!m.poa_activated,
        contact: m.invited_email,
      })),
      ...provs.filter((r) => r.poa_type).map((r) => ({ name: r.name, poa_type: r.poa_type, poa_activated: !!r.poa_activated, contact: r.phone ?? r.email ?? null })),
    ],
    conditions: conditions as string[],
    medications: (meds as Array<{ name: string; dose: string | null; as_needed: boolean; schedule_times: unknown; frequency: string | null }>).map((m) => ({
      name: m.name,
      dose: m.dose,
      as_needed: !!m.as_needed,
      schedule_times: asList(m.schedule_times),
      frequency: m.frequency,
    })),
    advance_care_directive: {
      in_place: !!(plan as { advance_care_directive?: boolean } | undefined)?.advance_care_directive,
      location: (plan as { advance_care_directive_location?: string | null } | undefined)?.advance_care_directive_location ?? null,
    },
    gps: provs.filter((r) => r.provider_type === 'gp').map((r) => ({ name: r.name, organisation: r.organisation, phone: r.phone })),
    other_providers: provs
      .filter((r) => r.provider_type !== 'gp')
      .slice(0, 6)
      .map((r) => ({ name: r.name, provider_type: r.provider_type, phone: r.phone })),
    communication_needs: asList((plan as { communication_needs?: unknown } | undefined)?.communication_needs),
  };
}
