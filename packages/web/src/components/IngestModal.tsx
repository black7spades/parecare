import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

interface ProposedAction { type: string; [k: string]: unknown }
interface IngestResult {
  document_id: string;
  text_found: boolean;
  summary: string;
  actions: ProposedAction[];
  parse_errors?: string[];
}

/** A short, readable line describing what an action will do, for the review. */
function describe(a: ProposedAction): string {
  const s = (k: string) => (a[k] == null || a[k] === '' ? '' : String(a[k]));
  const bits = (arr: [string, string][]) => arr.filter(([, v]) => v).map(([label, v]) => `${label} ${v}`).join(', ');
  switch (a.type) {
    case 'add_asset':
      return `Add asset: ${s('name')}` + (bits([['·', s('make_model')], ['serial', s('serial_number')], ['paid', s('price')], ['bought', s('purchase_date')], ['from', s('supplier')], ['warranty to', s('warranty_expiry')]]) ? ` (${bits([['', s('make_model')], ['serial', s('serial_number')], ['paid', s('price')], ['bought', s('purchase_date')], ['from', s('supplier')], ['warranty to', s('warranty_expiry')]])})` : '');
    case 'add_provider':
      return `Add provider: ${s('name')}${s('organisation') ? ` (${s('organisation')})` : ''}`;
    case 'add_medication':
      return `Add medication: ${s('medication_name')}${s('dose') ? ` ${s('dose')}` : ''}`;
    case 'add_treatment':
      return `Add treatment: ${s('name')}`;
    default:
      return `${a.type.replace(/_/g, ' ')}: ${s('name') || s('title') || s('medication_name') || ''}`;
  }
}

/**
 * Upload any document and let Pare read it, say what it is, and propose what to
 * file against this profile. Nothing is written until the proposals are
 * confirmed. Owner and admin, via the profile's edit right.
 */
export function IngestModal({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [outcomes, setOutcomes] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  const uploadMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      return api.upload<IngestResult>(`/care-profiles/${profileId}/ingest`, form);
    },
    onSuccess: (r) => { setResult(r); setError(''); },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not read the file.'),
  });

  const applyMutation = useMutation({
    mutationFn: () => api.post<{ outcomes: string[] }>(`/care-profiles/${profileId}/ingest/apply`, { actions: result!.actions }),
    onSuccess: (r) => {
      setOutcomes(r.outcomes);
      // The filed records could touch several lists; refresh broadly.
      for (const key of ['directory-assets', 'providers', 'medications', 'documents', 'health-spend']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not file the changes.'),
  });

  return (
    <Modal open onClose={onClose} title="Upload and file with Pare" wide>
      <div className="space-y-4">
        {!result ? (
          <>
            <p className="text-sm text-muted">
              Upload a document, an invoice, a care plan or a business card. Pare reads it and proposes what to file into this
              person's record. Nothing is saved until you confirm.
            </p>
            <input
              type="file"
              className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button loading={uploadMutation.isPending} disabled={!file} onClick={() => uploadMutation.mutate()}>Read the document</Button>
            </div>
          </>
        ) : outcomes ? (
          <>
            <p className="text-sm font-medium text-ink">Filed.</p>
            <ul className="list-disc pl-5 text-sm text-ink space-y-1">
              {outcomes.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink">{result.summary}</p>
            {result.actions.length > 0 ? (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Pare will file</p>
                <ul className="space-y-1 text-sm text-ink">
                  {result.actions.map((a, i) => <li key={i}>· {describe(a)}</li>)}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted">Nothing could be filed automatically. The file has been saved to documents.</p>
            )}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              {result.actions.length > 0 ? (
                <Button loading={applyMutation.isPending} onClick={() => applyMutation.mutate()}>File these</Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
