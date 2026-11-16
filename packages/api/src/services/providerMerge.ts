import type { Knex } from 'knex';
import { db } from '../config/database';
import { syncPracticeMembers } from './providerPractices';
import { similarName } from '../lib/providerNames';

/**
 * Two provider records for the same thing, made one.
 *
 * Merging moves everything that points at the duplicate onto the record
 * being kept (the people it is linked to, appointments, people who live or
 * are contacted there, and whatever is based there), fills the kept
 * record's empty details from the duplicate, keeps the duplicate's name as
 * another name so it is still found by it, and removes the duplicate. What
 * changed is recorded, so the whole merge can be undone for a while.
 *
 * Likely duplicates are spotted by name, so nobody has to go looking.
 */

export const MERGE_UNDO_MS = 30 * 60 * 1000;

const PARTS = ['address_line1', 'address_line2', 'address_suburb', 'address_state', 'address_postcode', 'address_country'] as const;
const FILLABLE = ['phone', 'email', 'booking_link', 'directions_link'] as const;

type Row = Record<string, unknown> & {
  id: string;
  account_id: string;
  name: string;
  provider_type: string;
  practice_id: string | null;
  also_known_as: string[] | null;
};

export interface DuplicatePair {
  first: { id: string; name: string; provider_type: string; kind: string; address: string | null };
  second: { id: string; name: string; provider_type: string; kind: string; address: string | null };
}

/** Pairs in one account that look like the same provider, not yet dismissed. */
export async function likelyDuplicates(accountId: string): Promise<DuplicatePair[]> {
  const rows: Row[] = await db('providers').where({ account_id: accountId }).orderBy('name', 'asc').limit(2000);
  const dismissed = new Set(
    (await db('provider_duplicate_dismissals').where({ account_id: accountId }).select('first_id', 'second_id')).map(
      (r: { first_id: string; second_id: string }) => `${r.first_id}|${r.second_id}`
    )
  );
  const names = (r: Row) => [r.name, ...(r.also_known_as ?? [])];
  const brief = (r: Row) => ({ id: r.id, name: r.name, provider_type: r.provider_type, kind: (r['kind'] as string) ?? 'person', address: (r['address'] as string | null) ?? null });
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i]!;
      const b = rows[j]!;
      // A clinic inside a hub is not a duplicate of the hub.
      if (a.practice_id === b.id || b.practice_id === a.id) continue;
      const [x, y] = a.id < b.id ? [a, b] : [b, a];
      if (dismissed.has(`${x.id}|${y.id}`)) continue;
      if (names(a).some((na) => names(b).some((nb) => similarName(na, nb)))) pairs.push({ first: brief(a), second: brief(b) });
      if (pairs.length >= 50) return pairs;
    }
  }
  return pairs;
}

export async function dismissDuplicate(accountId: string, aId: string, bId: string): Promise<void> {
  const [first, second] = aId < bId ? [aId, bId] : [bId, aId];
  await db('provider_duplicate_dismissals').insert({ account_id: accountId, first_id: first, second_id: second }).onConflict(['first_id', 'second_id']).ignore();
}

interface Moved {
  links_moved: string[];
  links_removed: Record<string, unknown>[];
  appointments: string[];
  contact_profiles: string[];
  residence_profiles: string[];
  based_here: string[];
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

/**
 * Merge `removeId` into `keepId`. Both must be in the same account; the
 * caller checks the person may change them. Returns the merge's id for
 * undoing it, and a plain summary.
 */
export async function mergeProviders(
  keepId: string,
  removeId: string,
  actorId: string
): Promise<{ mergeId: string; summary: string } | { error: string }> {
  if (keepId === removeId) return { error: 'Pick two different records to merge.' };
  const result = await db.transaction(async (trx: Knex.Transaction) => {
    const keep: Row | undefined = await trx('providers').where({ id: keepId }).forUpdate().first();
    const remove: Row | undefined = await trx('providers').where({ id: removeId }).forUpdate().first();
    if (!keep || !remove) return { error: 'One of those records is no longer there. Refresh the page and try again.' };
    if (keep.account_id !== remove.account_id) return { error: 'Those two records belong to different accounts, so they cannot be merged.' };

    const moved: Moved = { links_moved: [], links_removed: [], appointments: [], contact_profiles: [], residence_profiles: [], based_here: [] };

    // People linked to the duplicate: move the link, unless they are already
    // linked to the kept record, in which case the duplicate's link goes.
    const links = await trx('care_profile_providers').where({ provider_id: removeId });
    const alreadyLinked = new Set(
      (await trx('care_profile_providers').where({ provider_id: keepId }).select('care_profile_id')).map((r: { care_profile_id: string }) => r.care_profile_id)
    );
    for (const link of links) {
      if (alreadyLinked.has(link.care_profile_id)) {
        moved.links_removed.push(link);
        await trx('care_profile_providers').where({ id: link.id }).delete();
      } else {
        moved.links_moved.push(link.id);
        await trx('care_profile_providers').where({ id: link.id }).update({ provider_id: keepId });
      }
    }

    moved.appointments = ids(await trx('appointments').where({ provider_id: removeId }).update({ provider_id: keepId }).returning('id'));
    moved.contact_profiles = ids(await trx('care_profiles').where({ contact_provider_id: removeId }).update({ contact_provider_id: keepId }).returning('id'));
    moved.residence_profiles = ids(await trx('care_profiles').where({ residence_provider_id: removeId }).update({ residence_provider_id: keepId }).returning('id'));
    moved.based_here = ids(
      await trx('providers').where({ practice_id: removeId }).whereNot({ id: keepId }).update({ practice_id: keepId }).returning('id')
    );

    // Fill the kept record's gaps from the duplicate.
    const update: Record<string, unknown> = {};
    for (const k of FILLABLE) if (!keep[k] && remove[k]) update[k] = remove[k];
    const keepHasAddress = PARTS.some((k) => String(keep[k] ?? '').trim() !== '');
    const removeHasAddress = PARTS.some((k) => String(remove[k] ?? '').trim() !== '');
    if (!keepHasAddress && removeHasAddress) {
      for (const k of PARTS) update[k] = remove[k] ?? null;
      update['address'] = remove['address'] ?? null;
    }
    // Where it is based: the kept record keeps its own; if it was based at
    // the duplicate, it takes the duplicate's place instead.
    let practiceId = keep.practice_id;
    if (practiceId === removeId) practiceId = remove.practice_id && remove.practice_id !== keepId ? remove.practice_id : null;
    else if (!practiceId && remove.practice_id && remove.practice_id !== keepId) practiceId = remove.practice_id;
    if (practiceId !== keep.practice_id) {
      update['practice_id'] = practiceId;
      const practice = practiceId ? await trx('providers').where({ id: practiceId }).select('name').first() : null;
      update['organisation'] = practice?.name ?? null;
      if (!practiceId) update['uses_practice_address'] = false;
    }
    const known = new Map<string, string>();
    for (const n of [...(keep.also_known_as ?? []), remove.name, ...(remove.also_known_as ?? [])]) {
      const clean = String(n ?? '').trim();
      if (clean && clean.toLowerCase() !== keep.name.trim().toLowerCase()) known.set(clean.toLowerCase(), clean);
    }
    update['also_known_as'] = [...known.values()];
    // Others are now based at the kept record, so it is an organisation.
    if (moved.based_here.length > 0) update['kind'] = 'organisation';
    await trx('providers').where({ id: keepId }).update(update);

    await trx('providers').where({ id: removeId }).delete();

    const [merge] = await trx('provider_merges')
      .insert({
        account_id: keep.account_id,
        actor_account_id: actorId,
        kept_id: keepId,
        removed_id: removeId,
        kept_before: JSON.stringify(keep),
        removed_before: JSON.stringify(remove),
        moved: JSON.stringify(moved),
      })
      .returning('id');

    const people = moved.links_moved.length;
    const here = moved.based_here.length;
    const appts = moved.appointments.length;
    const bits = [
      people ? `${people} ${people === 1 ? 'person' : 'people'} linked` : null,
      appts ? `${appts} ${appts === 1 ? 'appointment' : 'appointments'}` : null,
      here ? `${here} based there` : null,
    ].filter(Boolean);
    return {
      mergeId: (merge as { id: string }).id,
      summary: `Merged ${remove.name} into ${keep.name}.${bits.length ? ` Moved across: ${bits.join(', ')}.` : ''} ${remove.name} is kept as another name for it.`,
    };
  });
  if ('mergeId' in result) await syncPracticeMembers(keepId);
  return result;
}

/** Put both records back the way they were before a merge. */
export async function undoMerge(mergeId: string, accountId: string | null): Promise<{ message: string } | { error: string }> {
  const merge = await db('provider_merges').where({ id: mergeId }).first();
  if (!merge || (accountId && merge.account_id !== accountId)) return { error: 'There is nothing to undo for that merge.' };
  if (merge.undone_at) return { error: 'That merge was already undone.' };
  if (Date.now() - new Date(merge.created_at).getTime() > MERGE_UNDO_MS) {
    return { error: 'That merge is too old to undo now. Edit the records instead.' };
  }
  const keptBefore = typeof merge.kept_before === 'string' ? JSON.parse(merge.kept_before) : merge.kept_before;
  const removedBefore = typeof merge.removed_before === 'string' ? JSON.parse(merge.removed_before) : merge.removed_before;
  const moved: Moved = typeof merge.moved === 'string' ? JSON.parse(merge.moved) : merge.moved;

  const outcome = await db.transaction(async (trx: Knex.Transaction) => {
    const kept = await trx('providers').where({ id: merge.kept_id }).first();
    if (!kept) return { error: 'The record it was merged into has since been deleted, so the merge cannot be undone.' };
    await trx('providers').insert({ ...removedBefore, also_known_as: removedBefore.also_known_as ?? [] });
    const { id: _id, created_at: _created, ...keptFields } = keptBefore;
    await trx('providers').where({ id: merge.kept_id }).update({ ...keptFields, also_known_as: keptBefore.also_known_as ?? [] });
    if (moved.links_moved.length) await trx('care_profile_providers').whereIn('id', moved.links_moved).update({ provider_id: merge.removed_id });
    if (moved.links_removed.length) await trx('care_profile_providers').insert(moved.links_removed);
    if (moved.appointments.length) await trx('appointments').whereIn('id', moved.appointments).update({ provider_id: merge.removed_id });
    if (moved.contact_profiles.length) await trx('care_profiles').whereIn('id', moved.contact_profiles).update({ contact_provider_id: merge.removed_id });
    if (moved.residence_profiles.length) await trx('care_profiles').whereIn('id', moved.residence_profiles).update({ residence_provider_id: merge.removed_id });
    if (moved.based_here.length) await trx('providers').whereIn('id', moved.based_here).update({ practice_id: merge.removed_id });
    await trx('provider_merges').where({ id: mergeId }).update({ undone_at: trx.fn.now() });
    return { message: `Undone. ${removedBefore.name} and ${keptBefore.name} are two records again.` };
  });
  if ('message' in outcome) {
    await syncPracticeMembers(merge.kept_id);
    await syncPracticeMembers(merge.removed_id);
  }
  return outcome;
}
