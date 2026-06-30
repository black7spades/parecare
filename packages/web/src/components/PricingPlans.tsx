import { useQuery, useMutation } from '@tanstack/react-query';
import { subscriptionsApi, type Plan } from '../api/subscriptions';
import { useSubscriptionStore } from '../stores/subscription';
import { Button } from './ui/Button';

export function PricingPlans() {
  const { data, isLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => subscriptionsApi.getPlans(),
  });

  const { tier: currentTier } = useSubscriptionStore();

  const checkoutMutation = useMutation({
    mutationFn: (tier: 'family' | 'professional') => subscriptionsApi.checkout(tier),
    onSuccess: (data) => { window.location.href = data.url; },
  });

  const portalMutation = useMutation({
    mutationFn: () => subscriptionsApi.portal(),
    onSuccess: (data) => { window.location.href = data.url; },
  });

  if (isLoading) {
    return <div className="text-sm text-muted py-8 text-center">Loading plans...</div>;
  }

  const plans = data?.plans ?? [];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((plan: Plan) => {
        const isCurrent = plan.id === currentTier;
        const isUpgrade =
          (currentTier === 'free' && plan.id !== 'free') ||
          (currentTier === 'family' && plan.id === 'professional');

        return (
          <div
            key={plan.id}
            className={`card flex flex-col ${isCurrent ? 'border-primary ring-1 ring-primary' : ''}`}
          >
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold">{plan.name}</h3>
                {isCurrent ? (
                  <span className="badge bg-primary-50 text-primary">Current plan</span>
                ) : null}
              </div>
              <p className="text-muted text-xs mb-3">{plan.description}</p>
              <div className="text-2xl font-semibold">
                {plan.price_monthly === 0 ? (
                  'Free'
                ) : (
                  <>
                    ${plan.price_monthly}
                    <span className="text-sm font-normal text-muted">/mo</span>
                  </>
                )}
              </div>
            </div>
            <ul className="flex-1 mb-6 space-y-2">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <svg className="h-4 w-4 text-primary mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <div>
              {isCurrent ? (
                plan.id !== 'free' ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    loading={portalMutation.isPending}
                    onClick={() => portalMutation.mutate()}
                  >
                    Manage billing
                  </Button>
                ) : (
                  <Button variant="secondary" className="w-full" disabled>
                    Current plan
                  </Button>
                )
              ) : isUpgrade && plan.id !== 'free' ? (
                <Button
                  className="w-full"
                  loading={checkoutMutation.isPending}
                  onClick={() => checkoutMutation.mutate(plan.id as 'family' | 'professional')}
                >
                  Upgrade to {plan.name}
                </Button>
              ) : (
                <Button variant="secondary" className="w-full" disabled>
                  {plan.id === 'free' ? 'Self-hosted only' : 'Contact support'}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
