import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AccountInfo {
  id: string;
  email: string;
  display_name: string;
  subscription_tier: 'free' | 'family' | 'professional';
  subscription_status: string | null;
}

interface AuthState {
  token: string | null;
  account: AccountInfo | null;
  setAuth: (token: string, account: AccountInfo) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      account: null,
      setAuth: (token, account) => set({ token, account }),
      clearAuth: () => set({ token: null, account: null }),
    }),
    { name: 'parecare-auth' }
  )
);
