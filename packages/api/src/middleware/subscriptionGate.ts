import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { env } from '../config/env';
import type { SubscriptionTier } from '../types';

export const PLAN_LIMITS = {
  care_profiles: { free: 2, family: Infinity, professional: Infinity },
  care_circle_members: { free: Infinity, family: 6, professional: Infinity },
  ai_access: { free: false, family: true, professional: true },
  s3_storage: { free: false, family: true, professional: true },
  multiple_families: { free: false, family: false, professional: true },
} as const;

type FeatureKey = keyof typeof PLAN_LIMITS;

function getEffectiveTier(account: NonNullable<Request['account']>): SubscriptionTier {
  if (env.SELF_HOSTED) return 'professional';
  const { subscription_tier, subscription_status } = account;
  if (subscription_status === 'active' || subscription_status === 'trialing') {
    return subscription_tier;
  }
  return 'free';
}

export function requireFeature(feature: FeatureKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.account) {
      res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
      return;
    }
    const tier = getEffectiveTier(req.account);
    const limit = PLAN_LIMITS[feature][tier];

    if (limit === false) {
      res.status(402).json({
        error: 'This feature requires an upgraded plan',
        code: 'SUBSCRIPTION_REQUIRED',
        feature,
        current_tier: tier,
        upgrade_url: '/account/subscription',
      });
      return;
    }
    next();
  };
}

export function requireCountBelow(
  feature: 'care_profiles' | 'care_circle_members',
  countFn: (req: Request) => Promise<number>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.account) {
      res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
      return;
    }
    const tier = getEffectiveTier(req.account);
    const limit = PLAN_LIMITS[feature][tier];
    if (limit === Infinity) {
      next();
      return;
    }

    const current = await countFn(req);
    if (current >= limit) {
      res.status(402).json({
        error: `You have reached the limit for your plan`,
        code: 'PLAN_LIMIT_REACHED',
        feature,
        current_tier: tier,
        limit,
        upgrade_url: '/account/subscription',
      });
      return;
    }
    next();
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Verify the requester owns the care profile or is an accepted circle member.
export async function requireCareProfileAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.account) {
    res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
    return;
  }
  const profileId = req.params['id'] || req.params['profileId'];
  if (!profileId) {
    next();
    return;
  }
  if (!UUID_RE.test(profileId)) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }

  const profile = await db('care_profiles').where({ id: profileId, archived: false }).first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  if (profile.account_id === req.account.id) {
    req.careAccess = { level: 'owner', member: null };
    next();
    return;
  }
  const membership = await db('care_circle_members')
    .where({ care_profile_id: profileId, account_id: req.account.id, invite_accepted: true })
    .first();
  if (!membership) {
    // 404 rather than 403 so outsiders can't confirm a profile exists
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  req.careAccess = {
    level: membership.permission === 'viewer' ? 'viewer' : 'contributor',
    member: membership,
  };
  next();
}
