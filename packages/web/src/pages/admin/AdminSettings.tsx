import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { settingsApi, type SettingField, type SettingGroup, type SettingsResponse } from '../../api/settings';

const GROUP_TITLES: Record<string, { title: string; blurb: string }> = {
  ai: { title: 'AI assistant', blurb: 'Provider, model and keys for Ask PareCare and dispute mediation.' },
  email: { title: 'Email (SMTP)', blurb: 'The outgoing mail server used for invites and reminders.' },
  scheduler: { title: 'Scheduler', blurb: 'How often the reminder scheduler checks for due tasks.' },
  oauth: { title: 'Social sign-in', blurb: 'Google and Facebook sign-in. Buttons appear once both fields in a pair are set.' },
  storage: { title: 'File storage', blurb: 'Where uploaded documents and photos are kept.' },
  stripe: { title: 'Stripe billing', blurb: 'Only used when the platform runs in SaaS mode.' },
};

const SELECT_CLASS =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function SourceTag({ source }: { source: SettingField['source'] }) {
  const label = source === 'db' ? 'Saved' : source === 'env' ? 'From .env' : 'Default';
  const style =
    source === 'db' ? 'bg-primary-50 text-primary' : source === 'env' ? 'bg-surface-2 text-muted' : 'bg-surface-2 text-muted';
  return <span className={`badge text-xs ${style}`}>{label}</span>;
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
        <p className="text-sm text-muted">
          Edit configuration without touching .env or restarting. Changes apply immediately. Blank a field to fall
          back to the .env value. Secrets are stored encrypted and never shown again.
        </p>
      </div>

      {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}

      {data.groups.map((group) => {
        const meta = GROUP_TITLES[group.group] ?? { title: group.group, blurb: '' };
        const dirty = group.fields.some((f) => f.key in pending);
        return (
          <div key={group.group} className="card space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-ink">{meta.title}</h2>
                {meta.blurb ? <p className="text-sm text-muted">{meta.blurb}</p> : null}
              </div>
              {savedGroup === group.group ? <span className="text-sm text-primary shrink-0">Saved ✓</span> : null}
            </div>

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
            <button type="button" className="text-xs text-primary hover:underline" onClick={onReveal}>
              {field.isSet ? 'Replace' : 'Set'}
            </button>
            {field.isSet && !willClear ? (
              <button type="button" className="text-xs text-muted hover:text-red-600" onClick={onClear}>
                Clear
              </button>
            ) : null}
          </div>
        )}
        {field.help ? <p className="mt-1 text-xs text-muted">{field.help}</p> : null}
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
      {field.help ? <p className="mt-1 text-xs text-muted">{field.help}</p> : null}
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
