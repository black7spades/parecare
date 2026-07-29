import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';

/**
 * Saying yes to being a data warden.
 *
 * The person arriving here agreed to help somebody with something they were
 * worried about. Whatever state they turn up in, they must end on the one
 * screen that lets them do it, and never on a dead end:
 *
 * - No account at all: make one here, at the address they were asked on.
 * - An account, signed out: sign in and come straight back.
 * - Already signed in as that person: nothing to do but accept.
 * - Signed in as somebody else: told plainly, with the way out.
 * - Link expired or already used: told, with what to ask for.
 */

interface InviteInfo {
  email: string;
  state: 'pending' | 'accepted' | 'cancelled' | 'expired';
  asked_by: string;
  has_account: boolean;
  expires_at: string;
}

export function WardenInvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const account = useAuthStore((s) => s.account);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    api
      .get<{ invite: InviteInfo }>(`/warden-invites/${token}`)
      .then((r) => setInvite(r.invite))
      .catch((err) => setLoadError((err as Error).message));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/warden-invites/${token}/accept`);
      navigate('/system/backups');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ token: string; account: Record<string, unknown> }>(
        `/warden-invites/${token}/register`,
        { first_name: firstName, last_name: lastName, password }
      );
      setAuth(result.token, result.account as never);
      navigate('/system/backups');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-auto flex min-h-screen max-w-lg items-center p-4">
      <div className="w-full rounded-lg border border-border bg-card p-6">{children}</div>
    </div>
  );

  if (loadError) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-ink">This invitation could not be opened</h1>
        <p className="mt-2 text-sm text-muted">
          {loadError} Ask the person who sent it to send you a new one.
        </p>
      </Shell>
    );
  }

  if (!invite) return <Shell><p className="text-sm text-muted">Loading.</p></Shell>;

  if (invite.state === 'accepted') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-ink">You have already said yes</h1>
        <p className="mt-2 text-sm text-muted">
          Nothing more is needed. If you would like to look at the records screen, sign in and open Backups.
        </p>
        <div className="mt-4">
          <Link to="/system/backups" className="text-sm text-primary hover:underline">
            Go to Backups
          </Link>
        </div>
      </Shell>
    );
  }

  if (invite.state === 'expired' || invite.state === 'cancelled') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-ink">This invitation has run out</h1>
        <p className="mt-2 text-sm text-muted">
          Invitations last two weeks. Ask {invite.asked_by} to send you another one; it takes them a moment.
        </p>
      </Shell>
    );
  }

  const intro = (
    <>
      <h1 className="text-lg font-semibold text-ink">{invite.asked_by} has asked you to be a data warden</h1>
      <p className="mt-2 text-sm text-muted">
        It means one thing. If something ever happens to their records, or to them, you are able to get everything
        back. Copies are made automatically every day, so there is nothing for you to look after and nothing to
        remember.
      </p>
      <p className="mt-2 text-sm text-muted">
        There is one screen, and you cannot break anything by looking at it.
      </p>
    </>
  );

  // Signed in as somebody else. Say so plainly rather than failing later.
  if (account && account.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell>
        {intro}
        <p className="mt-4 text-sm text-ink">
          This invitation was sent to {invite.email}, but you are signed in as {account.email}.
        </p>
        <p className="mt-1 text-sm text-muted">
          Sign out and follow the link again, using the address it was sent to.
        </p>
        <div className="mt-4">
          <Button variant="primary" size="sm" onClick={() => clearAuth()}>
            Sign out
          </Button>
        </div>
      </Shell>
    );
  }

  // Signed in as the right person: one button.
  if (account) {
    return (
      <Shell>
        {intro}
        {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="mt-4">
          <Button variant="primary" onClick={() => void accept()} loading={busy}>
            Yes, I will do this
          </Button>
        </div>
      </Shell>
    );
  }

  // Has an account but is signed out: send them to sign in and come back.
  if (invite.has_account) {
    return (
      <Shell>
        {intro}
        <p className="mt-4 text-sm text-ink">You already have a PareCare account for {invite.email}.</p>
        <div className="mt-4">
          <Link
            to={`/login?next=${encodeURIComponent(`/warden/${token}`)}`}
            className="text-sm text-primary hover:underline"
          >
            Sign in to say yes
          </Link>
        </div>
      </Shell>
    );
  }

  // No account: make one, at the address they were asked on.
  return (
    <Shell>
      {intro}
      <p className="mt-4 text-sm text-ink">
        Set up your account for {invite.email}. It takes a moment, and it is only used for this.
      </p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void register();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">First name</span>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Last name</span>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Choose a password</span>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Type it again</span>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Set up and say yes
        </Button>
      </form>
    </Shell>
  );
}
