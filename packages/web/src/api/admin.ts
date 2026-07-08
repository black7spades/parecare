import { api } from './client';
import type { AccountRole } from '../stores/auth';

export interface AdminAccount {
  id: string;
  email: string;
  display_name: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  role: AccountRole;
  subscription_tier: 'free' | 'family' | 'professional';
  subscription_status: string | null;
  ai_tokens_used: number;
  disabled_at: string | null;
  can_create_care_profiles: boolean;
  can_invite_members: boolean;
  can_use_ai: boolean;
  can_export_data: boolean;
  created_at: string;
  updated_at: string;
}

export type AdminGroup = 'super_admin' | 'admin' | 'carer' | 'viewer';

export interface AdminListParams {
  search?: string;
  page?: number;
  per_page?: number;
  sort?: 'name' | 'email' | 'role' | 'tier' | 'joined';
  order?: 'asc' | 'desc';
  group?: AdminGroup;
  role?: AccountRole;
  tier?: 'free' | 'family' | 'professional';
  status?: 'active' | 'disabled';
}

export interface AccountRights {
  can_create_care_profiles?: boolean;
  can_invite_members?: boolean;
  can_use_ai?: boolean;
  can_export_data?: boolean;
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
  groups: Record<AdminGroup, number>;
  by_tier: Partial<Record<'free' | 'family' | 'professional', number>>;
}

export const adminApi = {
  stats: () => api.get<AdminStats>('/admin/stats'),
  listAccounts: (params: AdminListParams = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const query = qs.toString();
    return api.get<AdminAccountList>(`/admin/accounts${query ? `?${query}` : ''}`);
  },
  updateAccount: (
    id: string,
    body: {
      first_name?: string;
      middle_name?: string | null;
      last_name?: string | null;
      email?: string;
      subscription_tier?: 'free' | 'family' | 'professional';
    } & AccountRights
  ) => api.patch<AdminAccount>(`/admin/accounts/${id}`, body),
  updateRole: (id: string, role: AccountRole) => api.patch<{ id: string; role: AccountRole }>(`/admin/accounts/${id}/role`, { role }),
  deleteAccount: (id: string) => api.delete<{ message: string }>(`/admin/accounts/${id}`),
  createAccount: (
    body: {
      email: string;
      first_name: string;
      middle_name?: string | null;
      last_name?: string | null;
      password: string;
      role?: AccountRole;
    } & AccountRights
  ) => api.post<{ account: AdminAccount }>('/admin/accounts', body),
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
