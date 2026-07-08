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
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminInvitation {
  id: string;
  email: string;
  display_name: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  created_at: string;
  profile_names: string[];
  invite_url: string | null;
}

export interface AdminCareProfile {
  id: string;
  full_name: string;
  owner_email: string;
  owner_name: string;
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
  createAccount: (body: { email: string; display_name: string; password: string; role?: AccountRole }) =>
    api.post<{ account: AdminAccount }>('/admin/accounts', body),
  setDisabled: (id: string, disabled: boolean) =>
    api.patch<{ id: string; disabled: boolean }>(`/admin/accounts/${id}/disabled`, { disabled }),
  listInvitations: () => api.get<{ invitations: AdminInvitation[] }>('/admin/invitations'),
  createInvitation: (body: {
    email: string;
    display_name: string;
    role: string;
    permission: 'viewer' | 'contributor';
    care_profile_ids: string[];
  }) =>
    api.post<{ invitation: { id: string }; invite_url: string; member_count: number; skipped: Array<{ care_profile_id: string; reason: string }> }>(
      '/admin/invitations',
      body
    ),
  resendInvitation: (id: string) => api.post<{ invite_url: string }>(`/admin/invitations/${id}/resend`),
  revokeInvitation: (id: string) => api.delete<{ message: string }>(`/admin/invitations/${id}`),
  createAssignments: (body: { account_id: string; role: string; permission: 'viewer' | 'contributor'; care_profile_ids: string[] }) =>
    api.post<{ assigned: string[]; skipped: Array<{ care_profile_id: string; reason: string }> }>('/admin/assignments', body),
  listCareProfiles: (search?: string) =>
    api.get<{ profiles: AdminCareProfile[] }>(`/admin/care-profiles${search ? `?search=${encodeURIComponent(search)}` : ''}`),
};
