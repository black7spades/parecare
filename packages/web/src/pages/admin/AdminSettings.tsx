import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { EditableSubheader } from '../../components/ui/EditableSubheader';
import { settingsApi, type SettingField, type SettingGroup, type SettingsResponse, type AiModelInfo, type InstalledModel } from '../../api/settings';

const GROUP_TITLES: Record<string, { title: string; blurb: string }> = {
  ai: { title: 'Pare, your AI assistant', blurb: 'The provider, model and keys behind Pare, the assistant throughout PareCare, and the message mediation it runs.' },
  email: { title: 'Email server', blurb: 'The outgoing mail server used for invites and reminders.' },
  storage: { title: 'File storage', blurb: 'Where uploaded documents and photos are kept.' },
  oauth: { title: 'Social sign-in', blurb: 'Google and Facebook sign-in. Buttons appear once both fields in a pair are set.' },
  scheduler: { title: 'Reminder timing', blurb: 'How often PareCare checks for tasks that have come due.' },
  health: { title: 'Health spend', blurb: 'The currency prices are shown in, and whether a price is required on every medication and treatment.' },
  stripe: { title: 'Stripe billing', blurb: 'Only used when the platform runs as a paid service.' },
};

// The sections are shown in this order, most important to whoever runs the
// system first, and numbered so the screen reads as an ordered checklist.
const GROUP_ORDER = ['ai', 'email', 'storage', 'oauth', 'scheduler', 'health', 'stripe'];

const SELECT_CLASS =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function SourceTag({ source }: { source: SettingField['source'] }) {
  const label = source === 'db' ? 'Saved' : source === 'env' ? 'From the environment' : 'Default';
  const style =
    source === 'db' ? 'bg-primary-50 text-primary' : source === 'env' ? 'bg-surface-2 text-muted' : 'bg-surface-2 text-muted';
  return <span className={`badge text-xs ${style}`}>{label}</span>;
}

function HelpText({ field }: { field: SettingField }) {
  if (!field.help && !field.helpLink) return null;
  return (
    <p className="mt-1 text-xs text-muted">
      {field.help}{' '}
      {field.helpLink ? (
        <a href={field.helpLink.url} target="_blank" rel="noreferrer" className="text-primary hover:underline whitespace-nowrap">
          {field.helpLink.label} ↗
        </a>
      ) : null}
    </p>
  );
}

const SMTP_PRESETS = [
  {
    id: 'gmail',
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    note: 'Username is your full Gmail address; the password is a 16-character App Password (not your normal password). App Passwords require 2-Step Verification.',
    link: { label: 'Create an App Password', url: 'https://myaccount.google.com/apppasswords' },
  },
  {
    id: 'outlook',
    label: 'Outlook / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    note: 'Username is your email address. SMTP AUTH must be enabled for the mailbox; some accounts need an app password.',
    link: { label: 'Microsoft app passwords', url: 'https://support.microsoft.com/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944' },
  },
  {
    id: 'sendgrid',
    label: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    note: 'Username is literally "apikey"; the password is a SendGrid API key with Mail Send permission.',
    link: { label: 'SendGrid API keys', url: 'https://app.sendgrid.com/settings/api_keys' },
  },
  {
    id: 'mailgun',
    label: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587,
    note: 'Use the SMTP username and password from your Mailgun sending-domain settings.',
    link: { label: 'Mailgun', url: 'https://app.mailgun.com/' },
  },
];

function SmtpPresets({ onApply }: { onApply: (host: string, port: number) => void }) {
  const [id, setId] = useState('');
  const preset = SMTP_PRESETS.find((p) => p.id === id);
  return (
    <div className="rounded-md border border-border bg-surface p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="smtp-preset" className="text-sm font-medium text-ink">Quick setup</label>
        <select
          id="smtp-preset"
          className={`${SELECT_CLASS} w-auto`}
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            const p = SMTP_PRESETS.find((x) => x.id === e.target.value);
            if (p) onApply(p.host, p.port);
          }}
        >
          <option value="">Choose a provider…</option>
          {SMTP_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
          <option value="custom">Other / custom</option>
        </select>
      </div>
      {preset ? (
        <p className="text-xs text-muted">
          Host and port filled in below. {preset.note}{' '}
          <a href={preset.link.url} target="_blank" rel="noreferrer" className="text-primary hover:underline whitespace-nowrap">
            {preset.link.label} ↗
          </a>
        </p>
      ) : id === 'custom' ? (
        <p className="text-xs text-muted">Enter your provider's SMTP host and port below.</p>
      ) : null}
    </div>
  );
}

function OAuthRedirectHelp() {
  const origin = window.location.origin;
  const uri = (p: string) => `${origin}/api/v1/auth/oauth/${p}/callback`;
  return (
    <div className="rounded-md border border-border bg-surface p-3 text-xs text-muted space-y-1.5">
      <p className="text-ink font-medium">Register these redirect URIs with the provider:</p>
      {(['google', 'facebook'] as const).map((p) => (
        <div key={p} className="flex items-center gap-2">
          <span className="w-16 shrink-0 capitalize">{p}</span>
          <code className="flex-1 truncate rounded bg-card border border-border px-2 py-1" data-testid={`redirect-${p}`}>{uri(p)}</code>
        </div>
      ))}
    </div>
  );
}

export function AdminSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });

  // Pending edits keyed by setting key. A string is a new value; '' clears the
  // override (reverts to .env / default). Unchanged keys are never sent.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [savedGroup, setSavedGroup] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, string>) => settingsApi.update(body),
    onSuccess: (resp: SettingsResponse) => {
      queryClient.setQueryData(['settings'], resp);
      setSaveError('');
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : 'Failed to save settings'),
  });

  const setField = (key: string, value: string) => setPending((p) => ({ ...p, [key]: value }));

  function saveGroup(group: SettingGroup) {
    const body: Record<string, string> = {};
    for (const field of group.fields) {
      if (field.key in pending) body[field.key] = pending[field.key];
    }
    if (Object.keys(body).length === 0) return;
    saveMutation.mutate(body, {
      onSuccess: () => {
        setPending((p) => {
          const next = { ...p };
          for (const k of Object.keys(body)) delete next[k];
          return next;
        });
        setRevealed((r) => {
          const next = { ...r };
          for (const k of Object.keys(body)) delete next[k];
          return next;
        });
        setSavedGroup(group.group);
        setTimeout(() => setSavedGroup((g) => (g === group.group ? null : g)), 2500);
      },
    });
  }

  if (isLoading) return <p className="text-sm text-muted">Loading settings…</p>;
  if (error || !data) return <p className="text-sm text-red-600">Could not load settings.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">System settings</h1>
        <EditableSubheader copyKey="system.settings.subheader" />
      </div>

      {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}

      {[...data.groups]
        .sort((a, b) => {
          const ia = GROUP_ORDER.indexOf(a.group);
          const ib = GROUP_ORDER.indexOf(b.group);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        })
        .map((group, i) => {
        const meta = GROUP_TITLES[group.group] ?? { title: group.group, blurb: '' };
        const dirty = group.fields.some((f) => f.key in pending);
        return (
          <div key={group.group} className="card space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-ink">
                  <span className="text-muted mr-2">{i + 1}.</span>
                  {meta.title}
                </h2>
                {meta.blurb ? <p className="text-sm text-muted">{meta.blurb}</p> : null}
              </div>
              {savedGroup === group.group ? <span className="text-sm text-primary shrink-0">Saved ✓</span> : null}
            </div>

            {group.group === 'email' ? (
              <SmtpPresets
                onApply={(host, port) => {
                  setField('email.smtp_host', host);
                  setField('email.smtp_port', String(port));
                }}
              />
            ) : null}
            {group.group === 'oauth' ? <OAuthRedirectHelp /> : null}
            {group.group === 'ai' ? <AiModelManager /> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              {group.fields.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  pending={field.key in pending ? pending[field.key] : undefined}
                  revealed={!!revealed[field.key]}
                  onReveal={() => setRevealed((r) => ({ ...r, [field.key]: true }))}
                  onChange={(v) => setField(field.key, v)}
                  onClear={() => {
                    setField(field.key, '');
                    setRevealed((r) => ({ ...r, [field.key]: false }));
                  }}
                />
              ))}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <Button onClick={() => saveGroup(group)} loading={saveMutation.isPending} disabled={!dirty}>
                Save {meta.title.toLowerCase()}
              </Button>
              {group.group === 'email' ? <TestEmailButton /> : null}
              {group.group === 'ai' ? <TestAiButton /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldRow({
  field,
  pending,
  revealed,
  onReveal,
  onChange,
  onClear,
}: {
  field: SettingField;
  pending: string | undefined;
  revealed: boolean;
  onReveal: () => void;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  // Secret fields never render their value. Show set/unset, with a reveal to
  // set or replace, and a clear that reverts to the .env / default.
  if (field.secret) {
    const willClear = pending === '';
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-ink">{field.label}</span>
          <SourceTag source={field.source} />
        </div>
        {revealed ? (
          <Input
            aria-label={field.label}
            type="password"
            placeholder="Enter new value"
            value={pending && pending !== '' ? pending : ''}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="new-password"
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">
              {willClear ? 'Will clear on save' : field.isSet ? '••••••••  (set)' : 'Not set'}
            </span>
            <Button size="xs" variant="ghost" onClick={onReveal}>
              {field.isSet ? 'Replace' : 'Set'}
            </Button>
            {field.isSet && !willClear ? (
              <Button size="xs" variant="ghost-danger" onClick={onClear}>
                Clear
              </Button>
            ) : null}
          </div>
        )}
        <HelpText field={field} />
      </div>
    );
  }

  const value = pending !== undefined ? pending : field.value != null ? String(field.value) : '';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={`set-${field.key}`} className="text-sm font-medium text-ink">
          {field.label}
        </label>
        <SourceTag source={field.source} />
      </div>
      {field.type === 'enum' ? (
        <select id={`set-${field.key}`} className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
          {(field.enumValues ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={`set-${field.key}`}
          type={field.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <HelpText field={field} />
    </div>
  );
}

function modelDetail(m: InstalledModel | null): string {
  if (!m) return '';
  const bits = [m.parameterSize, m.quantization].filter(Boolean);
  return bits.join(', ');
}

function formatBytes(n: number | null): string {
  if (!n || n <= 0) return '';
  const gb = n / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(n / 1_000_000)} MB`;
}

/**
 * Shows which assistant is running and its model, and, when Pare runs on this
 * machine, lets a super admin switch to a downloaded model or fetch a new one
 * by name or Hugging Face link. No compose or environment editing.
 */
function AiModelManager() {
  const queryClient = useQueryClient();
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');

  const { data: info } = useQuery({
    queryKey: ['ai-model'],
    queryFn: settingsApi.aiModel,
    // Follow a download and the warming state live; stop once nothing is moving.
    refetchInterval: (query) => {
      const d = query.state.data as AiModelInfo | undefined;
      const busy = (d?.pull && !d.pull.done) || d?.state === 'preparing';
      return busy ? 1500 : false;
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ai-model'] });
    void queryClient.invalidateQueries({ queryKey: ['settings'] });
    void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
  };

  const useModel = useMutation({
    mutationFn: (name: string) => settingsApi.update({ 'ai.model': name }),
    onSuccess: () => {
      setNote('');
      refresh();
    },
    onError: (e) => setNote(e instanceof Error ? e.message : 'Could not switch model'),
  });

  const pull = useMutation({
    mutationFn: (model: string) => settingsApi.pullModel(model),
    onSuccess: () => {
      setNote('');
      setRef('');
      void queryClient.invalidateQueries({ queryKey: ['ai-model'] });
    },
    onError: (e) => setNote(e instanceof Error ? e.message : 'Could not start the download'),
  });

  if (!info) return null;

  const stateWord =
    info.state === 'ready' ? 'ready' : info.state === 'preparing' ? 'still getting ready' : 'not available';
  const p = info.pull;
  const pulling = !!p.model && !p.done;
  const pct = p.total > 0 ? Math.min(100, Math.round((p.completed / p.total) * 100)) : null;

  return (
    <div className="rounded-md border border-border bg-surface p-3 space-y-3">
      {info.local ? (
        <>
          <div>
            <p className="text-sm font-medium text-ink">Running on this machine</p>
            <p className="text-sm text-muted">
              {info.active}
              {modelDetail(info.activeDetails) ? ` — ${modelDetail(info.activeDetails)}` : ''}, {stateWord}. Nothing
              leaves this machine.
            </p>
          </div>

          {info.installed.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted">Downloaded models</p>
              {info.installed.map((m) => {
                const active = m.name === info.active || m.name === `${info.active}:latest`;
                return (
                  <div key={m.name} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate text-ink">
                      {m.name}
                      {modelDetail(m) ? <span className="text-muted"> · {modelDetail(m)}</span> : null}
                      {formatBytes(m.size) ? <span className="text-muted"> · {formatBytes(m.size)}</span> : null}
                    </span>
                    {active ? (
                      <span className="badge text-xs bg-primary-50 text-primary shrink-0">In use</span>
                    ) : (
                      <Button size="xs" variant="ghost" onClick={() => useModel.mutate(m.name)} loading={useModel.isPending}>
                        Use
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="ai-model-ref" className="text-xs font-medium text-muted">
              Download another model
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[16rem]">
                <Input
                  id="ai-model-ref"
                  placeholder="gemma4:12b-it-q4_K_M or a Hugging Face link"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  disabled={pulling}
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => pull.mutate(ref.trim())}
                loading={pull.isPending || pulling}
                disabled={!ref.trim() || pulling}
              >
                Download
              </Button>
            </div>
            <p className="text-xs text-muted">
              Paste a model name, or a link from{' '}
              <a href="https://huggingface.co/models?library=gguf" target="_blank" rel="noreferrer" className="text-primary hover:underline whitespace-nowrap">
                Hugging Face ↗
              </a>
              . The larger the model, the slower it runs.
            </p>
          </div>

          {pulling ? (
            <div className="space-y-1" role="status">
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="truncate">Downloading {p.model} · {p.status}</span>
                {pct !== null ? <span className="shrink-0">{pct}%</span> : null}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full bg-primary transition-all" style={{ width: pct !== null ? `${pct}%` : '100%' }} />
              </div>
            </div>
          ) : null}
          {p.done && p.error ? <p className="text-sm text-red-600">Download failed: {p.error}</p> : null}
          {p.done && !p.error && p.model && p.finishedAt ? (
            <p className="text-sm text-muted">Downloaded {p.model}. Choose Use above to switch Pare to it.</p>
          ) : null}
        </>
      ) : (
        <div>
          <p className="text-sm font-medium text-ink">Running in the cloud</p>
          <p className="text-sm text-muted">
            PareCare is using {info.provider}
            {info.active ? ` with the model ${info.active}` : ' with the provider default'}, {stateWord}. Records are
            sent to the provider to be read. Change the provider, model or key in the fields below, or set the provider
            to run Pare on this machine instead.
          </p>
        </div>
      )}
      {note ? <p className="text-sm text-red-600">{note}</p> : null}
    </div>
  );
}

function TestEmailButton() {
  const [result, setResult] = useState<string>('');
  const mutation = useMutation({
    mutationFn: settingsApi.testEmail,
    onSuccess: (r) => setResult(r.ok ? `Sent to ${r.sentTo}` : r.error ?? 'Failed'),
    onError: (e) => setResult(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => mutation.mutate()} loading={mutation.isPending}>
        Send test email
      </Button>
      {result ? <span className="text-xs text-muted">{result}</span> : null}
    </div>
  );
}

function TestAiButton() {
  const [result, setResult] = useState<string>('');
  const mutation = useMutation({
    mutationFn: settingsApi.testAi,
    onSuccess: (r) => setResult(r.ok ? `OK (${r.provider}): ${r.sample}` : r.error ?? 'Failed'),
    onError: (e) => setResult(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => mutation.mutate()} loading={mutation.isPending}>
        Test AI connection
      </Button>
      {result ? <span className="text-xs text-muted truncate max-w-xs">{result}</span> : null}
    </div>
  );
}
