import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { dosesDue } from '../services/doses';
import { isValidTimeZone } from '../lib/timezone';

export const medicineRoundRouter = Router();

/**
 * Everyone this account records doses for: profiles it owns and circles it
 * helps in, never one where it may only look. Someone who has died has no
 * round.
 */
export async function roundProfiles(accountId: string): Promise<Array<{ id: string; full_name: string; preferred_name: string | null; room_number: string | null }>> {
  return db('care_profiles as cp')
    .where('cp.archived', false)
    .whereNull('cp.died_on')
    .where('cp.kind', 'person')
    // In hospital, the hospital gives the medicines.
    .whereNotExists(db('hospital_stays as hs').whereRaw('hs.care_profile_id = cp.id').whereNull('hs.discharged_on'))
    .where((w) =>
      w.where('cp.account_id', accountId).orWhereExists(
        db('care_circle_members as m')
          .whereRaw('m.care_profile_id = cp.id')
          .where({ 'm.account_id': accountId, 'm.invite_accepted': true })
          .whereNot('m.permission', 'viewer')
      )
    )
    .select('cp.id', 'cp.full_name', 'cp.preferred_name', 'cp.room_number');
}

/**
 * The medicine round: every dose due from two hours ago to two hours ahead,
 * across everyone the account records doses for, with the room, the person,
 * the medicine, the dose, the time, the instructions and whether they have
 * an allergy on file. Recording goes through each person's own dose route,
 * so their own access is checked dose by dose.
 */
medicineRoundRouter.get('/', requireAuth, async (req, res) => {
  const tz = typeof req.query['tz'] === 'string' && isValidTimeZone(req.query['tz']) ? req.query['tz'] : null;
  const people = await roundProfiles(req.account!.id);
  const ids = people.map((p) => p.id);
  const [due, allergies] = await Promise.all([
    dosesDue(db, ids, { timeZone: tz }),
    ids.length
      ? db('allergies').whereIn('care_profile_id', ids).orderBy('substance', 'asc').select('care_profile_id', 'substance', 'reaction')
      : Promise.resolve([]),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const allergyMap = new Map<string, Array<{ substance: string; reaction: string | null }>>();
  for (const a of allergies as Array<{ care_profile_id: string; substance: string; reaction: string | null }>) {
    const list = allergyMap.get(a.care_profile_id) ?? [];
    list.push({ substance: a.substance, reaction: a.reaction });
    allergyMap.set(a.care_profile_id, list);
  }
  res.json({
    doses: due.map((d) => {
      const p = byId.get(d.profile_id)!;
      return {
        ...d,
        profile_name: p.full_name,
        preferred_name: p.preferred_name,
        room_number: p.room_number,
        allergies: allergyMap.get(d.profile_id) ?? [],
      };
    }),
    people_count: new Set(due.map((d) => d.profile_id)).size,
  });
});
