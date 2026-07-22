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
  financial_year_start_month: number;
}

interface MeResponse {
  health?: AppHealthConfig;
}

const FALLBACK: AppHealthConfig = { currency: 'AUD', currency_symbol: '$', financial_year_start_month: 7 };

export function useHealthConfig(): AppHealthConfig {
  const { data } = useQuery({
    queryKey: ['app-health-config'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });
  return data?.health ?? FALLBACK;
}
