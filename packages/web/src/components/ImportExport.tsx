import { useRef, useState } from 'react';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

interface ImportSummary {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

interface ImportExportProps {
  /** Base API path, e.g. `/care-profiles/123/medications`. */
  basePath: string;
  /** Plural resource name for labels and filenames, e.g. "medications". */
  resource: string;
  /** Whether the current viewer may import (writes). Export is always allowed. */
  canImport: boolean;
  /** Refetch after a successful import. */
  onImported: () => void;
  /** Column headers for the downloadable blank template. */
  templateHeaders: string[];
  /** Optional example row shown in the template. */
  templateSample?: string[];
}

function download(filename: string, body: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Reusable import/export control. Drop it onto any resource that exposes
 * `GET {basePath}/export?format=` and `POST {basePath}/import`. Handles CSV
 * and JSON, a blank template download, and an import result summary.
 */
export function ImportExport({ basePath, resource, canImport, onImported, templateHeaders, templateSample }: ImportExportProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const stamp = new Date().toISOString().slice(0, 10);

  async function doExport(format: 'csv' | 'json') {
    setBusy(format);
    setError('');
    try {
      const blob = await api.blob(`${basePath}/export?format=${format}`);
      download(`${resource}-${stamp}.${format}`, blob, format === 'json' ? 'application/json' : 'text/csv');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  function downloadTemplate() {
    const rows = [templateHeaders.map(csvCell).join(',')];
    if (templateSample) rows.push(templateSample.map(csvCell).join(','));
    download(`${resource}-template.csv`, rows.join('\r\n'), 'text/csv');
  }

  async function onFile(file: File) {
    setImporting(true);
    setSummary(null);
    setError('');
    try {
      const text = await file.text();
      const format = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
      const res = await api.post<ImportSummary>(`${basePath}/import`, { format, data: text });
      setSummary(res);
      onImported();
    } catch (err) {
      // The API returns the failure detail (e.g. no valid rows) as an error.
      const anyErr = err as { message?: string; body?: ImportSummary };
      setError(anyErr.message ?? 'Import failed.');
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setOpen(true); setSummary(null); setError(''); }}>
        Import / export
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Import or export ${resource}`}>
        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-ink mb-1">Export</h3>
            <p className="text-xs text-muted mb-2">Download the current {resource} as a spreadsheet (CSV) or JSON.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" loading={busy === 'csv'} onClick={() => void doExport('csv')}>
                Export CSV
              </Button>
              <Button size="sm" variant="secondary" loading={busy === 'json'} onClick={() => void doExport('json')}>
                Export JSON
              </Button>
            </div>
          </section>

          {canImport ? (
            <section className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-ink mb-1">Import</h3>
              <p className="text-xs text-muted mb-2">
                Upload a CSV or JSON file. Column headers are matched flexibly, so exports from a pharmacy or
                spreadsheet usually import as-is. New rows are added; nothing is overwritten.
              </p>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:text-primary hover:file:bg-primary-100"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
                disabled={importing}
              />
              <Button size="xs" variant="ghost" className="mt-2" onClick={downloadTemplate}>
                Download a blank CSV template
              </Button>
              {importing ? <p className="mt-2 text-sm text-muted">Importing…</p> : null}
            </section>
          ) : null}

          {summary ? (
            <div className="rounded-md border border-border bg-surface p-3 text-sm">
              <p className="text-ink font-medium">
                Imported {summary.imported} {resource}
                {summary.skipped > 0 ? `, skipped ${summary.skipped}` : ''}.
              </p>
              {summary.errors.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 space-y-0.5 max-h-40 overflow-y-auto">
                  {summary.errors.slice(0, 20).map((e, i) => <li key={i}>{e.message}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
