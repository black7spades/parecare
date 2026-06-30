import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import {
  createCheckoutSession,
  createBillingPortalSession,
  PLAN_DETAILS,
} from '../services/subscriptions';
import { env } from '../config/env';

export const subscriptionsRouter = Router();

subscriptionsRouter.get('/plans', (_req, res) => {
  res.json({ plans: PLAN_DETAILS.map((p) => ({ ...p })) });
});

subscriptionsRouter.get('/me', requireAuth, (req, res) => {
  const account = req.account!;
  res.json({
    tier: account.subscription_tier,
    status: account.subscription_status,
    current_period_end: account.current_period_end,
    ai_tokens_used: account.ai_tokens_used,
    ai_tokens_reset_at: account.ai_tokens_reset_at,
  });
});

subscriptionsRouter.post('/checkout', requireAuth, async (req, res) => {
  if (env.SELF_HOSTED) {
    res.status(400).json({
      error: 'Subscriptions are not available in self-hosted mode',
      code: 'SELF_HOSTED',
    });
    return;
  }

  const schema = z.object({ tier: z.enum(['family', 'professional']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid tier', code: 'VALIDATION_ERROR' });
    return;
  }

  try {
    const url = await createCheckoutSession(req.account!, parsed.data.tier);
    res.json({ url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session', code: 'STRIPE_ERROR' });
  }
});

subscriptionsRouter.post('/portal', requireAuth, async (req, res) => {
  if (env.SELF_HOSTED) {
    res.status(400).json({
      error: 'Billing portal is not available in self-hosted mode',
      code: 'SELF_HOSTED',
    });
    return;
  }

  if (!req.account!.stripe_customer_id) {
    res.status(400).json({
      error: 'No subscription found. Start a subscription first.',
      code: 'NO_SUBSCRIPTION',
    });
    return;
  }

  try {
    const url = await createBillingPortalSession(req.account!);
    res.json({ url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'Failed to create billing portal session', code: 'STRIPE_ERROR' });
  }
});
