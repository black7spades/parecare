import Stripe from 'stripe';
import { db } from '../config/database';
import { env } from '../config/env';
import type { Account, SubscriptionTier, SubscriptionStatus } from '../types';

function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
}

export async function getOrCreateCustomer(account: Account): Promise<string> {
  if (account.stripe_customer_id) return account.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: account.email,
    name: account.display_name,
    metadata: { accountId: account.id },
  });

  await db('accounts')
    .where({ id: account.id })
    .update({ stripe_customer_id: customer.id, updated_at: db.fn.now() });

  return customer.id;
}

export async function createCheckoutSession(
  account: Account,
  tier: 'family' | 'professional'
): Promise<string> {
  const stripe = getStripe();
  const priceId =
    tier === 'family' ? env.STRIPE_PRICE_FAMILY : env.STRIPE_PRICE_PROFESSIONAL;

  if (!priceId) {
    throw new Error(`Price ID not configured for tier: ${tier}`);
  }

  const customerId = await getOrCreateCustomer(account);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.APP_URL}/account/subscription?checkout=success`,
    cancel_url: `${env.APP_URL}/account/subscription?checkout=canceled`,
    metadata: { accountId: account.id, tier },
    subscription_data: {
      metadata: { accountId: account.id, tier },
    },
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}

export async function createBillingPortalSession(account: Account): Promise<string> {
  const stripe = getStripe();

  if (!account.stripe_customer_id) {
    throw new Error('Account has no Stripe customer ID');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    return_url: `${env.APP_URL}/account/subscription`,
  });

  return session.url;
}

export async function syncSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription
): Promise<void> {
  const accountId = stripeSubscription.metadata['accountId'];
  if (!accountId) {
    console.warn('Stripe subscription missing accountId metadata:', stripeSubscription.id);
    return;
  }

  const tier = (stripeSubscription.metadata['tier'] as SubscriptionTier) ?? 'free';
  const status = stripeSubscription.status as SubscriptionStatus;
  const periodEnd = new Date(stripeSubscription.current_period_end * 1000);
  const isActive = status === 'active' || status === 'trialing';

  await db('accounts').where({ id: accountId }).update({
    subscription_tier: isActive ? tier : 'free',
    subscription_status: status,
    stripe_subscription_id: stripeSubscription.id,
    current_period_end: periodEnd,
    updated_at: db.fn.now(),
  });
}

export async function cancelSubscriptionInDb(
  stripeSubscription: Stripe.Subscription
): Promise<void> {
  const accountId = stripeSubscription.metadata['accountId'];
  if (!accountId) return;

  await db('accounts').where({ id: accountId }).update({
    subscription_tier: 'free',
    subscription_status: 'canceled',
    stripe_subscription_id: null,
    current_period_end: null,
    updated_at: db.fn.now(),
  });
}

export const PLAN_DETAILS = [
  {
    id: 'free',
    name: 'Free',
    description: 'Self-hosted. No payment required.',
    price_monthly: 0,
    price_id: null as string | null,
    features: [
      'Up to 2 care profiles',
      'Unlimited care log entries',
      'Checklists and care plans',
      'Basic provider directory',
      'Local document storage',
    ],
    limits: {
      care_profiles: 2,
      care_circle_members: null as number | null,
      ai_assistant: false,
      s3_storage: false,
    },
  },
  {
    id: 'family',
    name: 'Family',
    description: 'For families coordinating care together.',
    price_monthly: 12,
    get price_id() {
      return env.STRIPE_PRICE_FAMILY ?? null;
    },
    features: [
      'Unlimited care profiles',
      'Up to 6 care circle members',
      'AI care assistant (100k tokens/mo)',
      'Document storage (S3)',
      'Email reminders',
    ],
    limits: {
      care_profiles: null as number | null,
      care_circle_members: 6,
      ai_assistant: true,
      s3_storage: true,
    },
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'For care professionals managing multiple families.',
    price_monthly: 39,
    get price_id() {
      return env.STRIPE_PRICE_PROFESSIONAL ?? null;
    },
    features: [
      'Everything in Family',
      'Multiple family accounts',
      'Unlimited care circle members',
      'AI assistant (unlimited tokens)',
      'Priority support',
    ],
    limits: {
      care_profiles: null as number | null,
      care_circle_members: null as number | null,
      ai_assistant: true,
      s3_storage: true,
    },
  },
];
