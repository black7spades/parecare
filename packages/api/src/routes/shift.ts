import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { mainContact } from '../services/professionals';
import { emergencyContactsFor } from '../services/emergencyContacts';
import { doseHistory, dosesDue } from '../services/doses';
import { isValidTimeZone } from '../lib/timezone';

export const shiftRouter = Router({ mergeParams: true });

// A visit counts as new after this long away, the same as Recent activity.
const NEW_VISIT_AFTER_MS = 60 * 60 * 1000;
const FIRST_LOOK_DAYS = 14;

const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Everything someone starting a shift needs before they do anything, in one
 * call: what not to give, who to call, what is due now, the care needs, the
 * last handover and who wrote it, and how much changed since they last
 * looked. Reading it records nothing: the visit is recorded by Recent
 * activity, so the two always agree on "since your last visit".
 */
shiftRouter.get('/', requireAuth, async (req, res) => {
  const profileId = String(req.params['id']);
  const accountId = req.account!.id;
  const tz = typeof req.query['tz'] === 'string' && isValidTimeZone(req.query['tz']) ? req.query['tz'] : null;
  const now = new Date();

  const [allergies, gp, emergency, due, plan, handover, visit, asNeeded] = await Promise.all([
    db('allergies').where({ care_profile_id: profileId }).orderBy('substance', 'asc').select('id', 'substance', 'reaction'),
    mainContact(db, profileId, 'gp'),
    emergencyContactsFor(profileId),
    dosesDue(db, [profileId], { now, timeZone: tz }),
    db('care_plans').where({ care_profile_id: profileId }).first('dietary_requirements', 'mobility_aids', 'communication_needs'),
    db('care_log_entries as e')
      .leftJoin('accounts as acc', 'acc.id', 'e.author_account_id')
      .leftJoin('care_circle_members as m', 'm.id', 'e.author_member_id')
      .where({ 'e.care_profile_id': profileId, 'e.entry_type': 'handover' })
      .orderBy('e.occurred_at', 'desc')
      .first('e.id', 'e.title', 'e.body', 'e.occurred_at', db.raw('coalesce(acc.display_name, m.display_name) as author_name')),
    db('profile_visits').where({ account_id: accountId, care_profile_id: profileId }).first('seen_at', 'previous_seen_at'),
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .where({ 'm.care_profile_id': profileId, 'm.active': true, 'm.as_needed': true })
      .orderBy('c.name', 'asc')
      .select('m.id', 'c.name', 'm.dose', 'm.instructions', 'm.as_needed_for', 'm.min_hours_between_doses', 'm.max_doses_per_day'),
  ]);

  // The same "since" Recent activity uses, without moving it.
  let since: Date;
  if (!visit) since = new Date(now.getTime() - FIRST_LOOK_DAYS * 24 * 3600 * 1000);
  else if (now.getTime() - new Date(visit.seen_at).getTime() > NEW_VISIT_AFTER_MS) since = new Date(visit.seen_at);
  else since = visit.previous_seen_at ? new Date(visit.previous_seen_at) : new Date(visit.seen_at);
  const changed = (await db('audit_log')
    .where({ care_profile_id: profileId })
    .where('created_at', '>', since)
    .count<{ n: string }[]>('id as n')
    .first()) as { n: string } | undefined;

  const history = await doseHistory(db, (asNeeded as Array<{ id: string }>).map((m) => m.id));

  res.json({
    shift: {
      allergies,
      gp,
      emergency_contact: emergency[0] ?? null,
      due_now: due,
      as_needed: (asNeeded as Array<Record<string, unknown> & { id: string }>).map((m) => ({
        id: m.id,
        name: m['name'],
        dose: m['dose'],
        instructions: m['instructions'],
        as_needed_for: m['as_needed_for'],
        min_hours_between_doses: num(m['min_hours_between_doses']),
        max_doses_per_day: num(m['max_doses_per_day']),
        ...(history.get(m.id) ?? { last_given_at: null, last_given_by: null, given_24h: 0, recent_given: [] }),
      })),
      care_needs: {
        diet: asList(plan?.dietary_requirements),
        mobility: asList(plan?.mobility_aids),
        communication: asList(plan?.communication_needs),
      },
      last_handover: handover ?? null,
      changes_since: Number(changed?.n ?? 0),
      since: since.toISOString(),
    },
  });
});
