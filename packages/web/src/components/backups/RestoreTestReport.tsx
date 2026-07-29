import { useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { SortableTh } from '../data/SortableTh';
import { useDataView } from '../data/useDataView';
import type { DrillEvidence, DrillRecord, DrillTable } from '../../api/backups';

/**
 * What a restore test did, shown three ways. Meant to be compared and reduced
 * to one:
 *
 *   What happened    every step in order, with the time each one took.
 *   Impact on data   every kind of record counted and fingerprinted.
 *   Records checked  named records, followed through deletion and back.
 *
 * A fingerprint is a short code worked out from the contents of a record.
 * Same contents, same code. It is what turns "the right number came back"
 * into "the same records came back", and it is explained on screen every time
 * it appears, because nobody should need to know what a checksum is.
 */

const VIEWS = [
  { key: 'steps', label: 'What happened' },
  { key: 'data', label: 'Impact on data' },
  { key: 'records', label: 'Records checked' },
] as const;

type View = (typeof VIEWS)[number]['key'];

function timeText(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function secondsText(seconds: string | number | null): string {
  if (seconds == null) return '';
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '';
  return n < 1 ? 'under a second' : `${n.toFixed(1)} seconds`;
}

/** The first few characters are enough to see two codes differ at a glance. */
function shortCode(code: string | null): string {
  if (!code) return 'none';
  return code.slice(0, 8);
}

const FINGERPRINT_NOTE =
  'A fingerprint is a short code worked out from the contents. Same contents, same code, so two matching codes mean the records came back unchanged rather than merely came back in the right number.';

/** A record came back exactly as it was: gone in the middle, identical at the end. */
function recordProved(r: DrillRecord): boolean {
  return !r.present_after_destroy && !!r.fingerprint_after && r.fingerprint_after === r.fingerprint_before;
}

function tableProved(t: DrillTable): boolean {
  return (
    t.rows_after_destroy === 0 &&
    t.rows_restored === t.rows_before &&
    (t.fingerprint_before ?? '') === (t.fingerprint_after ?? '')
  );
}

/** Everything one test wrote down, as a plain text file to keep or send on. */
function reportText(evidence: DrillEvidence): string {
  const { drill, steps, tables, records } = evidence;
  const lines: string[] = [
    'PareCare restore test',
    `Started ${new Date(drill.started_at).toLocaleString()}`,
    drill.finished_at ? `Finished ${new Date(drill.finished_at).toLocaleString()}` : 'Did not finish',
    `Result: ${drill.status === 'passed' ? 'Everything came back, unchanged' : 'Did not pass'}`,
    '',
    'What happened',
  ];
  for (const s of steps) {
    lines.push(`  ${timeText(s.started_at)}  ${s.title}${s.seconds == null ? '' : ` (${secondsText(s.seconds)})`}`);
    if (s.detail) lines.push(`            ${s.detail}`);
  }
  lines.push('', 'Impact on data');
  for (const t of tables) {
    lines.push(
      `  ${t.kind}: ${t.rows_before} before, ${t.rows_after_destroy} after deleting, ${t.rows_restored} back` +
        ` (fingerprint ${shortCode(t.fingerprint_before)} then ${shortCode(t.fingerprint_after)})`
    );
  }
  if (records.length > 0) {
    lines.push('', 'Records checked');
    for (const r of records) {
      lines.push(
        `  ${r.kind}: ${r.label}${r.owner_label ? `, ${r.owner_label}` : ''}: ` +
          `${r.present_after_destroy ? 'was still there after deleting' : 'deleted'}, ` +
          `${recordProved(r) ? 'came back identical' : 'did not come back identical'}`
      );
    }
  }
  return lines.join('\n');
}

function downloadReport(evidence: DrillEvidence): void {
  const blob = new Blob([reportText(evidence)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `parecare-practice-${new Date(evidence.drill.started_at).toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/* --- What happened -------------------------------------------------------- */

/**
 * Every step in the order it ran, with a timestamp and how long it took.
 * Nothing is summarised, so the deletion step is visible in the middle with
 * its own time against it.
 */
function Steps({ evidence }: { evidence: DrillEvidence }) {
  const { steps } = evidence;
  if (steps.length === 0) {
    return <p className="text-sm text-muted">This test did not get far enough to write anything down.</p>;
  }
  return (
    <div>
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.id} className="flex gap-3">
            <span className="w-20 shrink-0 pt-0.5 text-xs tabular-nums text-muted">{timeText(s.started_at)}</span>
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.outcome === 'failed' ? 'bg-red-500' : 'bg-primary'}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className={`text-sm font-medium ${s.outcome === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-ink'}`}>
                {s.title}
                {s.seconds == null ? null : <span className="ml-2 text-xs font-normal text-muted">{secondsText(s.seconds)}</span>}
              </p>
              {s.detail ? <p className="text-sm text-muted">{s.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => downloadReport(evidence)}>
          Save this as a file
        </Button>
      </div>
    </div>
  );
}

/* --- Records checked ------------------------------------------------------ */

/**
 * Named records at all three points: found, deleted, back. Counts matching is
 * not the question most people are asking; whether a particular medication
 * list would come back is.
 */
function Records({ evidence }: { evidence: DrillEvidence }) {
  const { records } = evidence;
  if (records.length === 0) {
    return <p className="text-sm text-muted">There were no records to follow in this test.</p>;
  }
  const allProved = records.every(recordProved);

  const Column = ({
    title,
    caption,
    children,
  }: {
    title: string;
    caption: string;
    children: React.ReactNode;
  }) => (
    <div className="rounded-lg border border-border p-3">
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <p className="mb-2 text-xs text-muted">{caption}</p>
      {children}
    </div>
  );

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        These are real records out of the copy. Each one was found by name, looked for again after everything was
        deleted, and compared with how it was once it had been put back.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Column title="Before" caption="Found in the copy, and its contents noted.">
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={`b-${r.id}`}>
                <p className="text-sm text-ink">{r.label}</p>
                <p className="text-xs text-muted">{r.owner_label ?? r.kind}</p>
              </li>
            ))}
          </ul>
        </Column>

        <Column title="After deleting" caption="Looked for again, one by one.">
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={`d-${r.id}`}>
                <p className={`text-sm ${r.present_after_destroy ? 'text-red-600 dark:text-red-400' : 'text-ink line-through'}`}>
                  {r.label}
                </p>
                <p className="text-xs text-muted">{r.present_after_destroy ? 'still there, which it should not be' : 'gone'}</p>
              </li>
            ))}
          </ul>
        </Column>

        <Column title="After putting it back" caption="Found again, and compared field by field.">
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={`a-${r.id}`}>
                <p className="text-sm text-ink">{r.label}</p>
                <p className={`text-xs ${recordProved(r) ? 'text-muted' : 'text-red-600 dark:text-red-400'}`}>
                  {recordProved(r)
                    ? 'back, every field identical'
                    : r.fingerprint_after
                      ? 'back, but something about it changed'
                      : 'did not come back'}
                </p>
              </li>
            ))}
          </ul>
        </Column>
      </div>
      <p className="mt-3 text-sm text-ink">
        {allProved
          ? `All ${records.length} were deleted, and all ${records.length} came back with the same contents.`
          : 'Some of these did not come back as they were, so this copy cannot be relied on yet.'}
      </p>
    </div>
  );
}

/* --- Impact on data ------------------------------------------------------- */

/**
 * Every kind of record, counted at all three points and fingerprinted at two.
 * Complete rather than a sample, and every column sorts, so an odd row is
 * easy to find.
 */
function DataImpact({ evidence }: { evidence: DrillEvidence }) {
  const rows = evidence.tables;
  const view = useDataView<DrillTable>({
    rows,
    getId: (t) => t.id,
    sorts: useMemo(
      () => [
        { key: 'kind', label: 'Kind', compare: (a: DrillTable, b: DrillTable) => a.kind.localeCompare(b.kind) },
        { key: 'before', label: 'Before', defaultDir: 'desc' as const, compare: (a: DrillTable, b: DrillTable) => a.rows_before - b.rows_before },
        {
          key: 'deleted',
          label: 'After deleting',
          compare: (a: DrillTable, b: DrillTable) => a.rows_after_destroy - b.rows_after_destroy,
        },
        { key: 'restored', label: 'Came back', defaultDir: 'desc' as const, compare: (a: DrillTable, b: DrillTable) => a.rows_restored - b.rows_restored },
        {
          key: 'fingerprint_before',
          label: 'Fingerprint before',
          compare: (a: DrillTable, b: DrillTable) => (a.fingerprint_before ?? '').localeCompare(b.fingerprint_before ?? ''),
        },
        {
          key: 'fingerprint_after',
          label: 'Fingerprint after',
          compare: (a: DrillTable, b: DrillTable) => (a.fingerprint_after ?? '').localeCompare(b.fingerprint_after ?? ''),
        },
        {
          key: 'match',
          label: 'Match',
          compare: (a: DrillTable, b: DrillTable) => Number(tableProved(a)) - Number(tableProved(b)),
        },
      ],
      []
    ),
    defaultPageSize: 25,
  });

  if (rows.length === 0) {
    return <p className="text-sm text-muted">This test did not get as far as counting anything.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <SortableTh label="Kind of record" sortKey="kind" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
              <SortableTh label="Before" sortKey="before" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
              <SortableTh label="After deleting" sortKey="deleted" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
              <SortableTh label="Came back" sortKey="restored" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
              <SortableTh
                label="Fingerprint before"
                sortKey="fingerprint_before"
                activeKey={view.sortKey}
                dir={view.sortDir}
                onToggle={view.toggleSort}
              />
              <SortableTh
                label="Fingerprint after"
                sortKey="fingerprint_after"
                activeKey={view.sortKey}
                dir={view.sortDir}
                onToggle={view.toggleSort}
              />
              <SortableTh label="Match" sortKey="match" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
            </tr>
          </thead>
          <tbody>
            {view.view.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-ink">{t.kind}</td>
                <td className="px-3 py-2 tabular-nums text-muted">{t.rows_before}</td>
                <td className="px-3 py-2 tabular-nums text-muted">{t.rows_after_destroy}</td>
                <td className="px-3 py-2 tabular-nums text-muted">{t.rows_restored}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted">{shortCode(t.fingerprint_before)}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted">{shortCode(t.fingerprint_after)}</td>
                <td className={`px-3 py-2 ${tableProved(t) ? 'text-muted' : 'text-red-600 dark:text-red-400'}`}>
                  {tableProved(t) ? 'Identical' : 'Not the same'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        The middle column is zero because everything was deleted before it was put back. {FINGERPRINT_NOTE}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The three views together, with a chooser across the top.
 *
 * The chooser is temporary. Three ways of saying the same thing is two too
 * many; showing them at once is only so one can be picked and the other two
 * deleted.
 */
export function RestoreTestReport({ evidence }: { evidence: DrillEvidence }) {
  const [shown, setShown] = useState<View>('steps');

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">What the test did</h3>
        <span className="text-sm text-muted">
          {new Date(evidence.drill.started_at).toLocaleString()}
          {evidence.drill.status === 'passed' ? ' · everything came back' : ' · did not pass'}
        </span>
      </div>

      {/* A segmented view switch, the same control as cards and table
          elsewhere: it changes what is shown, not what is true. */}
      <div className="mt-3 flex w-fit items-center gap-1 rounded-md bg-surface-2 p-0.5">
        {VIEWS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`rounded px-2.5 py-1 text-xs transition-colors ${
              shown === p.key ? 'bg-card text-ink font-medium shadow-sm' : 'text-muted hover:text-ink'
            }`}
            onClick={() => setShown(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {shown === 'steps' ? <Steps evidence={evidence} /> : null}
        {shown === 'data' ? <DataImpact evidence={evidence} /> : null}
        {shown === 'records' ? <Records evidence={evidence} /> : null}
      </div>
    </div>
  );
}
