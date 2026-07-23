import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../api/client';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { CrossIcon } from '../../components/ui/icons';
import { Modal } from '../../components/ui/Modal';

/**
 * Where and how notifications reach you. Three layers:
 *  - which kinds of notification you want at all;
 *  - the channels they are delivered to beyond the in-app bell: email,
 *    push to this device, Discord, Telegram, or a generic webhook, each
 *    with its own urgency and digest rhythm;
 *  - API keys, so your own bots and outside apps can talk to PareCare.
 */

interface Preferences {
  activity: boolean;
  dose_overdue: boolean;
  supply: boolean;
}

interface Channel {
  id: string;
  kind: 'email' | 'webpush' | 'discord' | 'telegram' | 'webhook';
  label: string;
  config: Record<string, unknown>;
  urgent_instantly: boolean;
  digest: 'off' | 'daily' | 'weekly' | 'monthly';
  enabled: boolean;
}

interface SettingsResponse {
  preferences: Preferences;
  channels: Channel[];
  vapid_public_key: string | null;
}

const KIND_LABELS: Record<Channel['kind'], string> = {
  email: 'Email',
  webpush: 'Push to a device',
  discord: 'Discord',
  telegram: 'Telegram',
  webhook: 'Webhook',
};

const DIGESTS = [
  { value: 'off', label: 'No digest' },
  { value: 'daily', label: 'Daily digest' },
  { value: 'weekly', label: 'Weekly digest' },
  { value: 'monthly', label: 'Monthly digest' },
] as const;

const selectClass =
  'rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function NotificationSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: () => api.get<SettingsResponse>('/notifications/settings'),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['notification-settings'] });

  if (isLoading || !data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1>Notifications</h1>
        <p className="text-sm text-muted">
          What you are told about, and where. The bell in the header always shows everything you have switched on;
          channels deliver it beyond the app.
        </p>
      </div>
      <KindPreferences preferences={data.preferences} onSaved={invalidate} />
      <ChannelsCard channels={data.channels} vapidKey={data.vapid_public_key} onChanged={invalidate} />
      <ApiKeysCard />
    </div>
  );
}

/** Which kinds of notification this account wants at all. */
function KindPreferences({ preferences, onSaved }: { preferences: Preferences; onSaved: () => void }) {
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (patch: Partial<Preferences>) => api.put('/notifications/preferences', patch),
    onSuccess: () => {
      setError('');
      onSaved();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  const rows: { key: keyof Preferences; label: string; hint: string }[] = [
    { key: 'dose_overdue', label: 'Overdue doses', hint: 'A scheduled medication time passed with no dose recorded. Urgent only for medications marked dangerous to miss.' },
    { key: 'supply', label: 'Medication supply', hint: 'A prescription running low or out of stock.' },
    { key: 'activity', label: 'Care circle activity', hint: 'Anything someone else adds or changes on a profile you can see: messages, care log entries, documents and the rest.' },
  ];

  return (
    <div className="card space-y-3">
      <h3>What you are notified about</h3>
      {rows.map((r) => (
        <label key={r.key} className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={preferences[r.key]}
            onChange={(e) => mutation.mutate({ [r.key]: e.target.checked })}
          />
          <span>
            {r.label}
            <span className="block text-xs text-muted">{r.hint}</span>
          </span>
        </label>
      ))}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

/** Convert the server's VAPID key for the browser's push API. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function ChannelsCard({ channels, vapidKey, onChanged }: { channels: Channel[]; vapidKey: string | null; onChanged: () => void }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const patchMutation = useMutation({
    mutationFn: (input: { id: string; patch: Record<string, unknown> }) => api.patch(`/notifications/channels/${input.id}`, input.patch),
    onSuccess: () => {
      setError('');
      onChanged();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/channels/${id}`),
    onSuccess: onChanged,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to remove'),
  });
  const testMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/channels/${id}/test`, {}),
    onSuccess: () => {
      setError('');
      setNotice('Test sent. Check the destination.');
      setTimeout(() => setNotice(''), 4000);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The test could not be delivered'),
  });

  /** Subscribe this browser or phone to real push and save it as a channel. */
  async function enablePush() {
    setError('');
    if (!vapidKey) {
      setError('Push is not set up on this server yet. Ask the administrator to restart the API once.');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setError('This browser does not support push notifications.');
      return;
    }
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Notifications are blocked for this site. Allow them in the browser settings and try again.');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });
      await api.post('/notifications/channels', {
        kind: 'webpush',
        label: `This device (${/mobile/i.test(navigator.userAgent) ? 'phone' : 'computer'})`,
        config: { subscription: subscription.toJSON() },
        digest: 'off',
        urgent_instantly: true,
      });
      setNotice('Push is on for this device.');
      setTimeout(() => setNotice(''), 4000);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable push');
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3>Where notifications are delivered</h3>
        <p className="text-sm text-muted">
          Each destination chooses its own rhythm: urgent alerts the moment they arise, everything else bundled into a
          digest. WhatsApp and other services can be reached through the webhook with a bridge such as Twilio.
        </p>
      </div>

      {channels.length > 0 ? (
        <ul className="divide-y divide-border">
          {channels.map((c) => (
            <li key={c.id} className="py-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge bg-surface-2 text-ink text-xs">{KIND_LABELS[c.kind]}</span>
                <span className="text-sm font-medium text-ink">{c.label}</span>
                {!c.enabled ? <span className="badge bg-surface-2 text-muted text-xs">Paused</span> : null}
                <span className="ml-auto flex items-center gap-1">
                  <Button size="xs" variant="ghost" onClick={() => testMutation.mutate(c.id)}>
                    Send a test
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => patchMutation.mutate({ id: c.id, patch: { enabled: !c.enabled } })}
                  >
                    {c.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button size="xs" variant="ghost-danger" aria-label="Remove notification channel" title="Remove" onClick={() => deleteMutation.mutate(c.id)}>
                    <CrossIcon />
                  </Button>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="inline-flex items-center gap-1.5 text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={c.urgent_instantly}
                    onChange={(e) => patchMutation.mutate({ id: c.id, patch: { urgent_instantly: e.target.checked } })}
                  />
                  Urgent alerts straight away
                </label>
                <select
                  aria-label={`Digest rhythm for ${c.label}`}
                  className={selectClass}
                  value={c.digest}
                  onChange={(e) => patchMutation.mutate({ id: c.id, patch: { digest: e.target.value } })}
                >
                  {DIGESTS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing set up yet. Notifications only show in the app until you add a destination.</p>
      )}

      {notice ? <p className="text-sm text-primary">{notice}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" loading={pushBusy} onClick={enablePush}>
          Enable push on this device
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
          Add another destination
        </Button>
      </div>

      {adding ? <AddChannelModal onClose={() => setAdding(false)} onAdded={() => { setAdding(false); onChanged(); }} /> : null}
    </div>
  );
}

function AddChannelModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [kind, setKind] = useState<Exclude<Channel['kind'], 'webpush'>>('email');
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [digest, setDigest] = useState<Channel['digest']>('daily');
  const [urgentInstantly, setUrgentInstantly] = useState(true);
  const [error, setError] = useState('');

  const config = () => {
    if (kind === 'email') return address.trim() ? { address: address.trim() } : {};
    if (kind === 'discord') return { webhook_url: webhookUrl.trim() };
    if (kind === 'telegram') return { bot_token: botToken.trim(), chat_id: chatId.trim() };
    return { url: webhookUrl.trim(), ...(secret.trim() ? { secret: secret.trim() } : {}) };
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/notifications/channels', {
        kind,
        label: label.trim() || KIND_LABELS[kind],
        config: config(),
        digest,
        urgent_instantly: urgentInstantly,
      }),
    onSuccess: onAdded,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to add'),
  });

  return (
    <Modal open onClose={onClose} title="Add a notification destination">
      <div className="space-y-4">
        <div>
          <label htmlFor="channel-kind" className="block text-sm font-medium text-ink mb-1">
            Destination
          </label>
          <select id="channel-kind" className={`${selectClass} w-full`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="email">Email</option>
            <option value="discord">Discord</option>
            <option value="telegram">Telegram</option>
            <option value="webhook">Webhook for anything else</option>
          </select>
        </div>
        <Input label="Name it" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`e.g. ${kind === 'email' ? 'My inbox' : KIND_LABELS[kind]}`} />

        {kind === 'email' ? (
          <Input label="Email address" type="email" value={address} onChange={(e) => setAddress(e.target.value)} hint="Leave empty to use your account email." />
        ) : null}
        {kind === 'discord' ? (
          <Input
            label="Discord webhook URL"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            hint="In your Discord server: channel settings, then Integrations, then Webhooks, then copy the URL."
          />
        ) : null}
        {kind === 'telegram' ? (
          <>
            <Input
              label="Bot token"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              hint="Create a bot with @BotFather in Telegram and paste its token."
            />
            <Input
              label="Chat id"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              hint="Message your bot once, then ask @userinfobot for your chat id."
            />
          </>
        ) : null}
        {kind === 'webhook' ? (
          <>
            <Input
              label="Webhook URL"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              hint="PareCare will POST JSON here. Works with Slack, Matrix bridges, WhatsApp gateways like Twilio, and home automation."
            />
            <Input label="Shared secret" value={secret} onChange={(e) => setSecret(e.target.value)} hint="Optional. Sent as the X-PareCare-Secret header so your endpoint can verify the sender." />
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-1.5 text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={urgentInstantly}
              onChange={(e) => setUrgentInstantly(e.target.checked)}
            />
            Urgent alerts straight away
          </label>
          <select aria-label="Digest rhythm" className={selectClass} value={digest} onChange={(e) => setDigest(e.target.value as Channel['digest'])}>
            {DIGESTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Add destination
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface ApiKey {
  id: string;
  label: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

/** Personal access tokens for bots and outside apps. */
function ApiKeysCard() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [createdToken, setCreatedToken] = useState('');
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<{ keys: ApiKey[] }>('/account/api-keys'),
  });
  const keys = data?.keys ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['api-keys'] });

  const createMutation = useMutation({
    mutationFn: () => api.post<{ token: string }>('/account/api-keys', { label: label.trim() }),
    onSuccess: (res) => {
      setLabel('');
      setError('');
      setCreatedToken(res.token);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create'),
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/account/api-keys/${id}`),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to revoke'),
  });

  return (
    <div className="card space-y-4">
      <div>
        <h3>API keys for bots and outside apps</h3>
        <p className="text-sm text-muted">
          A key lets your own bot or script call the PareCare API as you: a Discord bot that logs doses, a Telegram bot
          that asks Pare questions, a home automation flow. Send it as the bearer token on any API request. A key has
          your full access, so treat it like a password.
        </p>
      </div>

      {keys.length > 0 ? (
        <ul className="divide-y divide-border">
          {keys.map((k) => (
            <li key={k.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
              <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{k.token_prefix}…</code>
              <span className="font-medium text-ink">{k.label}</span>
              <span className="text-xs text-muted">
                created {format(new Date(k.created_at), 'd MMM yyyy')}
                {k.last_used_at ? `, last used ${format(new Date(k.last_used_at), 'd MMM yyyy')}` : ', never used'}
              </span>
              <Button size="xs" variant="ghost-danger" className="ml-auto" onClick={() => revokeMutation.mutate(k.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No keys yet.</p>
      )}

      {createdToken ? (
        <div className="rounded-md border border-primary/40 bg-primary-50 dark:bg-primary-900/10 p-3 space-y-1">
          <p className="text-sm font-medium text-ink">Copy this key now. It will not be shown again.</p>
          <code className="block break-all rounded bg-card border border-border px-2 py-1 text-xs">{createdToken}</code>
          <Button size="xs" variant="secondary" onClick={() => setCreatedToken('')}>
            I have copied it
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <Input label="What is this key for?" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Discord bot" />
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={!label.trim()} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          Create key
        </Button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
