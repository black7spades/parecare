import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { SortableTh } from '../../components/data/SortableTh';
import { useDataView } from '../../components/data/useDataView';
import { api } from '../../api/client';
import { backupsApi, type Backup, type BackupsOverview } from '../../api/backups';

const SELECT_CLASS =
  'rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const FREQUENCIES = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
] as const;

const KEEP_FOR = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: 'A year' },
] as const;

/** "2 hours ago", the way a person would say it. */
function howLongAgo(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function whenText(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sizeText(bytes: number | null): string {
  if (bytes == null) return '';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb.toFixed(1)} MB`;
}

/** What this copy is, said plainly. Never a status code. */
function stateText(b: Backup): string {
  if (b.status === 'running') return 'Being made';
  if (b.status === 'failed') return 'Did not work';
  if (b.verified_at) return 'Checked and working';
  return 'Saved, not checked';
}

/**
 * Backups. Copies run from install without anyone setting them up, so this
 * screen is here to say so in one line, and to hand the data back when it is
 * needed. Everything clever about how copies are thinned out and checked
 * stays in the service and is never named here.
 */
export function AdminBackups() {
  const [data, setData] = useState<BackupsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await backupsApi.overview());
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.backups ?? [];
  const view = useDataView<Backup>({
    rows,
    getId: (b) => b.id,
    searchText: (b) => `${b.filename ?? ''} ${stateText(b)}`,
    sorts: useMemo(
      () => [
        { key: 'when', label: 'When', defaultDir: 'desc' as const, compare: (a: Backup, b: Backup) => a.started_at.localeCompare(b.started_at) },
        { key: 'size', label: 'Size', compare: (a: Backup, b: Backup) => (a.size_bytes ?? 0) - (b.size_bytes ?? 0) },
        { key: 'state', label: 'State', compare: (a: Backup, b: Backup) => stateText(a).localeCompare(stateText(b)) },
        { key: 'taken', label: 'Taken', compare: (a: Backup, b: Backup) => a.kind.localeCompare(b.kind) },
      ],
      []
    ),
    defaultPageSize: 10,
  });

  async function saveSetting(key: string, value: string) {
    setBusy(true);
    try {
      await backupsApi.save({ [key]: value });
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    setNotice(null);
    try {
      await backupsApi.runNow();
      setNotice({ kind: 'ok', text: 'A copy has been made.' });
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function check(b: Backup) {
    setBusy(true);
    try {
      const result = await backupsApi.check(b.id);
      setNotice({ kind: result.ok ? 'ok' : 'bad', text: result.message });
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function download(b: Backup) {
    try {
      const blob = await api.blob(backupsApi.downloadUrl(b.id));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = b.filename ?? 'parecare-backup.tar.gz';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    }
  }

  async function doRestore() {
    if (!restoring) return;
    setBusy(true);
    try {
      const result = await backupsApi.restore(restoring.id, confirmText.trim());
      setNotice({ kind: 'ok', text: result.message });
      setRestoring(null);
      setConfirmText('');
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading.</p>;
  if (!data) return <p className="text-sm text-muted">Backups could not be loaded just now.</p>;

  const protectedNow = data.status.state === 'protected';
  const restoreDate = restoring ? new Date(restoring.started_at).toISOString().slice(0, 10) : '';

  return (
    <div className="space-y-6">
      {/* The whole point of the screen: one line a worried person understands. */}
      <div className={`rounded-lg border p-4 ${protectedNow ? 'border-border bg-card' : 'border-amber-400 bg-amber-50 dark:bg-amber-950/30'}`}>
        <h2 className="text-base font-semibold text-ink">
          {protectedNow ? 'Your data is protected' : 'Your data needs attention'}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {data.status.message}
          {data.last_backup_at ? ` Last copy ${howLongAgo(data.last_backup_at)}.` : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={runNow} loading={busy}>
            Make a copy now
          </Button>
        </div>
      </div>

      {notice ? (
        <p className={`text-sm ${notice.kind === 'ok' ? 'text-ink' : 'text-red-600 dark:text-red-400'}`}>{notice.text}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">How often</span>
          <select
            className={SELECT_CLASS}
            value={data.settings.frequency}
            disabled={busy}
            onChange={(e) => void saveSetting('backups.frequency', e.target.value)}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Keep copies for</span>
          <select
            className={SELECT_CLASS}
            value={String(data.settings.keep_days)}
            disabled={busy}
            onChange={(e) => void saveSetting('backups.keep_days', e.target.value)}
          >
            {KEEP_FOR.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Automatic copies</span>
          <select
            className={SELECT_CLASS}
            value={data.settings.enabled ? 'on' : 'off'}
            disabled={busy}
            onChange={(e) => void saveSetting('backups.enabled', e.target.value)}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
      </div>

      <div>
        <h3 className="mb-2 text-base font-semibold text-ink">Copies</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">
            No copies yet. The first one is made within a few minutes, or press Make a copy now.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted">
                <tr>
                  <SortableTh label="When" sortKey="when" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
                  <SortableTh label="State" sortKey="state" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
                  <SortableTh label="Size" sortKey="size" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
                  <SortableTh label="Taken" sortKey="taken" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {view.view.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-ink">{whenText(b.started_at)}</td>
                    <td className="px-3 py-2">
                      <span className={b.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted'}>{stateText(b)}</span>
                      {b.error ? <span className="block text-xs text-muted">{b.error}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{sizeText(b.size_bytes)}</td>
                    <td className="px-3 py-2 text-muted">{b.kind === 'manual' ? 'By hand' : 'Automatically'}</td>
                    <td className="px-3 py-2">
                      {b.stored ? (
                        <div className="flex flex-wrap gap-1">
                          <Button variant="secondary" size="xs" onClick={() => void download(b)}>
                            Download
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => void check(b)} disabled={busy}>
                            Check
                          </Button>
                          <Button variant="ghost-danger" size="xs" onClick={() => setRestoring(b)}>
                            Put this back
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/*
        Restoring replaces the live records, so the date is typed rather than
        a button clicked past. A copy of how things are right now is taken
        first, so this is still not a one-way door.
      */}
      <Modal open={!!restoring} onClose={() => setRestoring(null)} title="Put this copy back">
        {restoring ? (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              This replaces everything with the copy from {whenText(restoring.started_at)}. Anything added since then will
              be gone from the live records.
            </p>
            <p className="text-sm text-muted">
              A copy of how things are right now is made first, so this can be undone by putting that one back.
            </p>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Type {restoreDate} to continue</span>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={restoreDate} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRestoring(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={busy}
                disabled={confirmText.trim() !== restoreDate}
                onClick={() => void doRestore()}
              >
                Put this copy back
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
