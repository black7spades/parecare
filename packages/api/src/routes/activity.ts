import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

export const activityRouter = Router({ mergeParams: true });

// A visit counts as new after this long away. Shorter, and a reload or a
// quick trip to another tab would empty the list mid-read.
const NEW_VISIT_AFTER_MS = 60 * 60 * 1000;
// Someone looking for the first time sees the last two weeks.
const FIRST_LOOK_DAYS = 14;
const RECENT_LIMIT = 200;

/**
 * What changed since this person last looked at this profile. Reading it
 * also records the look, so the next visit starts from here.
 */
activityRouter.get('/recent', requireAuth, async (req, res) => {
  const profileId = req.params['id'];
  const accountId = req.account!.id;
  const now = new Date();

  const visit = await db('profile_visits').where({ account_id: accountId, care_profile_id: profileId }).first<{
    seen_at: Date;
    previous_seen_at: Date | null;
  }>();

  let since: Date;
  if (!visit) {
    since = new Date(now.getTime() - FIRST_LOOK_DAYS * 24 * 60 * 60 * 1000);
    await db('profile_visits')
      .insert({ account_id: accountId, care_profile_id: profileId, seen_at: now, previous_seen_at: since })
      .onConflict(['account_id', 'care_profile_id'])
      .ignore();
  } else if (now.getTime() - new Date(visit.seen_at).getTime() > NEW_VISIT_AFTER_MS) {
    since = new Date(visit.seen_at);
    await db('profile_visits')
      .where({ account_id: accountId, care_profile_id: profileId })
      .update({ seen_at: now, previous_seen_at: since });
  } else {
    since = visit.previous_seen_at ? new Date(visit.previous_seen_at) : new Date(visit.seen_at);
  }

  const entries = await db('audit_log')
    .leftJoin('accounts', 'audit_log.actor_account_id', 'accounts.id')
    .where('audit_log.care_profile_id', profileId)
    .andWhere('audit_log.created_at', '>', since)
    .orderBy('audit_log.created_at', 'desc')
    .limit(RECENT_LIMIT)
    .select(
      'audit_log.id',
      'audit_log.action',
      'audit_log.entity_type',
      'audit_log.entity_id',
      'audit_log.summary',
      'audit_log.created_at',
      'audit_log.source',
      'audit_log.actor_account_id',
      'accounts.display_name as actor_name'
    );

  res.json({ since: since.toISOString(), entries });
});

activityRouter.get('/', requireAuth, async (req, res) => {
  const page = Math.max(Number(req.query['page'] ?? 1), 1);
  const limit = Math.min(Number(req.query['limit'] ?? 50), 5000);

  const [entries, totalRow] = await Promise.all([
    db('audit_log')
      .leftJoin('accounts', 'audit_log.actor_account_id', 'accounts.id')
      .where({ care_profile_id: req.params['id'] })
      .orderBy('audit_log.created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .select(
        'audit_log.id',
        'audit_log.action',
        'audit_log.entity_type',
        'audit_log.summary',
        'audit_log.created_at',
        'audit_log.source',
        'audit_log.entity_id',
        'accounts.display_name as actor_name'
      ),
    db('audit_log').where({ care_profile_id: req.params['id'] }).count<{ count: string }>('id as count').first(),
  ]);

  res.json({ entries, total: Number(totalRow?.count ?? 0), page, limit });
});
