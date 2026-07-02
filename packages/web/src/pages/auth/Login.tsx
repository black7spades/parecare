import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/client';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
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
      const data = await api.post<{ token: string; account: Parameters<typeof setAuth>[1] }>(
        '/auth/login',
        { email, password }
      );
      setAuth(data.token, data.account);
      navigate(destination);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign in failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-primary text-2xl font-semibold mb-1">PareCare</h1>
          <p className="text-muted text-sm">Sign in to continue</p>
        </div>
        <div className="card">
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
            {error ? (
              <p className="text-sm text-red-600">{error}</p>
            ) : null}
            <Button type="submit" loading={loading} className="w-full">
              Sign in
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted">
            No account?{' '}
            <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'} className="text-primary hover:underline">
              Create one
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
