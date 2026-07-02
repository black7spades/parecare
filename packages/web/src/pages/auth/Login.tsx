import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/client';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { OAuthButtons } from '../../components/OAuthButtons';
import { MfaCodeInput } from '../../components/MfaCodeInput';

type LoginResponse =
  | { token: string; account: Parameters<ReturnType<typeof useAuthStore.getState>['setAuth']>[1] }
  | { mfa_required: true; mfa_token: string };

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  // Only allow same-app destinations to avoid open-redirect abuse
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post<LoginResponse>('/auth/login', { email, password });
      if ('mfa_required' in data) {
        setMfaToken(data.mfa_token);
        return;
      }
      setAuth(data.token, data.account);
      navigate(destination);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign in failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleMfa(code: string) {
    setError('');
    setLoading(true);
    try {
      const data = await api.post<{ token: string; account: Parameters<typeof setAuth>[1] }>('/auth/mfa/challenge', {
        mfa_token: mfaToken,
        code,
      });
      setAuth(data.token, data.account);
      navigate(destination);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      if (err instanceof Error && /sign in again/i.test(err.message)) setMfaToken(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-primary text-2xl font-semibold mb-1">PareCare</h1>
          <p className="text-muted text-sm">{mfaToken ? 'Two-factor authentication' : 'Sign in to continue'}</p>
        </div>
        <div className="card">
          {mfaToken ? (
            <MfaCodeInput onSubmit={handleMfa} loading={loading} error={error} />
          ) : (
            <>
              <OAuthButtons />
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
                <Input
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                <Button type="submit" loading={loading} className="w-full">
                  Sign in
                </Button>
              </form>
              <div className="mt-4 text-center text-sm text-muted">
                No account?{' '}
                <Link
                  to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
                  className="text-primary hover:underline"
                >
                  Create one
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
