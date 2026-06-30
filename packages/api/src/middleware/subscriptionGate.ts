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

export function requireCareProfileAccess(req: Request, res: Response, next: NextFunction): void {
  if (!req.account) {
    res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
    return;
  }
  // Verify care profile belongs to this account
  const profileId = req.params['id'] || req.params['profileId'];
  if (!profileId) {
    next();
    return;
  }

  db('care_profiles')
    .where({ id: profileId, account_id: req.account.id, archived: false })
    .first()
    .then((profile) => {
      if (!profile) {
        res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
        return;
      }
      next();
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    });
}
