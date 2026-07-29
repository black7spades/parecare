import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';

/**
 * Choosing a new password from an emailed link.
 *
 * Whoever is here has already proved they hold the inbox, so they are signed
 * in as soon as it is done rather than made to type the new password
 * straight back into a sign-in form. The address is shown, because somebody
 * with two accounts needs to know which one they are fixing.
 */
export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState<string | null>(null);
  const [dead, setDead] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ email: string }>(`/auth/reset-password/${token}`)
      .then((r) => setEmail(r.email))
      .catch((err) => setDead((err as Error).message));
  }, [token]);

  async function submit() {
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ token: string; account: Record<string, unknown> }>('/auth/reset-password', {
        token,
        password,
      });
      setAuth(result.token, result.account as never);
      navigate('/app');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <div className="w-full rounded-lg border border-border bg-card p-6">{children}</div>
    </div>
  );

  if (dead) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-ink">This link has run out</h1>
        <p className="mt-2 text-sm text-muted">{dead}</p>
        <div className="mt-4">
          <Link to="/forgot-password" className="text-sm text-primary hover:underline">
            Ask for a new link
          </Link>
        </div>
      </Shell>
    );
  }

  if (!email) return <Shell><p className="text-sm text-muted">Loading.</p></Shell>;

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-ink">Choose a new password</h1>
      <p className="mt-2 text-sm text-muted">For {email}.</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">New password</span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
            minLength={8}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Type it again</span>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </label>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Save it and sign me in
        </Button>
      </form>
      <p className="mt-3 text-xs text-muted">
        This also signs out anything else signed in as you, on every device.
      </p>
    </Shell>
  );
}
