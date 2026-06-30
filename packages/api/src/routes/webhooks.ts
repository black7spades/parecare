import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { env } from '../config/env';
import { syncSubscriptionFromStripe, cancelSubscriptionInDb } from '../services/subscriptions';

export const webhookRouter = Router();

webhookRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    res.status(500).json({ error: 'Stripe not configured', code: 'CONFIG_ERROR' });
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    res.status(400).json({ error: 'Missing stripe-signature header', code: 'BAD_REQUEST' });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
    // req.body is a Buffer from express.raw() — must not be parsed as JSON
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    console.error('Stripe webhook signature verification failed:', msg);
    res.status(400).json({ error: 'Webhook signature invalid', code: 'WEBHOOK_INVALID' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await syncSubscriptionFromStripe(sub);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscriptionFromStripe(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await cancelSubscriptionInDb(sub);
        break;
      }
      default:
        break;
    }

    // Always return 200 — Stripe retries on non-2xx
    res.status(200).json({ received: true });
  } catch (err) {
    // Log error but return 200 to prevent Stripe from spamming retries on transient DB errors
    console.error('Webhook handler error:', err);
    res.status(200).json({ received: true, warning: 'Handler error logged' });
  }
});
