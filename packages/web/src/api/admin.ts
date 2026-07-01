import { api } from './client';
import type { AccountRole } from '../stores/auth';

export interface AdminAccount {
  id: string;
  email: string;
  display_name: string;
  role: AccountRole;
  subscription_tier: 'free' | 'family' | 'professional';
  subscription_status: string | null;
  ai_tokens_used: number;
  created_at: string;
  updated_at: string;
}

export interface AdminAccountList {
  accounts: AdminAccount[];
  total: number;
  page: number;
  per_page: number;
}

export interface AdminStats {
  total: number;
  by_role: Partial<Record<AccountRole, number>>;
  by_tier: Partial<Record<'free' | 'family' | 'professional', number>>;
}

export const adminApi = {
  stats: () => api.get<AdminStats>('/admin/stats'),
  listAccounts: (params: { search?: string; page?: number; per_page?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.page) qs.set('page', String(params.page));
    if (params.per_page) qs.set('per_page', String(params.per_page));
    const query = qs.toString();
    return api.get<AdminAccountList>(`/admin/accounts${query ? `?${query}` : ''}`);
  },
  updateAccount: (
    id: string,
    body: { display_name?: string; email?: string; subscription_tier?: 'free' | 'family' | 'professional' }
  ) => api.patch<AdminAccount>(`/admin/accounts/${id}`, body),
  updateRole: (id: string, role: AccountRole) => api.patch<{ id: string; role: AccountRole }>(`/admin/accounts/${id}/role`, { role }),
  deleteAccount: (id: string) => api.delete<{ message: string }>(`/admin/accounts/${id}`),
};
