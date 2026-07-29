import { Button } from '../ui/Button';
import type { DrillEvidence, DrillRecord } from '../../api/backups';

/**
 * What a restore test did.
 *
 * Named records at three points: found in the copy, gone after everything was
 * deleted, back afterwards with every field identical. A person reading this
 * is checking whether their own records would survive, and the only thing
 * that answers that is their own records, by name.
 *
 * Everything else the test recorded, every step with its timing and every
 * kind of record counted and fingerprinted, is still kept and still in the
 * saved file. It is not on the screen because it describes what the machine
 * did rather than what happened to the records.
 */

/** A record came back as it was: gone in the middle, identical at the end. */
function recordCameBack(r: DrillRecord): boolean {
  return !r.present_after_destroy && !!r.fingerprint_after && r.fingerprint_after === r.fingerprint_before;
}

function timeText(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function secondsText(seconds: string | number | null): string {
  if (seconds == null) return '';
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '';
  return n < 1 ? 'under a second' : `${n.toFixed(1)} seconds`;
}

function shortCode(code: string | null): string {
  return code ? code.slice(0, 8) : 'none';
}

function countText(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Document files are counted apart from records, so they are totalled apart. */
function totals(evidence: DrillEvidence): { records: number; files: number; allBack: boolean } {
  let records = 0;
  let files = 0;
  let allBack = true;
  for (const t of evidence.tables) {
    if (t.table_name === 'files') files = t.rows_before;
    else records += t.rows_before;
    if (t.rows_restored !== t.rows_before || (t.fingerprint_before ?? '') !== (t.fingerprint_after ?? '')) {
      allBack = false;
    }
  }
  return { records, files, allBack };
}

/**
 * Everything the test wrote down, as a plain text file to keep or send on.
 * This is where the full step list and the per-kind counts live.
 */
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
  lines.push(
    '',
    'A fingerprint is a short code worked out from the contents. Same contents,',
    'same code, so two matching codes mean the records came back unchanged',
    'rather than merely came back in the right number.'
  );
  if (records.length > 0) {
    lines.push('', 'Records checked');
    for (const r of records) {
      lines.push(
        `  ${r.kind}: ${r.label}${r.owner_label ? `, ${r.owner_label}` : ''}: ` +
          `${r.present_after_destroy ? 'was still there after deleting' : 'deleted'}, ` +
          `${recordCameBack(r) ? 'came back identical' : 'did not come back identical'}`
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
  a.download = `parecare-restore-test-${new Date(evidence.drill.started_at).toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function Column({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <p className="mb-2 text-xs text-muted">{caption}</p>
      {children}
    </div>
  );
}

export function RestoreTestReport({ evidence }: { evidence: DrillEvidence }) {
  const { drill, records, steps } = evidence;
  const sums = totals(evidence);
  const lastStep = steps[steps.length - 1];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">What the test did</h3>
        <span className="text-xs text-muted">{new Date(drill.started_at).toLocaleString()}</span>
      </div>

      {records.length === 0 ? (
        // Nothing to show in columns, so say where it stopped rather than
        // leaving an empty panel with no explanation.
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          {drill.error ?? 'The test did not finish.'}
          {lastStep ? ` It stopped at: ${lastStep.title.toLowerCase()}.` : ''}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            These are real records out of the copy. Each one was found by name, looked for again after everything was
            deleted, and compared with how it was once it had been put back.
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
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
                    <p
                      className={`text-sm ${
                        r.present_after_destroy ? 'text-red-600 dark:text-red-400' : 'text-ink line-through'
                      }`}
                    >
                      {r.label}
                    </p>
                    <p className="text-xs text-muted">
                      {r.present_after_destroy ? 'still there, which it should not be' : 'gone'}
                    </p>
                  </li>
                ))}
              </ul>
            </Column>

            <Column title="After putting it back" caption="Found again, and compared field by field.">
              <ul className="space-y-2">
                {records.map((r) => (
                  <li key={`a-${r.id}`}>
                    <p className="text-sm text-ink">{r.label}</p>
                    <p className={`text-xs ${recordCameBack(r) ? 'text-muted' : 'text-red-600 dark:text-red-400'}`}>
                      {recordCameBack(r)
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

          {/* The columns are a handful of records out of everything. This line
              is what stops that reading as a spot check. */}
          <p className={`mt-3 text-sm ${sums.allBack ? 'text-ink' : 'text-red-600 dark:text-red-400'}`}>
            {sums.allBack
              ? `All ${countText(sums.records, 'record')} and ${countText(sums.files, 'document file')} came back with the same contents. These ${records.length} were checked one by one.`
              : 'Not everything came back as it was, so this copy cannot be relied on yet.'}
          </p>
        </>
      )}

      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => downloadReport(evidence)}>
          Save the full report
        </Button>
      </div>
    </div>
  );
}
