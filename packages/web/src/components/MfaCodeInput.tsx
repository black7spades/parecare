import { useState } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

/** Six-digit authenticator code prompt used by login and the OAuth callback. */
export function MfaCodeInput({
  onSubmit,
  loading,
  error,
}: {
  onSubmit: (code: string) => void;
  loading: boolean;
  error: string;
}) {
  const [code, setCode] = useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onSubmit(code.trim());
      }}
    >
      <p className="text-sm text-muted">
        This account is protected with two-factor authentication. Enter the 6-digit code from your authenticator
        app.
      </p>
      <Input
        label="Authentication code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123 456"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
        required
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" loading={loading} className="w-full">
        Verify
      </Button>
    </form>
  );
}
