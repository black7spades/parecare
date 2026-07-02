import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/client';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export function AccountSettings() {
  const { account, setAuth, token } = useAuthStore();
  const [displayName, setDisplayName] = useState(account?.display_name ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setError('');
    setLoading(true);
    try {
      const body: Record<string, string> = {};
      if (displayName !== account?.display_name) body['display_name'] = displayName;
      if (newPassword) {
        body['current_password'] = currentPassword;
        body['new_password'] = newPassword;
      }
      if (Object.keys(body).length === 0) {
        setMsg('No changes to save.');
        return;
      }
      await api.patch('/auth/me', body);
      if (token && account) {
        setAuth(token, { ...account, display_name: displayName });
      }
      setMsg('Settings saved.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Failed to save';
      setError(m);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <h1>Account settings</h1>
      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <Input
            label="Email"
            type="email"
            value={account?.email ?? ''}
            disabled
            hint="Contact support to change your email."
          />
          <hr className="border-border" />
          <h3>Change password</h3>
          <Input
            label="Current password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            hint="At least 8 characters"
          />
          {msg ? <p className="text-sm text-primary">{msg}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" loading={loading}>
            Save changes
          </Button>
        </form>
      </div>

      <MfaSettings />
    </div>
  );
}

function MfaSettings() {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ mfa_enabled: boolean; oauth_provider: string | null }>('/auth/me'),
  });

  useEffect(() => {
    if (setup) {
      void QRCode.toDataURL(setup.otpauth_url, { width: 220, margin: 1 }).then(setQrDataUrl);
    } else {
      setQrDataUrl('');
    }
  }, [setup]);

  async function startSetup() {
    setError('');
    setMsg('');
    setBusy(true);
    try {
      setSetup(await api.post<{ secret: string; otpauth_url: string }>('/auth/mfa/setup'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start setup');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/mfa/verify', { code: code.trim() });
      setSetup(null);
      setCode('');
      setMsg('Two-factor authentication is on. You will be asked for a code at every sign-in.');
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/mfa/disable', { code: disableCode.trim() });
      setDisableCode('');
      setMsg('Two-factor authentication is off.');
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3>Two-factor authentication</h3>
        <p className="text-sm text-muted">
          Adds a second lock to your account: signing in also requires a 6-digit code from an authenticator app
          (Google Authenticator, Authy, 1Password…).
        </p>
      </div>

      {msg ? <p className="text-sm text-primary">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {me?.mfa_enabled ? (
        <form onSubmit={disable} className="space-y-3">
          <p className="text-sm text-ink">
            <span className="badge bg-primary-50 text-primary">Enabled</span>
          </p>
          <Input
            label="Enter a current code to turn it off"
            inputMode="numeric"
            placeholder="123 456"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
          />
          <Button type="submit" variant="danger" loading={busy} disabled={!disableCode.trim()}>
            Turn off two-factor authentication
          </Button>
        </form>
      ) : setup ? (
        <form onSubmit={verify} className="space-y-3">
          <ol className="text-sm text-ink list-decimal pl-5 space-y-1">
            <li>Open your authenticator app and choose "add account".</li>
            <li>Scan this QR code, or type the setup key below into the app.</li>
            <li>Enter the 6-digit code the app shows to finish.</li>
          </ol>
          {qrDataUrl ? <img src={qrDataUrl} alt="MFA setup QR code" className="rounded-md border border-border" /> : null}
          <div>
            <span className="block text-sm font-medium text-ink mb-1">Setup key (manual entry)</span>
            <code data-testid="mfa-secret" className="block rounded-md border border-border bg-surface px-3 py-2 text-xs tracking-wider break-all">
              {setup.secret}
            </code>
          </div>
          <Input
            label="6-digit code from the app"
            inputMode="numeric"
            placeholder="123 456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={!code.trim()}>
              Verify and turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={startSetup} loading={busy}>
          Set up two-factor authentication
        </Button>
      )}
    </div>
  );
}
