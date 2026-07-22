import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Account-wide health-spend config, read once and shared through react-query so
 * every form shows prices in the right currency and knows whether a price is
 * required. It rides on /auth/me, which the app already fetches.
 */
export interface AppHealthConfig {
  currency: string;
  currency_symbol: string;
  price_required: boolean;
}

interface MeResponse {
  health?: AppHealthConfig;
}

const FALLBACK: AppHealthConfig = { currency: 'AUD', currency_symbol: '$', price_required: false };

export function useHealthConfig(): AppHealthConfig {
  const { data } = useQuery({
    queryKey: ['app-health-config'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });
  return data?.health ?? FALLBACK;
}
