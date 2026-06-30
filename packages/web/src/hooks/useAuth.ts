import { useAuthStore } from '../stores/auth';

export function useAuth() {
  return useAuthStore();
}

export function useIsAuthenticated() {
  return !!useAuthStore((s) => s.token);
}
