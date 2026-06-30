import { useState } from 'react';
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
    </div>
  );
}
