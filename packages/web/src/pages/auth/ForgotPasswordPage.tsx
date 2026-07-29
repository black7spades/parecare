import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { api } from '../../api/client';

/**
 * Asking for a way back in.
 *
 * The answer is the same whatever is true of the address typed, because a
 * page that says "no account with that address" tells any stranger who
 * wonders exactly which people use a care system. So it thanks them and
 * tells them to check their inbox, every time.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const result = await api.post<{ message: string }>('/auth/forgot-password', { email });
      setSent(result.message);
    } catch {
      // Even a failure here must not hint at what exists. The link is sent
      // in the background either way.
      setSent('If that address has an account, a link to choose a new password is on its way.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <div className="w-full rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-semibold text-ink">Forgotten your password</h1>
        {sent ? (
          <>
            <p className="mt-2 text-sm text-muted">{sent}</p>
            <p className="mt-2 text-sm text-muted">
              The link works once and lasts an hour. Ask for another whenever you need one.
            </p>
            <div className="mt-4">
              <Link to="/login" className="text-sm text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              Type the address you sign in with and we will send you a link to choose a new one.
            </p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Email address</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <Button type="submit" variant="primary" className="w-full" loading={busy}>
                Send me a link
              </Button>
            </form>
            <div className="mt-4">
              <Link to="/login" className="text-sm text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
