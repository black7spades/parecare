import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/auth';

/**
 * The screen an assistant (Claude, ChatGPT) sends someone to when they
 * connect it to PareCare. One question, asked plainly: should this app be
 * able to reach your records as you? Allow sends them straight back to the
 * assistant, connected. Nothing here needs knowing what OAuth is.
 */
export function ConnectPage() {
  const [params] = useSearchParams();
  const account = useAuthStore((s) => s.account);
  const [access, setAccess] = useState<'full' | 'read'>('full');
  const [error, setError] = useState('');

  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const codeChallenge = params.get('code_challenge') ?? '';
  const state = params.get('state');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['connect-client', clientId, redirectUri],
    queryFn: () =>
      api.get<{ client_name: string; redirect_host: string }>(
        `/oauth/client?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`
      ),
    enabled: !!clientId && !!redirectUri,
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (decision: 'allow' | 'deny') =>
      api.post<{ redirect_to: string }>('/oauth/approve', {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        state,
        access,
        decision,
      }),
    onSuccess: (res) => window.location.assign(res.redirect_to),
    onError: (err) =>
      setError(err instanceof Error ? err.message : 'That did not go through. Go back to your assistant and connect again.'),
  });

  const invalid = !clientId || !redirectUri || !codeChallenge || isError;
  const appName = data?.client_name ?? 'This app';

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md space-y-5">
        {invalid ? (
          <>
            <h1 className="text-2xl font-bold text-ink">This connection could not start</h1>
            <p className="text-sm text-ink">
              The request from your assistant is not valid any more. Go back to it and connect PareCare again.
            </p>
          </>
        ) : isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-ink">Connect {appName} to PareCare</h1>
              <p className="text-sm text-ink">
                {appName} will be able to reach the records of everyone in your care, as you
                {account?.email ? <> ({account.email})</> : null}. It can only do what you can do yourself.
              </p>
              <p className="text-xs text-muted">
                Every change it makes is marked as made by an assistant. Disconnect it any time from Connected apps in
                your account menu.
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink mb-1">What it can do</legend>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="connect-access"
                  className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
                  checked={access === 'full'}
                  onChange={() => setAccess('full')}
                />
                <span>
                  Look at and add records
                  <span className="block text-xs text-muted">Log doses, add notes, tasks, appointments and providers when you ask.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="connect-access"
                  className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
                  checked={access === 'read'}
                  onChange={() => setAccess('read')}
                />
                <span>
                  Look only
                  <span className="block text-xs text-muted">Answer questions about the records, and change nothing.</span>
                </span>
              </label>
            </fieldset>

            {data?.redirect_host ? (
              <p className="text-xs text-muted">After this you go back to {data.redirect_host}.</p>
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate('deny')}>
                Cancel
              </Button>
              <Button loading={decide.isPending && decide.variables === 'allow'} onClick={() => decide.mutate('allow')}>
                Allow
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
