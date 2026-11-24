import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AccountRole = 'super_admin' | 'admin' | 'user';

interface AccountInfo {
  id: string;
  email: string;
  display_name: string;
  role?: AccountRole;
  avatar_url?: string | null;
  avatar_color?: string | null;
  subscription_tier: 'free' | 'family' | 'professional';
  subscription_status: string | null;
  can_create_care_profiles?: boolean;
}

interface AuthState {
  token: string | null;
  account: AccountInfo | null;
  setAuth: (token: string, account: AccountInfo) => void;
  updateAccount: (account: Partial<AccountInfo>) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      account: null,
      setAuth: (token, account) => set({ token, account }),
      updateAccount: (account) =>
        set((state) => (state.account ? { account: { ...state.account, ...account } } : state)),
      clearAuth: () => set({ token: null, account: null }),
    }),
    { name: 'parecare-auth' }
  )
);
