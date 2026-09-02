import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { siteCopyApi } from '../../api/siteCopy';
import { useSiteCopyStore } from '../../stores/siteCopy';
import { SITE_COPY_DEFAULTS } from '../../lib/siteCopyDefaults';

const GROUPS: { label: string; prefix: string }[] = [
  { label: 'System pages', prefix: 'system.' },
  { label: 'Directory pages', prefix: 'directory.' },
  { label: 'Profile pages', prefix: 'profile.' },
  { label: 'Account pages', prefix: 'account.' },
  { label: 'Other pages', prefix: '' },
];

function groupFor(key: string): string {
  for (const g of GROUPS) {
    if (g.prefix && key.startsWith(g.prefix)) return g.label;
  }
  return 'Other pages';
}

function keyToLabel(key: string): string {
  return key
    .replace(/\.subheader$/, '')
    .replace(/\./g, ' / ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AdminSiteCopy() {
  const { copy, load, setCopy } = useSiteCopyStore();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => { void load(); }, [load]);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, string>) => siteCopyApi.update(body),
    onSuccess: (resp) => {
      setCopy(resp.copy);
    },
  });

  const allKeys = Object.keys(SITE_COPY_DEFAULTS).sort();

  const grouped = new Map<string, string[]>();
  for (const key of allKeys) {
    const g = groupFor(key);
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(key);
  }

  const handleSave = (key: string) => {
    const value = drafts[key]?.trim();
    if (!value || value === (copy[key] ?? SITE_COPY_DEFAULTS[key])) {
      setDrafts((d) => { const next = { ...d }; delete next[key]; return next; });
      return;
    }
    saveMutation.mutate({ [key]: value }, {
      onSuccess: () => {
        setDrafts((d) => { const next = { ...d }; delete next[key]; return next; });
        setSaved(key);
        setTimeout(() => setSaved((s) => s === key ? null : s), 2500);
      },
    });
  };

  const handleReset = (key: string) => {
    const defaultVal = SITE_COPY_DEFAULTS[key];
    if (!defaultVal) return;
    saveMutation.mutate({ [key]: defaultVal }, {
      onSuccess: () => {
        setDrafts((d) => { const next = { ...d }; delete next[key]; return next; });
        setSaved(key);
        setTimeout(() => setSaved((s) => s === key ? null : s), 2500);
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Site copy</h1>
        <p className="text-sm text-muted">
          Edit the description text below every heading in the app. Changes appear for all users straight away.
          Use {'{'}<code className="text-xs">name</code>{'}'} in profile pages to insert the person's name.
        </p>
      </div>

      {GROUPS.map((group) => {
        const keys = grouped.get(group.label);
        if (!keys || keys.length === 0) return null;
        return (
          <div key={group.label} className="card space-y-4">
            <h2 className="text-base font-semibold text-ink">{group.label}</h2>
            {keys.map((key) => {
              const current = copy[key] ?? SITE_COPY_DEFAULTS[key] ?? '';
              const defaultVal = SITE_COPY_DEFAULTS[key] ?? '';
              const draft = drafts[key];
              const editing = draft !== undefined;
              const isCustomised = copy[key] !== undefined && copy[key] !== defaultVal;

              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{keyToLabel(key)}</span>
                    {isCustomised ? (
                      <span className="badge text-xs bg-primary-50 text-primary">Customised</span>
                    ) : null}
                    {saved === key ? (
                      <span className="text-xs text-primary">Saved</span>
                    ) : null}
                  </div>
                  {editing ? (
                    <div className="space-y-1">
                      <textarea
                        className="block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-ink shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        rows={2}
                        maxLength={500}
                      />
                      <div className="flex items-center gap-2">
                        <Button size="xs" onClick={() => handleSave(key)} loading={saveMutation.isPending}>
                          Save
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setDrafts((d) => { const next = { ...d }; delete next[key]; return next; })}>
                          Cancel
                        </Button>
                        {draft !== defaultVal ? (
                          <Button size="xs" variant="ghost" onClick={() => setDrafts((d) => ({ ...d, [key]: defaultVal }))}>
                            Reset to default
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 group">
                      <p className="text-sm text-muted flex-1">{current}</p>
                      <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="xs" variant="ghost" onClick={() => setDrafts((d) => ({ ...d, [key]: current }))}>
                          Edit
                        </Button>
                        {isCustomised ? (
                          <Button size="xs" variant="ghost" onClick={() => handleReset(key)} loading={saveMutation.isPending}>
                            Reset
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
