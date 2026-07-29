import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { SortableTh } from '../../components/data/SortableTh';
import { useDataView } from '../../components/data/useDataView';
import { api } from '../../api/client';
import { SetupGuide } from '../../components/SetupGuide';
import { googleSteps, dropboxSteps } from './backupSetupSteps';
import { DrillProof } from '../../components/backups/DrillProof';
import { backupsApi, type Backup, type BackupsOverview, type Destination, type DrillEvidence } from '../../api/backups';

/** How each destination is named to a person. Never the protocol. */
const DESTINATION_LABELS: Record<Destination, string> = {
  none: 'nowhere else',
  google: 'Google Drive',
  dropbox: 'Dropbox',
  s3: 'your storage',
};

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

/**
 * An address someone has to paste somewhere else exactly. Selecting a long
 * URL by hand is where transcription errors come from, so it is one press.
 */
function CopyableAddress({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-ink">{label}</span>
      <code className="flex-1 break-all rounded bg-surface px-2 py-1 text-xs text-muted">{value}</code>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** Where this copy exists, said plainly. */
function whereText(b: Backup): string {
  if (b.status !== 'ok') return '';
  const away: string[] = [];
  if (b.offsite_at) away.push(DESTINATION_LABELS[(b.offsite_kind ?? 'none') as Destination]);
  if (b.downloaded_at) away.push('downloaded');
  return away.length > 0 ? `This server and ${away.join(', ')}` : 'This server only';
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
  const [showStorage, setShowStorage] = useState(false);
  const [guide, setGuide] = useState<'google' | 'dropbox' | null>(null);
  const [drillResult, setDrillResult] = useState<DrillEvidence | null>(null);
  const [storage, setStorage] = useState({ bucket: '', region: '', access_key: '', secret_key: '', endpoint: '' });

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

  // Google returns people here with the outcome in the address. Read it once,
  // say it in words, and tidy the address so a refresh does not repeat it.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    if (hash === 'connected=1') {
      setNotice({ kind: 'ok', text: 'Connected. Copies will be kept there as well as here from now on.' });
    } else if (hash.startsWith('error=')) {
      setNotice({ kind: 'bad', text: `That did not connect: ${hash.slice(6).replace(/-/g, ' ')}.` });
    }
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const rows = data?.backups ?? [];
  const latest = rows.find((b) => b.stored && b.status === 'ok');
  const view = useDataView<Backup>({
    rows,
    getId: (b) => b.id,
    searchText: (b) => `${b.filename ?? ''} ${stateText(b)}`,
    sorts: useMemo(
      () => [
        { key: 'when', label: 'When', defaultDir: 'desc' as const, compare: (a: Backup, b: Backup) => a.started_at.localeCompare(b.started_at) },
        { key: 'size', label: 'Size', compare: (a: Backup, b: Backup) => (a.size_bytes ?? 0) - (b.size_bytes ?? 0) },
        { key: 'state', label: 'State', compare: (a: Backup, b: Backup) => stateText(a).localeCompare(stateText(b)) },
        { key: 'kept', label: 'Kept', compare: (a: Backup, b: Backup) => whereText(a).localeCompare(whereText(b)) },
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

  // The practice emergency. Deliberately destructive, on a practice copy
  // that never touches anything real, because a backup nobody has ever
  // restored is a rumour.
  async function runPractice() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await backupsApi.runDrill();
      setDrillResult(result);
      setNotice({ kind: result.drill.status === 'passed' ? 'ok' : 'bad', text: result.message });
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function connect(provider: 'google' | 'dropbox') {
    setBusy(true);
    try {
      const { url } = await backupsApi.connect(provider);
      window.location.href = url;
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
      setBusy(false);
    }
  }

  async function disconnect(provider: 'google' | 'dropbox') {
    setBusy(true);
    try {
      const result = await backupsApi.disconnect(provider);
      setNotice({ kind: 'ok', text: result.message });
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // Saving what a step collected, so the walkthrough never sends someone to
  // another screen holding two values they were just told to copy.
  async function saveGuideValues(values: Record<string, string>): Promise<string | null> {
    if (!guide) return null;
    try {
      await backupsApi.saveApp(guide, values);
      await load();
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }

  async function saveStorage() {
    setBusy(true);
    try {
      const result = await backupsApi.saveStorage(storage);
      setNotice({ kind: 'ok', text: result.message });
      setShowStorage(false);
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function disconnectStorage() {
    setBusy(true);
    try {
      const result = await backupsApi.disconnectStorage();
      setNotice({ kind: 'ok', text: result.message });
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function sendOffsite(b: Backup) {
    setBusy(true);
    try {
      const result = await backupsApi.sendOffsite(b.id);
      setNotice({ kind: 'ok', text: result.message });
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

  // Only a copy that has left this server counts as protection. Everything
  // else gets an honest heading rather than a reassuring one.
  const protectedNow = data.status.state === 'protected';
  const headline =
    data.status.state === 'protected'
      ? 'Your data is protected'
      : data.status.state === 'here_only'
        ? 'Your copies are only on this server'
        : data.status.state === 'no_room'
          ? 'This server has run out of room'
          : data.status.state === 'off'
            ? 'Copies are turned off'
            : data.status.state === 'none'
              ? 'No copy yet'
              : 'Your data needs attention';
  const googleReady = data.cloud.destinations.find((d) => d.id === 'google')?.available ?? false;
  const dropboxReady = data.cloud.destinations.find((d) => d.id === 'dropbox')?.available ?? false;
  const activeAccount = data.cloud.destinations.find((d) => d.id === data.cloud.active)?.account ?? null;
  const restoreDate = restoring ? new Date(restoring.started_at).toISOString().slice(0, 10) : '';
  // Whatever just ran wins over whatever was there when the screen loaded.
  const evidence = drillResult ?? data.last_drill;
  const lastDrill = evidence?.drill ?? null;

  return (
    <div className="space-y-6">
      {/*
        The ladder. Every level is worked out from what has actually happened,
        never from a box someone ticked, so it cannot be reached by intending
        to. The one nobody ever does, proving a restore really works, is the
        last on purpose: putting it at the top of the climb is the only honest
        way found to make the boring half feel like progress rather than
        nagging.
      */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">
            Level {data.levels.current} of {data.levels.total}
          </h2>
          <span className="text-sm text-muted">{data.levels.current === data.levels.total ? 'Everything in place' : 'Keep going'}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{data.levels.headline}</p>

        <div className="mt-3 flex gap-1">
          {data.levels.levels.map((l) => (
            <span
              key={l.level}
              className={`h-2 flex-1 rounded-full ${l.reached ? 'bg-primary' : 'bg-border'}`}
              aria-hidden="true"
            />
          ))}
        </div>

        <ol className="mt-4 space-y-3">
          {data.levels.levels.map((l) => {
            const isNext = !l.reached && l.level === data.levels.current + 1;
            return (
              <li key={l.level} className="flex gap-3">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    l.reached ? 'bg-primary text-white' : isNext ? 'border-2 border-primary text-primary' : 'border border-border text-muted'
                  }`}
                  aria-hidden="true"
                >
                  {l.reached ? '✓' : l.level}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${l.reached || isNext ? 'text-ink' : 'text-muted'}`}>{l.title}</p>
                  <p className="text-sm text-muted">{l.meaning}</p>
                  {isNext && l.next ? <p className="mt-1 text-sm text-ink">{l.next}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* The whole point of the screen: one line a worried person understands. */}
      <div className={`rounded-lg border p-4 ${protectedNow ? 'border-border bg-card' : 'border-amber-400 bg-amber-50 dark:bg-amber-950/30'}`}>
        <h2 className="text-base font-semibold text-ink">{headline}</h2>
        <p className="mt-1 text-sm text-muted">
          {data.status.message}
          {data.last_backup_at ? ` Last copy ${howLongAgo(data.last_backup_at)}.` : ''}
        </p>
        {data.space.room_for_more > 0 ? (
          <p className="mt-1 text-sm text-muted">
            There is room here for about {data.space.room_for_more} more {data.space.room_for_more === 1 ? 'copy' : 'copies'}.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={runNow} loading={busy}>
            Make a copy now
          </Button>
          {latest ? (
            <Button variant="secondary" size="sm" onClick={() => void download(latest)}>
              Download the latest copy
            </Button>
          ) : null}
        </div>
      </div>

      {/*
        Proving it. The only way to know copies work is to destroy something
        and bring it back, so this does exactly that, on a practice copy.
      */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-ink">Practice an emergency</h3>
        <p className="mt-1 text-sm text-muted">
          This makes a practice copy of everything, deliberately destroys every record and every document file in it,
          and puts it all back, then checks what returned is the same as what was there. Your real records are never
          touched at any point.
        </p>
        {lastDrill ? (
          <p className="mt-2 text-sm text-muted">
            {lastDrill.status === 'passed' ? (
              <>
                Last practice {howLongAgo(lastDrill.started_at)}: {lastDrill.rows_before} records destroyed, all{' '}
                {lastDrill.rows_restored} came back unchanged.
              </>
            ) : lastDrill.status === 'running' ? (
              <>A practice run is going now.</>
            ) : (
              <span className="text-red-600 dark:text-red-400">
                Last practice did not pass: {lastDrill.error ?? 'it did not finish.'}
              </span>
            )}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Never practised. Until you have, nobody knows the copies work.</p>
        )}
        <div className="mt-3">
          <Button variant={data.levels.current === 2 ? 'primary' : 'secondary'} size="sm" onClick={() => void runPractice()} loading={busy}>
            Practise now
          </Button>
        </div>
      </div>

      {/*
        The proof itself. Three numbers going up, down and back up again is a
        claim; this is the working behind it, so somebody who is worried can
        look rather than take our word.
      */}
      {evidence ? <DrillProof evidence={evidence} /> : null}

      {/* Whatever just happened, said in a sentence, right where they acted. */}
      {notice ? (
        <p className={`text-sm ${notice.kind === 'ok' ? 'text-ink' : 'text-red-600 dark:text-red-400'}`}>{notice.text}</p>
      ) : null}

      {/*
        The only thing that survives this server being lost. Two buttons for
        the services people already have, and everything else folded away
        under Advanced for the few who want it.
      */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-ink">Keep a copy off this server</h3>
        {data.cloud.ready ? (
          <>
            <p className="mt-1 text-sm text-muted">
              Copies are being kept in {activeAccount ?? DESTINATION_LABELS[data.cloud.active]}, as well as here. Only
              the files PareCare puts there are ever visible to it.
            </p>
            <div className="mt-3">
              {data.cloud.active === 's3' ? (
                <Button variant="secondary" size="sm" onClick={() => void disconnectStorage()} disabled={busy}>
                  Stop sending copies there
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void disconnect(data.cloud.active as 'google' | 'dropbox')}
                  disabled={busy}
                >
                  Stop using {DESTINATION_LABELS[data.cloud.active]}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              Connect one of these and every copy is kept there as well as here, so the records survive this server
              being lost. PareCare only ever sees the files it puts there.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => (googleReady ? void connect('google') : setGuide('google'))}
                disabled={busy}
              >
                {googleReady ? 'Connect Google Drive' : 'Set up Google Drive'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => (dropboxReady ? void connect('dropbox') : setGuide('dropbox'))}
                disabled={busy}
              >
                {dropboxReady ? 'Connect Dropbox' : 'Set up Dropbox'}
              </Button>
            </div>
            {googleReady || dropboxReady ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Something not working?</span>
                <Button variant="ghost" size="xs" onClick={() => setGuide('google')}>
                  Walk through the Google steps
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setGuide('dropbox')}>
                  Walk through the Dropbox steps
                </Button>
              </div>
            ) : null}
            {!googleReady || !dropboxReady ? (
              <p className="mt-2 text-xs text-muted">
                {!googleReady && !dropboxReady
                  ? 'Neither has been set up for this installation yet.'
                  : !googleReady
                    ? 'Google has not been set up for this installation yet.'
                    : 'Dropbox has not been set up for this installation yet.'}{' '}
                The addresses below are what whoever sets it up will need.
              </p>
            ) : null}

            {/*
              Always shown, not only before anything is set up. Google and
              Dropbox both refuse with their own error page if this address is
              not registered against the app, and that error arrives on their
              site with no way back to here. Someone who has just been bounced
              to a raw "redirect_uri_mismatch" needs the exact string in front
              of them, not a screen that assumes everything went well.
            */}
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted">
                If Google or Dropbox shows an error about a redirect address, it is because this address has not been
                added to the app there yet. Copy it in exactly, with nothing after it.
              </p>
              <CopyableAddress label="Google" value={data.cloud.google_redirect_uri} />
              <CopyableAddress label="Dropbox" value={data.cloud.dropbox_redirect_uri} />
              <p className="text-xs text-muted">
                Google also needs the Drive API turned on for that project, and permission to see the files it creates.
              </p>
            </div>

            <div className="mt-3">
              <Button variant="ghost" size="xs" onClick={() => setShowStorage((v) => !v)}>
                {showStorage ? 'Hide other storage' : 'Use other storage instead'}
              </Button>
            </div>
            {showStorage ? (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <p className="text-xs text-muted">
                  For anyone who already has storage they trust. Works with Backblaze B2, Wasabi, Cloudflare R2, MinIO
                  and Amazon. The details are checked before anything relies on them.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="Bucket name"
                    value={storage.bucket}
                    onChange={(e) => setStorage({ ...storage, bucket: e.target.value })}
                  />
                  <Input
                    placeholder="Region, if it has one"
                    value={storage.region}
                    onChange={(e) => setStorage({ ...storage, region: e.target.value })}
                  />
                  <Input
                    placeholder="Access key"
                    value={storage.access_key}
                    onChange={(e) => setStorage({ ...storage, access_key: e.target.value })}
                  />
                  <Input
                    type="password"
                    placeholder="Secret key"
                    value={storage.secret_key}
                    onChange={(e) => setStorage({ ...storage, secret_key: e.target.value })}
                  />
                  <Input
                    placeholder="Address, if it is not Amazon"
                    value={storage.endpoint}
                    onChange={(e) => setStorage({ ...storage, endpoint: e.target.value })}
                  />
                </div>
                <Button variant="primary" size="sm" onClick={() => void saveStorage()} loading={busy}>
                  Check and use this storage
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

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
                  <SortableTh label="Kept" sortKey="kept" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
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
                    <td className="px-3 py-2 text-muted">
                      {whereText(b)}
                      {b.offsite_error ? <span className="block text-xs text-muted">{b.offsite_error}</span> : null}
                    </td>
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
                          {data.cloud.ready && !b.offsite_at ? (
                            <Button variant="ghost" size="xs" onClick={() => void sendOffsite(b)} disabled={busy}>
                              Send a copy away
                            </Button>
                          ) : null}
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
      <SetupGuide
        open={guide === 'google'}
        title="Setting up Google Drive"
        steps={googleSteps(data.cloud.google_redirect_uri, googleReady)}
        onClose={() => setGuide(null)}
        onSave={saveGuideValues}
        onFinish={() => void connect('google')}
        finishLabel="Connect Google Drive"
        busy={busy}
      />

      <SetupGuide
        open={guide === 'dropbox'}
        title="Setting up Dropbox"
        steps={dropboxSteps(data.cloud.dropbox_redirect_uri, dropboxReady)}
        onClose={() => setGuide(null)}
        onSave={saveGuideValues}
        onFinish={() => void connect('dropbox')}
        finishLabel="Connect Dropbox"
        busy={busy}
      />

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
