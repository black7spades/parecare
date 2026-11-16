import { db } from '../config/database';
import { PLACE_TYPES, isBuiltInProviderType, normaliseProviderType, placeTypeFromName } from '../lib/providerTypes';
import { resolveOptions } from '../routes/optionCatalogue';

/**
 * Practitioners and the practice they work at, kept in step both ways.
 *
 * A practice is an ordinary provider. A practitioner points at it with
 * practice_id; their "organisation" is the practice's name, and while
 * uses_practice_address is on, their address is a copy of the practice's.
 * Every write path (the forms, import, Pare, outside assistants) goes
 * through here, so the rules are the same wherever a provider is saved:
 *
 * - naming a practice that is not filed yet files it;
 * - joining a practice with no address of your own takes the practice's;
 * - renaming or moving a practice updates everyone who works there.
 */

const PARTS = ['address_line1', 'address_line2', 'address_suburb', 'address_state', 'address_postcode', 'address_country'] as const;

type ProviderRow = Record<string, unknown> & {
  id: string;
  account_id: string;
  name: string;
  practice_id: string | null;
  provider_type: string;
};

function addressCopy(practice: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PARTS) out[k] = practice[k] ?? null;
  out['address'] = practice['address'] ?? null;
  return out;
}

const hasOwnAddressParts = (data: Record<string, unknown>) =>
  PARTS.some((k) => typeof data[k] === 'string' && (data[k] as string).trim() !== '');

/** Store a provider type, adding a new one to the shared list. */
export async function storeProviderType(input: string | null | undefined, accountId?: string): Promise<string> {
  const value = normaliseProviderType(input);
  if (!isBuiltInProviderType(value)) await resolveOptions('provider_type', [value], accountId);
  return value;
}

/** The practice in an account with this name, ignoring case and spacing. */
export async function findPracticeByName(accountId: string, name: string): Promise<ProviderRow | undefined> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return undefined;
  return db('providers')
    .where({ account_id: accountId })
    .whereRaw("lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(?)", [clean])
    // Prefer something filed as a place over a person who happens to share the name.
    .orderByRaw(`CASE WHEN provider_type IN (${PLACE_TYPES.map(() => '?').join(', ')}) THEN 0 ELSE 1 END`, PLACE_TYPES)
    .orderBy('created_at', 'asc')
    .first();
}

/** Find a practice by name, or file it as a new one. */
export async function findOrCreatePractice(
  accountId: string,
  name: string
): Promise<{ practice: ProviderRow; created: boolean }> {
  const existing = await findPracticeByName(accountId, name);
  if (existing) return { practice: existing, created: false };
  const [practice] = await db('providers')
    .insert({ account_id: accountId, provider_type: placeTypeFromName(name), name: name.trim().replace(/\s+/g, ' ') })
    .returning('*');
  return { practice: practice as ProviderRow, created: true };
}

/** Whether linking `selfId` under `practiceId` would make a loop. */
async function wouldLoop(selfId: string | undefined, practiceId: string): Promise<boolean> {
  if (!selfId) return false;
  let cursor: string | null = practiceId;
  for (let i = 0; cursor && i < 20; i += 1) {
    if (cursor === selfId) return true;
    const row: { practice_id: string | null } | undefined = await db('providers').where({ id: cursor }).select('practice_id').first();
    cursor = row?.practice_id ?? null;
  }
  return false;
}

export interface PracticeInput {
  /** The chosen practice's id, or null to leave a practice. */
  practice_id?: string | null;
  /** A practice named in words: found, or filed if new. Also the legacy "organisation". */
  practice_name?: string | null;
  organisation?: string | null;
  /** Keep this provider's address in step with the practice. */
  uses_practice_address?: boolean;
}

/**
 * Work out the practice columns for a provider write. Returns only the
 * columns to set, so a write that never mentions a practice changes
 * nothing about it. `data` is the rest of the write, used to tell whether
 * the person gave an address of their own.
 */
export async function practiceColumns(
  accountId: string,
  input: PracticeInput,
  data: Record<string, unknown>,
  selfId?: string
): Promise<{ columns: Record<string, unknown>; note: string | null }> {
  const mentionsPractice = 'practice_id' in input || 'practice_name' in input || 'organisation' in input;
  const mentionsSharing = typeof input.uses_practice_address === 'boolean';
  if (!mentionsPractice && !mentionsSharing) return { columns: {}, note: null };

  let practice: ProviderRow | undefined;
  let created = false;
  let leaving = false;

  if (mentionsPractice) {
    const named = (input.practice_name ?? input.organisation ?? '').trim();
    if (input.practice_id) {
      practice = await db('providers').where({ id: input.practice_id, account_id: accountId }).first();
    }
    if (!practice && named) {
      const found = await findOrCreatePractice(accountId, named);
      practice = found.practice;
      created = found.created;
    }
    if (!practice && (input.practice_id === null || named === '')) leaving = true;
  } else if (selfId) {
    // Only the sharing switch changed: use the practice they already have.
    const self = await db('providers').where({ id: selfId }).select('practice_id').first();
    if (self?.practice_id) practice = await db('providers').where({ id: self.practice_id }).first();
  }

  if (leaving) {
    return { columns: { practice_id: null, organisation: null, uses_practice_address: false }, note: null };
  }
  if (!practice) return { columns: {}, note: null };
  if (practice.id === selfId || (await wouldLoop(selfId, practice.id))) {
    return { columns: {}, note: `${practice.name} already works here, so this cannot also work there. Where it works was left as it was.` };
  }

  // A practice with no address yet takes the first one someone working there
  // brings, so everyone filed after them gets it without typing it again.
  const practiceHasAddress = PARTS.some((k) => String(practice![k] ?? '').trim() !== '');
  if (!practiceHasAddress && hasOwnAddressParts(data) && input.uses_practice_address !== false) {
    const parts: Record<string, unknown> = {};
    for (const k of PARTS) parts[k] = data[k] ?? null;
    parts['address'] = data['address'] ?? null;
    await db('providers').where({ id: practice.id }).update(parts);
    practice = { ...practice, ...parts };
    await syncPracticeMembers(practice.id);
    return {
      columns: { practice_id: practice.id, organisation: practice.name, uses_practice_address: true },
      note: created ? `Filed ${practice.name} as a new practice at this address.` : `${practice.name} now has this address too.`,
    };
  }

  // Share the practice's address unless told otherwise, or unless this write
  // gives an address of its own.
  const share = mentionsSharing ? input.uses_practice_address! : !hasOwnAddressParts(data);
  const columns: Record<string, unknown> = {
    practice_id: practice.id,
    organisation: practice.name,
    uses_practice_address: share,
    ...(share ? addressCopy(practice) : {}),
  };
  return { columns, note: created ? `Filed ${practice.name} as a new practice.` : null };
}

/**
 * After a practice changes, bring everyone who works there up to date:
 * their organisation name, and their address while they share it.
 */
export async function syncPracticeMembers(practiceId: string, seen: Set<string> = new Set()): Promise<void> {
  // A place can be inside a place (a clinic inside a health hub, a doctor
  // inside the clinic), so a change carries all the way down, once each.
  if (seen.has(practiceId) || seen.size > 50) return;
  seen.add(practiceId);
  const practice = await db('providers').where({ id: practiceId }).first();
  if (!practice) return;
  await db('providers').where({ practice_id: practiceId }).update({ organisation: practice.name });
  await db('providers').where({ practice_id: practiceId, uses_practice_address: true }).update(addressCopy(practice));
  const children: Array<{ id: string }> = await db('providers').where({ practice_id: practiceId }).select('id');
  for (const child of children) await syncPracticeMembers(child.id, seen);
}

export interface NewMember {
  name: string;
  /** The bigger place the practice itself is in, e.g. a health hub. */
  part_of?: string | null;
  provider_type?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * File a practitioner at a practice, the one-sentence way: "add Dr Carly
 * Examplename to Health Hub Morayfield". The practice is found or filed,
 * the practitioner is found (by name, in the same account) or filed, and
 * they take the practice's address. Saying it twice changes nothing.
 */
export async function addPracticeMember(
  accountId: string,
  practitionerName: string,
  practiceName: string,
  details: Omit<NewMember, 'name'> = {}
): Promise<{ outcome: string; practitionerId: string; practiceId: string }> {
  const found = await findOrCreatePractice(accountId, practiceName);
  let practice = found.practice;
  const practiceCreated = found.created;
  // "Dr X at the Neuro Clinic in Health Hub Morayfield": file the clinic in
  // the hub too, before the person, so the person takes the right address.
  let placed = '';
  if (details.part_of?.trim()) {
    const { practice: hub } = await findOrCreatePractice(accountId, details.part_of);
    if (hub.id !== practice.id && practice.practice_id !== hub.id) {
      placed = ` ${await attachToPractice(practice, hub)}`;
      practice = await db('providers').where({ id: practice.id }).first();
    }
  }
  const name = practitionerName.trim().replace(/\s+/g, ' ');
  const existing: ProviderRow | undefined = await db('providers')
    .where({ account_id: accountId })
    .whereNot({ id: practice.id })
    .whereRaw("lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(?)", [name])
    .first();

  const filedPractice = `${practiceCreated ? ` ${practice.name} was not filed yet, so it is now. Add its address once and everyone there shares it.` : ''}${placed}`;

  if (existing) {
    const outcome = await attachToPractice(existing, practice, details);
    return { outcome: `${outcome}${filedPractice}`, practitionerId: existing.id, practiceId: practice.id };
  }

  const type = await storeProviderType(details.provider_type ?? (/^dr\.?\s/i.test(name) ? 'gp' : 'other'), accountId);
  const [row] = await db('providers')
    .insert({
      account_id: accountId,
      provider_type: type,
      name,
      phone: details.phone ?? null,
      email: details.email ?? null,
      practice_id: practice.id,
      organisation: practice.name,
      uses_practice_address: true,
      ...addressCopy(practice),
    })
    .returning('id');
  return {
    outcome: `Added ${name} at ${practice.name}${practice['address'] ? `, ${practice['address']}` : ''}.${filedPractice}`,
    practitionerId: (row as { id: string }).id,
    practiceId: practice.id,
  };
}

/** Point an existing provider at a practice, sharing its address when they have none of their own. */
async function attachToPractice(
  existing: ProviderRow,
  practice: ProviderRow,
  details: Omit<NewMember, 'name'> = {}
): Promise<string> {
  if (existing.practice_id === practice.id) return `${existing.name} is already based at ${practice.name}.`;
  if (await wouldLoop(existing.id, practice.id)) return `${existing.name} cannot be based at ${practice.name}, because ${practice.name} is already based there.`;
  const update: Record<string, unknown> = { practice_id: practice.id, organisation: practice.name };
  const ownAddress = PARTS.some((k) => String(existing[k] ?? '').trim() !== '');
  if (!ownAddress || existing['uses_practice_address']) Object.assign(update, { uses_practice_address: true, ...addressCopy(practice) });
  if (details.phone && !existing['phone']) update['phone'] = details.phone;
  if (details.email && !existing['email']) update['email'] = details.email;
  if (details.provider_type) update['provider_type'] = await storeProviderType(details.provider_type, existing.account_id);
  await db('providers').where({ id: existing.id }).update(update);
  return `${existing.name} is now based at ${practice.name}.`;
}

/** File one chosen provider, by id, at a practice in the same account. */
export async function attachMemberById(practiceId: string, memberId: string): Promise<string | null> {
  const practice: ProviderRow | undefined = await db('providers').where({ id: practiceId }).first();
  if (!practice || practiceId === memberId) return null;
  const member: ProviderRow | undefined = await db('providers').where({ id: memberId, account_id: practice.account_id }).first();
  if (!member) return null;
  return attachToPractice(member, practice);
}

/** Take a practitioner out of a practice. They keep their own copy of the address. */
export async function removePracticeMember(practiceId: string, memberId: string): Promise<boolean> {
  const n = await db('providers')
    .where({ id: memberId, practice_id: practiceId })
    .update({ practice_id: null, organisation: null, uses_practice_address: false });
  return n > 0;
}

/** The people filed at a practice, for showing on its record. */
export async function practiceMembers(practiceId: string): Promise<Array<{ id: string; name: string; provider_type: string }>> {
  return db('providers').where({ practice_id: practiceId }).select('id', 'name', 'provider_type').orderBy('name', 'asc');
}
