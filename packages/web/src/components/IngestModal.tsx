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

/**
 * Upload any document and let Pare read it, say what it is, and propose what to
 * file against this profile. Nothing is written until the proposals are
 * confirmed. Owner and admin, via the profile's edit right.
 */
const ACTION_TITLE: Record<string, string> = {
  add_asset: 'Asset', add_provider: 'Provider', add_medication: 'Medication', add_treatment: 'Treatment', add_task: 'Task', log_event: 'Note',
};
const humanize = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());
const inputClass = 'w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** The scalar fields of a proposed action, editable before filing. */
function ActionCard({ action, onChange, onRemove }: { action: ProposedAction; onChange: (a: ProposedAction) => void; onRemove: () => void }) {
  const keys = Object.keys(action).filter((k) => k !== 'type' && (action[k] == null || ['string', 'number'].includes(typeof action[k])));
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{ACTION_TITLE[action.type] ?? action.type.replace(/_/g, ' ')}</span>
        <button type="button" className="text-xs text-muted hover:text-red-600" onClick={onRemove}>Remove</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {keys.map((k) => (
          <label key={k} className="block">
            <span className="block text-xs text-muted mb-0.5">{humanize(k)}</span>
            <input
              className={inputClass}
              value={action[k] == null ? '' : String(action[k])}
              onChange={(e) => {
                const v = e.target.value;
                const next = typeof action[k] === 'number' ? (v.trim() === '' ? null : Number(v)) : (v === '' ? null : v);
                onChange({ ...action, [k]: next });
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function IngestModal({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const [outcomes, setOutcomes] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  const uploadMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      return api.upload<IngestResult>(`/care-profiles/${profileId}/ingest`, form);
    },
    onSuccess: (r) => { setResult(r); setActions(r.actions ?? []); setError(''); },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not read the file.'),
  });

  const applyMutation = useMutation({
    mutationFn: () => api.post<{ outcomes: string[] }>(`/care-profiles/${profileId}/ingest/apply`, { actions }),
    onSuccess: (r) => {
      setOutcomes(r.outcomes);
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
              person's record. You can edit every detail before anything is saved.
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
            {actions.length > 0 ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Pare will file (check and edit before saving)</p>
                <div className="space-y-3 max-h-[26rem] overflow-y-auto">
                  {actions.map((a, i) => (
                    <ActionCard
                      key={i}
                      action={a}
                      onChange={(next) => setActions((prev) => prev.map((x, j) => (j === i ? next : x)))}
                      onRemove={() => setActions((prev) => prev.filter((_, j) => j !== i))}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">Nothing could be filed automatically. The file has been saved to documents.</p>
            )}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              {actions.length > 0 ? (
                <Button loading={applyMutation.isPending} onClick={() => applyMutation.mutate()}>File these</Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
