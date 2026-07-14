import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

export const activityRouter = Router({ mergeParams: true });

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
        'accounts.display_name as actor_name'
      ),
    db('audit_log').where({ care_profile_id: req.params['id'] }).count<{ count: string }>('id as count').first(),
  ]);

  res.json({ entries, total: Number(totalRow?.count ?? 0), page, limit });
});
