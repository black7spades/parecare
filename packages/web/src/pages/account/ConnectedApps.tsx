import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { EditableSubheader } from '../../components/ui/EditableSubheader';
import { Input } from '../../components/ui/Input';

/**
 * Connected apps: the assistants and bots that can reach PareCare as you.
 *
 * The main job is connecting an assistant the person already uses (Claude,
 * ChatGPT), so "file it in PareCare" works from any chat. That needs one
 * copied address and a click on Allow; the sign-in happens on PareCare's
 * own screen. Everything connected, by sign-in or by app password, is
 * listed together, and one click disconnects it.
 */

interface Connection {
  id: string;
  label: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  access: 'full' | 'read';
  signed_in: boolean;
}

type AppTab = 'claude' | 'chatgpt' | 'gemini' | 'openwebui' | 'other';

const TABS: { key: AppTab; label: string }[] = [
  { key: 'claude', label: 'Claude' },
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'openwebui', label: 'Open WebUI' },
  { key: 'other', label: 'Other apps' },
];

function useCopy(): [string, (key: string, text: string) => void] {
  const [copied, setCopied] = useState('');
  const copy = (key: string, text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(key);
        window.setTimeout(() => setCopied(''), 2000);
      })
      .catch(() => setCopied(''));
  };
  return [copied, copy];
}

export function ConnectedApps() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1>Connected apps</h1>
        <EditableSubheader copyKey="account.connected.subheader" />
      </div>
      <ConnectAssistantCard />
      <ConnectionsCard />
    </div>
  );
}

function ConnectAssistantCard() {
  const [tab, setTab] = useState<AppTab>('claude');
  const [copied, copy] = useCopy();
  const address = `${window.location.origin}/api/v1/mcp`;

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Connect the assistant you already use</h3>
        <p className="text-sm text-muted">
          Then say things like &quot;Mum took her evening tablets at 7, file it in PareCare&quot; in any chat. It
          saves to the right person, with the same checks as Pare, and every change is marked as made by an
          assistant.
        </p>
      </div>

      <div>
        <span className="block text-sm font-medium text-ink mb-1">PareCare&apos;s connection address</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 min-w-0 break-all rounded bg-surface-2 border border-border px-2 py-1.5 text-xs">{address}</code>
          <Button type="button" size="sm" variant="secondary" onClick={() => copy('address', address)}>
            {copied === 'address' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      <div className="inline-flex flex-wrap items-center gap-1 rounded-md bg-surface-2 p-0.5" role="tablist" aria-label="Which app">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              tab === t.key ? 'bg-card text-ink font-medium shadow-sm' : 'text-muted hover:text-ink'
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'claude' ? (
        <ol className="list-decimal pl-5 space-y-1 text-sm text-ink">
          <li>In Claude, open Settings, then Connectors.</li>
          <li>Choose Add custom connector.</li>
          <li>Name it PareCare and paste the address above.</li>
          <li>Click Connect. PareCare opens: check it is you, then click Allow.</li>
        </ol>
      ) : tab === 'gemini' ? (
        <div className="space-y-2 text-sm text-ink">
          <ol className="list-decimal pl-5 space-y-1">
            <li>In the Gemini app, open Settings, then Connected apps.</li>
            <li>Choose Add a custom app, name it PareCare and paste the address above.</li>
            <li>PareCare opens: check it is you, then click Allow.</li>
          </ol>
          <p className="text-xs text-muted">
            Google is still rolling custom apps out, so some accounts and countries do not have the option yet. Open WebUI
            with a Gemini model works everywhere in the meantime.
          </p>
        </div>
      ) : tab === 'openwebui' ? (
        <div className="space-y-2 text-sm text-ink">
          <ol className="list-decimal pl-5 space-y-1">
            <li>In Open WebUI, open Admin Settings, then Integrations, and add an external tool connection.</li>
            <li>Set the type to MCP, Streamable HTTP. It starts on OpenAPI, which will not connect.</li>
            <li>Paste the address above and name it PareCare.</li>
            <li>For sign-in, choose OAuth 2.1 and click Register Client, then Save. PareCare opens: click Allow.</li>
            <li>In a chat, switch PareCare on from the + button, then ask away.</li>
          </ol>
          <p className="text-xs text-muted">
            To have PareCare on in every chat without switching it on, choose Bearer for sign-in instead and paste an app
            password made below. Everyone who uses that Open WebUI then reaches PareCare as you, so only do this if it is
            yours alone.
          </p>
        </div>
      ) : tab === 'chatgpt' ? (
        <ol className="list-decimal pl-5 space-y-1 text-sm text-ink">
          <li>In ChatGPT, open Settings, then Apps and connectors.</li>
          <li>Add a new connector. If there is no button for that, switch on developer mode under Advanced first.</li>
          <li>Name it PareCare, paste the address above, and choose to sign in.</li>
          <li>PareCare opens: check it is you, then click Allow.</li>
        </ol>
      ) : (
        <div className="space-y-3 text-sm text-ink">
          <p>
            Most assistants that take a connection address sign in by themselves: paste the address and click Allow when
            PareCare opens. If an app asks for a password instead, make an app password below and give it both.
          </p>
          <div>
            <p className="text-xs text-muted mb-1">For Claude Code, run this in a terminal:</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 break-all rounded bg-surface-2 border border-border px-2 py-1.5 text-xs">
                claude mcp add --transport http parecare {address}
              </code>
              <Button type="button" size="sm" variant="secondary" onClick={() => copy('cli', `claude mcp add --transport http parecare ${address}`)}>
                {copied === 'cli' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionsCard() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [access, setAccess] = useState<'full' | 'read'>('full');
  const [createdToken, setCreatedToken] = useState('');
  const [error, setError] = useState('');
  const [copied, copy] = useCopy();

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<{ keys: Connection[] }>('/account/api-keys'),
  });
  const connections = data?.keys ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['api-keys'] });

  const createMutation = useMutation({
    mutationFn: () => api.post<{ token: string }>('/account/api-keys', { label: label.trim(), access }),
    onSuccess: (res) => {
      setLabel('');
      setError('');
      setCreatedToken(res.token);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The password could not be made. Try again.'),
  });
  const disconnectMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/account/api-keys/${id}`),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'That app could not be disconnected. Try again.'),
  });

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Connected now</h3>
        <p className="text-sm text-muted">Everything that can reach PareCare as you. Disconnecting stops it straight away.</p>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : connections.length > 0 ? (
        <ul className="divide-y divide-border">
          {connections.map((c) => (
            <li key={c.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium text-ink">{c.label}</span>
              <span className="text-xs text-muted">{c.signed_in ? 'Signed in' : 'App password'}</span>
              <span className="text-xs text-muted">{c.access === 'read' ? 'Can look only' : 'Can look and add records'}</span>
              <span className="text-xs text-muted">
                {c.last_used_at ? `Last used ${format(new Date(c.last_used_at), 'd MMM yyyy')}` : `Connected ${format(new Date(c.created_at), 'd MMM yyyy')}, not used yet`}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost-danger"
                className="ml-auto"
                loading={disconnectMutation.isPending && disconnectMutation.variables === c.id}
                onClick={() => disconnectMutation.mutate(c.id)}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing is connected yet. Connect an assistant above and it shows up here.</p>
      )}

      <div className="border-t border-border pt-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Make an app password</h3>
          <p className="text-xs text-muted">
            Only for an app that asks for a password instead of signing in, or a bot or script of your own, which sends
            it with every request. Treat it like your own password.
          </p>
        </div>

        {createdToken ? (
          <div className="rounded-md border border-primary/40 bg-primary-50 dark:bg-primary-900/10 p-3 space-y-2">
            <p className="text-sm font-medium text-ink">Copy this password now. It is shown only once.</p>
            <code className="block break-all rounded bg-card border border-border px-2 py-1 text-xs">{createdToken}</code>
            <div className="flex gap-2">
              <Button type="button" size="xs" variant="secondary" onClick={() => copy('token', createdToken)}>
                {copied === 'token' ? 'Copied' : 'Copy'}
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setCreatedToken('')}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}

        <Input label="What is it for?" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Cursor, or my Discord bot" />
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-ink mb-1">What it can do</legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="app-access" className="h-4 w-4 text-primary focus:ring-primary" checked={access === 'full'} onChange={() => setAccess('full')} />
            Look at and add records
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="app-access" className="h-4 w-4 text-primary focus:ring-primary" checked={access === 'read'} onChange={() => setAccess('read')} />
            Look only
          </label>
        </fieldset>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" disabled={!label.trim()} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            Make password
          </Button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
