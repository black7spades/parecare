import { useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { SortableTh } from '../data/SortableTh';
import { useDataView } from '../data/useDataView';
import type { DrillEvidence, DrillRecord, DrillTable } from '../../api/backups';

/**
 * Three ways of showing that a practice emergency really happened.
 *
 * "Some records were destroyed, and then they came back" is a claim, not
 * proof, and reading it does nothing for somebody who is worried. These are
 * three different answers to the same question, meant to be looked at side by
 * side and reduced to one:
 *
 *   The transcript  — what happened, in order, with the time each part took.
 *   The witnesses   — real named records, followed through gone and back.
 *   The ledger      — every kind of record counted and fingerprinted.
 *
 * A fingerprint is a short code worked out from the contents of a record.
 * Same contents, same code. It is what turns "the right number came back"
 * into "the same things came back", and it is explained on screen every time
 * it appears, because nobody should need to know what a checksum is.
 */

const PROTOTYPES = [
  { key: 'transcript', label: 'The transcript' },
  { key: 'witness', label: 'The witnesses' },
  { key: 'ledger', label: 'The ledger' },
] as const;

type Prototype = (typeof PROTOTYPES)[number]['key'];

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

/** Everything one drill wrote down, as a plain text file to keep or send on. */
function transcriptText(evidence: DrillEvidence): string {
  const { drill, steps, tables, records } = evidence;
  const lines: string[] = [
    'PareCare practice emergency',
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
  lines.push('', 'Counted, kind by kind');
  for (const t of tables) {
    lines.push(
      `  ${t.kind}: ${t.rows_before} before, ${t.rows_after_destroy} after destroying, ${t.rows_restored} back` +
        ` (fingerprint ${shortCode(t.fingerprint_before)} then ${shortCode(t.fingerprint_after)})`
    );
  }
  if (records.length > 0) {
    lines.push('', 'Records followed individually');
    for (const r of records) {
      lines.push(
        `  ${r.kind}: ${r.label}${r.owner_label ? `, ${r.owner_label}` : ''}: ` +
          `${r.present_after_destroy ? 'survived being destroyed' : 'destroyed'}, ` +
          `${recordProved(r) ? 'came back identical' : 'did not come back identical'}`
      );
    }
  }
  return lines.join('\n');
}

function downloadTranscript(evidence: DrillEvidence): void {
  const blob = new Blob([transcriptText(evidence)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `parecare-practice-${new Date(evidence.drill.started_at).toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------------ */
/* Prototype one: the transcript                                            */
/* ------------------------------------------------------------------------ */

/**
 * What happened, in order, with the clock running. The appeal of this one is
 * that it reads like somebody standing next to you narrating it: nothing is
 * summarised, and the destroying step is right there in the middle with its
 * own timestamp.
 */
function Transcript({ evidence }: { evidence: DrillEvidence }) {
  const { steps } = evidence;
  if (steps.length === 0) {
    return <p className="text-sm text-muted">This practice run did not get far enough to write anything down.</p>;
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
        <Button variant="secondary" size="sm" onClick={() => downloadTranscript(evidence)}>
          Save this as a file
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Prototype two: the witnesses                                             */
/* ------------------------------------------------------------------------ */

/**
 * Real records, named, followed through all three moments. This is the one
 * that answers the question people are actually asking, which is not "did the
 * counts match" but "would my mother's medication list come back".
 */
function Witnesses({ evidence }: { evidence: DrillEvidence }) {
  const { records } = evidence;
  if (records.length === 0) {
    return <p className="text-sm text-muted">There were no records to follow in this practice run.</p>;
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
        These are real records out of the copy. Each one was found by name, watched while everything was deleted, and
        looked for again afterwards.
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

        <Column title="After everything was destroyed" caption="Looked for again, one by one.">
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

        <Column title="After it was put back" caption="Found again, and compared field by field.">
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
          ? `All ${records.length} were really gone, and all ${records.length} came back exactly as they were.`
          : 'Some of these did not come back as they were, so this copy cannot be relied on yet.'}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Prototype three: the ledger                                              */
/* ------------------------------------------------------------------------ */

/**
 * Every kind of record, counted at all three moments and fingerprinted at
 * two. The appeal of this one is that it is complete: nothing is a sample,
 * and every column can be sorted, so an odd row is easy to find.
 */
function Ledger({ evidence }: { evidence: DrillEvidence }) {
  const rows = evidence.tables;
  const view = useDataView<DrillTable>({
    rows,
    getId: (t) => t.id,
    sorts: useMemo(
      () => [
        { key: 'kind', label: 'Kind', compare: (a: DrillTable, b: DrillTable) => a.kind.localeCompare(b.kind) },
        { key: 'before', label: 'Before', defaultDir: 'desc' as const, compare: (a: DrillTable, b: DrillTable) => a.rows_before - b.rows_before },
        {
          key: 'destroyed',
          label: 'After destroying',
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
    return <p className="text-sm text-muted">This practice run did not get as far as counting anything.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <SortableTh label="Kind of record" sortKey="kind" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
              <SortableTh label="Before" sortKey="before" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
              <SortableTh label="After destroying" sortKey="destroyed" activeKey={view.sortKey} dir={view.sortDir} onToggle={view.toggleSort} />
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
        The middle column is the one that matters: it is zero because everything really was deleted. {FINGERPRINT_NOTE}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The three prototypes together, with a chooser across the top.
 *
 * The chooser is temporary. Three ways of saying the same thing is two too
 * many, and the point of showing them at once is to pick the one that
 * actually lands and delete the others.
 */
export function DrillProof({ evidence }: { evidence: DrillEvidence }) {
  const [shown, setShown] = useState<Prototype>('witness');

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">What the practice run did</h3>
        <span className="text-sm text-muted">
          {new Date(evidence.drill.started_at).toLocaleString()}
          {evidence.drill.status === 'passed' ? ' · everything came back' : ' · did not pass'}
        </span>
      </div>

      {/* A segmented view switch, the same control as cards and table
          elsewhere: it changes what is shown, not what is true. */}
      <div className="mt-3 flex w-fit items-center gap-1 rounded-md bg-surface-2 p-0.5">
        {PROTOTYPES.map((p) => (
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
        {shown === 'transcript' ? <Transcript evidence={evidence} /> : null}
        {shown === 'witness' ? <Witnesses evidence={evidence} /> : null}
        {shown === 'ledger' ? <Ledger evidence={evidence} /> : null}
      </div>
    </div>
  );
}
