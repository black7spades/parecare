import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/client';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { AvatarEditor } from '../../components/ui/AvatarEditor';

/**
 * One place for everything about the person signed in: their own details and
 * photo, and how they sign in. Profile and Settings used to be two screens for
 * the same thing; they are one now. Laid out in numbered sections, most-used
 * first.
 */

interface Me {
  id: string;
  display_name: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
  avatar_color: string | null;
  date_of_birth: string | null;
  gender: string | null;
  pronouns: string | null;
  mfa_enabled: boolean;
  oauth_provider: string | null;
}

/** A numbered section heading, so the page reads as an ordered list of tasks. */
function SectionHeading({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="text-base font-semibold text-ink">
      <span className="text-muted mr-2">{n}.</span>
      {title}
    </h2>
  );
}

export function AccountSettings() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1>Settings</h1>
      <YourDetails />
      <SignInAndSecurity />
    </div>
  );
}

// ── 1. Your details ────────────────────────────────────────────────────

function YourDetails() {
  const { account, updateAccount } = useAuthStore();
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  useEffect(() => {
    if (!me) return;
    setFirstName(me.first_name ?? me.display_name.split(' ')[0] ?? '');
    setMiddleName(me.middle_name ?? '');
    setLastName(me.last_name ?? '');
    setDob(me.date_of_birth ? me.date_of_birth.slice(0, 10) : '');
    setGender(me.gender ?? '');
    setPronouns(me.pronouns ?? '');
  }, [me]);

  const refreshMe = () => void queryClient.invalidateQueries({ queryKey: ['me'] });

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch('/auth/me', {
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim() || null,
        date_of_birth: dob || null,
        gender: gender.trim() || null,
        pronouns: pronouns.trim() || null,
      }),
    onSuccess: () => {
      setError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      updateAccount({ display_name: [firstName, middleName, lastName].map((v) => v.trim()).filter(Boolean).join(' ') });
      refreshMe();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  const photoMutation = useMutation({
    mutationFn: (blob: Blob) => {
      const form = new FormData();
      form.append('avatar', blob, 'avatar.png');
      return api.upload<{ avatar_url: string }>('/auth/me/avatar', form);
    },
    onSuccess: (res) => {
      updateAccount({ avatar_url: res.avatar_url });
      setAvatarError('');
      setEditorOpen(false);
      refreshMe();
    },
    onError: (err) => setAvatarError(err instanceof Error ? err.message : 'Upload failed'),
  });

  const colorMutation = useMutation({
    mutationFn: async (hex: string) => {
      if (me?.avatar_url) await api.delete('/auth/me/avatar');
      await api.patch('/auth/me', { avatar_color: hex });
      return hex;
    },
    onSuccess: (hex) => {
      updateAccount({ avatar_url: null, avatar_color: hex });
      setEditorOpen(false);
      refreshMe();
    },
    onError: (err) => setAvatarError(err instanceof Error ? err.message : 'Failed to save colour'),
  });

  const removeAvatarMutation = useMutation({
    mutationFn: () => api.delete('/auth/me/avatar'),
    onSuccess: () => {
      updateAccount({ avatar_url: null });
      setEditorOpen(false);
      refreshMe();
    },
  });

  if (!account) return null;

  return (
    <div className="card space-y-4">
      <SectionHeading n={1} title="Your details" />

      <div className="flex items-center gap-4">
        <Avatar
          accountId={account.id}
          name={account.display_name}
          avatarUrl={me?.avatar_url ?? account.avatar_url}
          color={me?.avatar_color ?? account.avatar_color}
          size={72}
        />
        <div className="space-y-1">
          <Button size="sm" variant="secondary" onClick={() => { setAvatarError(''); setEditorOpen(true); }}>
            Edit photo
          </Button>
          <p className="text-xs text-muted">Upload and crop a photo, or pick a colour.</p>
          {avatarError ? <p className="text-xs text-red-600">{avatarError}</p> : null}
        </div>
      </div>

      <AvatarEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        accountId={account.id}
        name={account.display_name}
        avatarUrl={me?.avatar_url ?? account.avatar_url}
        color={me?.avatar_color ?? account.avatar_color}
        onSavePhoto={(blob) => photoMutation.mutate(blob)}
        onSaveColor={(hex) => colorMutation.mutate(hex)}
        onRemovePhoto={() => removeAvatarMutation.mutate()}
        saving={photoMutation.isPending || colorMutation.isPending || removeAvatarMutation.isPending}
      />

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <Input label="Middle name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Birthday" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          <div>
            <label htmlFor="gender" className="block text-sm font-medium text-ink mb-1">Gender</label>
            <input
              id="gender"
              list="gender-options"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder-muted shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              placeholder="e.g. Female"
            />
            <datalist id="gender-options">
              <option value="Female" />
              <option value="Male" />
              <option value="Non-binary" />
              <option value="Prefer not to say" />
            </datalist>
          </div>
          <div>
            <label htmlFor="pronouns" className="block text-sm font-medium text-ink mb-1">Pronouns</label>
            <input
              id="pronouns"
              list="pronoun-options"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder-muted shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              placeholder="e.g. she/her"
            />
            <datalist id="pronoun-options">
              <option value="she/her" />
              <option value="he/him" />
              <option value="they/them" />
            </datalist>
          </div>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={saveMutation.isPending}>Save details</Button>
          {saved ? <span className="text-sm text-primary">Saved ✓</span> : null}
        </div>
      </form>
    </div>
  );
}

// ── 2. Sign-in and security ────────────────────────────────────────────

function SignInAndSecurity() {
  const { account } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setError('');
    if (!newPassword) {
      setMsg('Enter a new password to change it.');
      return;
    }
    setLoading(true);
    try {
      await api.patch('/auth/me', { current_password: currentPassword, new_password: newPassword });
      setMsg('Password changed.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card space-y-4">
      <SectionHeading n={2} title="Sign-in and security" />

      <Input
        label="Email"
        type="email"
        value={account?.email ?? ''}
        disabled
        hint="Contact support to change your email."
      />

      <hr className="border-border" />
      <h3>Change password</h3>
      <form onSubmit={changePassword} className="space-y-4">
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
          hint="At least 8 characters."
        />
        {msg ? <p className="text-sm text-primary">{msg}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" loading={loading}>Change password</Button>
      </form>

      <hr className="border-border" />
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
    <div className="space-y-4">
      <div>
        <h3>Two-factor authentication</h3>
        <p className="text-sm text-muted">
          Adds a second lock to your account: signing in also requires a 6-digit code from an authenticator app such as
          Google Authenticator, Authy or 1Password.
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
          {qrDataUrl ? <img src={qrDataUrl} alt="Two-factor setup QR code" className="rounded-md border border-border" /> : null}
          <div>
            <span className="block text-sm font-medium text-ink mb-1">Setup key, for typing in by hand</span>
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
