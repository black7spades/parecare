import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface Providers {
  google: boolean;
  facebook: boolean;
}

/**
 * "Continue with Google / Facebook" buttons. Only renders providers the
 * server has credentials for; renders nothing when none are configured.
 */
export function OAuthButtons() {
  const { data } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => api.get<Providers>('/auth/providers'),
    staleTime: 5 * 60_000,
  });

  if (!data || (!data.google && !data.facebook)) return null;

  return (
    <div className="space-y-2 mb-4">
      {data.google ? (
        <a
          href="/api/v1/auth/oauth/google"
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-surface transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1A12 12 0 0 0 12 24z" />
            <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1z" />
            <path fill="#EA4335" d="M12 4.7c1.8 0 3.3.6 4.6 1.8L20 3A12 12 0 0 0 1.2 6.6l4.1 3.1c.9-2.9 3.6-5 6.7-5z" />
          </svg>
          Continue with Google
        </a>
      ) : null}
      {data.facebook ? (
        <a
          href="/api/v1/auth/oauth/facebook"
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-surface transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#1877F2"
              d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z"
            />
          </svg>
          Continue with Facebook
        </a>
      ) : null}
      <div className="flex items-center gap-3 pt-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted">or with email</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
