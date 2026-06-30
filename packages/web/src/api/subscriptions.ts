import { api } from './client';

export interface Plan {
  id: string;
  name: string;
  description: string;
  price_monthly: number;
  price_id: string | null;
  features: string[];
  limits: {
    care_profiles: number | null;
    care_circle_members: number | null;
    ai_assistant: boolean;
    s3_storage: boolean;
  };
}

export interface SubscriptionStatus {
  tier: 'free' | 'family' | 'professional';
  status: string | null;
  current_period_end: string | null;
  ai_tokens_used: number;
  ai_tokens_reset_at: string | null;
}

export const subscriptionsApi = {
  getPlans: () => api.get<{ plans: Plan[] }>('/subscriptions/plans'),
  getMe: () => api.get<SubscriptionStatus>('/subscriptions/me'),
  checkout: (tier: 'family' | 'professional') =>
    api.post<{ url: string }>('/subscriptions/checkout', { tier }),
  portal: () => api.post<{ url: string }>('/subscriptions/portal'),
};
