import { useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { subscriptionsApi } from '../../api/subscriptions';
import { useSubscriptionStore } from '../../stores/subscription';
import { PricingPlans } from '../../components/PricingPlans';
import { Button } from '../../components/ui/Button';

export function SubscriptionPage() {
  const [searchParams] = useSearchParams();
  const checkoutResult = searchParams.get('checkout');
  const { setSubscription } = useSubscriptionStore();

  const { data, isLoading } = useQuery({
    queryKey: ['subscription-me'],
    queryFn: () => subscriptionsApi.getMe(),
  });

  useEffect(() => {
    if (data) setSubscription(data);
  }, [data, setSubscription]);

  const portalMutation = useMutation({
    mutationFn: () => subscriptionsApi.portal(),
    onSuccess: (d) => { window.location.href = d.url; },
  });

  if (isLoading) {
    return <div className="text-sm text-muted py-8">Loading...</div>;
  }

  const sub = data;
  const tierLabel = sub?.tier ?? 'free';
  const tierDisplay = tierLabel.charAt(0).toUpperCase() + tierLabel.slice(1);

  const aiLimit =
    tierLabel === 'professional' ? null : tierLabel === 'family' ? 100_000 : 0;

  return (
    <div className="space-y-8">
      <h1>Subscription</h1>

      {checkoutResult === 'success' ? (
        <div className="rounded-md bg-primary-50 border border-primary-100 px-4 py-3 text-sm text-primary">
          Your subscription is now active.
        </div>
      ) : checkoutResult === 'canceled' ? (
        <div className="rounded-md bg-surface-2 border border-border px-4 py-3 text-sm text-muted">
          Checkout was not completed.
        </div>
      ) : null}

      <div className="card">
        <h2 className="mb-4">Current plan</h2>
        <div className="flex items-center gap-3 mb-4">
          <span className="badge bg-primary-50 text-primary text-sm px-3 py-1">
            {tierDisplay}
          </span>
          {sub?.status ? (
            <span className={`badge text-xs ${sub.status === 'active' ? 'bg-green-50 text-green-700' : sub.status === 'past_due' ? 'bg-yellow-50 text-yellow-700' : 'bg-surface-2 text-muted'}`}>
              {sub.status.replace('_', ' ')}
            </span>
          ) : null}
        </div>

        {sub?.current_period_end ? (
          <p className="text-sm text-muted mb-4">
            {sub.status === 'canceled' ? 'Plan ends on' : 'Renews on'}{' '}
            {format(new Date(sub.current_period_end), 'd MMMM yyyy')}
          </p>
        ) : null}

        {tierLabel !== 'free' ? (
          <Button
            variant="secondary"
            size="sm"
            loading={portalMutation.isPending}
            onClick={() => portalMutation.mutate()}
          >
            Manage billing
          </Button>
        ) : null}
      </div>

      {tierLabel !== 'free' && aiLimit !== null ? (
        <div className="card">
          <h2 className="mb-4">AI assistant usage</h2>
          <div className="mb-2 flex justify-between text-sm">
            <span>{(sub?.ai_tokens_used ?? 0).toLocaleString()} tokens used</span>
            <span className="text-muted">of {aiLimit.toLocaleString()}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.min(100, ((sub?.ai_tokens_used ?? 0) / aiLimit) * 100)}%` }}
            />
          </div>
          {sub?.ai_tokens_reset_at ? (
            <p className="mt-2 text-xs text-muted">
              Resets on {format(new Date(sub.ai_tokens_reset_at), 'd MMMM yyyy')}
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <h2 className="mb-4">Plans</h2>
        <PricingPlans />
      </div>
    </div>
  );
}
