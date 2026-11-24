import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { CrossIcon } from './ui/icons';
import { DocumentCategoryField } from './DocumentCategoryField';

interface ProposedAction { type: string; [k: string]: unknown }
interface IngestResult {
  document_id: string;
  text_found: boolean;
  summary: string;
  /** True when Pare itself needs attention (not set up, still getting ready, or a provider fault), so the message is shown as a problem rather than a neutral note. */
  needs_attention?: boolean;
  actions: ProposedAction[];
  parse_errors?: string[];
  /** A scan the AI service here cannot read: the pages need photographing. */
  scan?: boolean;
}

/**
 * Upload any document and let Pare read it, say what it is, and propose what to
 * file against this profile. Nothing is written until the proposals are
 * confirmed. Owner and admin, via the profile's edit right.
 */
const ACTION_TITLE: Record<string, string> = {
  file_document: 'Document', add_asset: 'Equipment', add_provider: 'Contact', add_medication: 'New medicine', add_treatment: 'Treatment', add_task: 'Task', log_event: 'Note',
  record_appointment_outcome: 'How an appointment went', update_medication: 'Change to a medicine', stop_medication: 'Stop a medicine',
  book_appointment: 'Appointment', add_condition: 'Condition', add_allergy: 'Allergy', record_cost: 'Cost',
  set_id_numbers: 'ID numbers', raise_question: 'Question to ask', answer_question: 'Answer to a question',
};
const humanize = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());
const inputClass = 'w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** The scalar fields of a proposed action, editable before filing. */
// Fields that point at a record rather than describe it; never shown for editing.
const HIDDEN_KEYS = new Set(['type', 'document_id', 'document']);
const FIELD_LABEL: Record<string, string> = {
  label: 'Name', appointment_title: 'Appointment', due_on: 'Do by', kind: 'Next step',
  issued_on: 'Date written', valid_until: 'Valid until', from_name: 'From', from_type: 'What they do', to_name: 'To', to_type: 'What they do',
  to_phone: 'Their phone', to_practice: 'Where they work', medication_name: 'Medicine', reason: 'Why it changed', changed_on: 'Changed on',
  stopped_on: 'Last day taken', stop_reason: 'Why it stopped', stop_notes: 'In their words', course_ends_on: 'Last day of the course',
  repeats_left: 'Repeats left on the script', starts_at: 'When', provider_name: 'Who with', with_phone: 'Their phone', with_type: 'What they do',
  severity: 'How bad', medicare_number: 'Medicare number', medicare_irn: 'Position on the card', medicare_valid_to: 'Valid to',
  ihi_number: 'Individual Healthcare Identifier', dva_number: 'DVA file number', dva_card_colour: 'DVA card colour', ndis_number: 'NDIS number',
  health_fund_name: 'Health fund', health_fund_member_number: 'Member number', my_aged_care_number: 'My Aged Care number',
};
/** Lists inside a proposal, each item shown as its own editable row. */
const LIST_LABEL: Record<string, string> = { next_steps: 'Next steps' };

function ActionCard({ profileId, action, onChange, onRemove }: { profileId: string; action: ProposedAction; onChange: (a: ProposedAction) => void; onRemove: () => void }) {
  const keys = Object.keys(action).filter((k) => !HIDDEN_KEYS.has(k) && (action[k] == null || ['string', 'number'].includes(typeof action[k])));
  // Lists of items, such as an outcome's next steps, so nothing is filed unseen.
  const listKeys = Object.keys(action).filter(
    (k) => !HIDDEN_KEYS.has(k) && Array.isArray(action[k]) && (action[k] as unknown[]).every((x) => x && typeof x === 'object')
  );
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{ACTION_TITLE[action.type] ?? action.type.replace(/_/g, ' ')}</span>
        <Button size="xs" variant="ghost-danger" aria-label={`Remove this ${ACTION_TITLE[action.type] ?? 'proposed'} item`} title="Remove" onClick={onRemove}><CrossIcon /></Button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {keys.map((k) => action.type === 'file_document' && k === 'category' ? (
          <DocumentCategoryField
            key={k}
            id={`ingest-category-${k}`}
            profileId={profileId}
            value={action[k] == null ? '' : String(action[k])}
            onChange={(v) => onChange({ ...action, [k]: v || null })}
          />
        ) : (
          <label key={k} className="block">
            <span className="block text-xs text-muted mb-0.5">{FIELD_LABEL[k] ?? humanize(k)}</span>
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
      {listKeys.map((lk) => {
        const items = action[lk] as Array<Record<string, unknown>>;
        const setItems = (next: Array<Record<string, unknown>>) => onChange({ ...action, [lk]: next });
        return (
          <div key={lk} className="mt-3">
            <span className="block text-xs text-muted mb-1">{LIST_LABEL[lk] ?? humanize(lk)}</span>
            {items.length === 0 ? <p className="text-xs text-muted">None.</p> : null}
            <ul className="space-y-2">
              {items.map((item, i) => (
                <li key={i} className="flex items-end gap-2 rounded-md border border-border p-2">
                  <div className="grid flex-1 gap-2 sm:grid-cols-3">
                    {Object.keys(item)
                      .filter((f) => item[f] == null || ['string', 'number'].includes(typeof item[f]))
                      .map((f) => (
                        <label key={f} className="block">
                          <span className="block text-xs text-muted mb-0.5">{FIELD_LABEL[f] ?? humanize(f)}</span>
                          <input
                            className={inputClass}
                            value={item[f] == null ? '' : String(item[f])}
                            onChange={(e) => {
                              const v = e.target.value;
                              setItems(items.map((x, j) => (j === i ? { ...x, [f]: v === '' ? null : v } : x)));
                            }}
                          />
                        </label>
                      ))}
                  </div>
                  <Button
                    size="xs"
                    variant="ghost-danger"
                    aria-label={`Remove this ${(LIST_LABEL[lk] ?? humanize(lk)).toLowerCase()} item`}
                    title="Remove"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                  >
                    <CrossIcon />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function IngestModal({
  profileId,
  onClose,
  initialFile,
  document,
  title,
}: {
  profileId: string;
  onClose: () => void;
  /** A file already chosen (a photo taken from the capture sheet); reading starts on its own. */
  initialFile?: File;
  /** A document already filed; Pare reads it straight away, with nothing uploaded again. */
  document?: { id: string; label: string };
  title?: string;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const [outcomes, setOutcomes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [filedOnly, setFiledOnly] = useState(false);
  // Read and File without reading always answer: a missing file is named.
  const needFile = () => setError('Choose a file first, then try again.');

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (document) {
        return api.post<IngestResult>(`/care-profiles/${profileId}/ingest/documents/${document.id}`, {});
      }
      const form = new FormData();
      form.append('file', file!);
      return api.upload<IngestResult>(`/care-profiles/${profileId}/ingest`, form);
    },
    onSuccess: (r) => { setResult(r); setActions(r.actions ?? []); setError(''); },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not read the file.'),
  });

  // Keep the file in documents without reading it, for Pare to read later.
  const fileOnlyMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      form.append('category', 'other');
      form.append('label', file!.name.replace(/\.[^.]+$/, '').slice(0, 255) || file!.name);
      return api.upload(`/care-profiles/${profileId}/documents`, form);
    },
    onSuccess: () => {
      setFiledOnly(true);
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not file the document.'),
  });

  // A photo handed in from the capture sheet, or a document already on file,
  // reads itself, so the person is not asked to choose a file they already gave.
  const started = useRef(false);
  useEffect(() => {
    if ((initialFile || document) && !started.current) {
      started.current = true;
      uploadMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile, document]);

  const applyMutation = useMutation({
    // Everything filed from the document is attached to it.
    mutationFn: () => api.post<{ outcomes: string[] }>(`/care-profiles/${profileId}/ingest/apply`, { actions, document_id: result?.document_id ?? null }),
    onSuccess: (r) => {
      setOutcomes(r.outcomes);
      for (const key of ['directory-assets', 'providers', 'medications', 'documents', 'document-categories', 'health-spend', 'reminders', 'appointments', 'conditions', 'allergies']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not file the changes.'),
  });

  return (
    <Modal open onClose={onClose} title={title ?? 'Upload and file with Pare'} wide>
      <div className="space-y-4">
        {filedOnly ? (
          <>
            <p className="text-sm font-medium text-ink">Filed in documents.</p>
            <p className="text-sm text-muted">
              Pare has not read it. Whenever you are ready, open Documents and choose Read with Pare beside it.
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        ) : !result ? (
          initialFile || document ? (
            <>
              <p className="text-sm text-muted">
                {document ? `Reading ${document.label} and working out what to file.` : 'Reading the photo and working out what to file.'}{' '}
                Check and edit everything before it is saved.
              </p>
              {uploadMutation.isPending ? <p className="text-sm text-muted">Reading…</p> : null}
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              {error ? (
                <div className="flex justify-end">
                  <Button variant="ghost" onClick={onClose}>Close</Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Upload a document, an invoice, a care plan or a business card. Pare reads it and proposes what to file into this
                person's record. Edit every detail before anything is saved. Not ready for that? File it without reading, and
                have Pare read it later from Documents.
              </p>
              <input
                type="file"
                className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button
                  variant="secondary"
                  loading={fileOnlyMutation.isPending}
                  onClick={() => (!file ? needFile() : uploadMutation.isPending ? undefined : fileOnlyMutation.mutate())}
                >
                  File without reading
                </Button>
                <Button
                  loading={uploadMutation.isPending}
                  onClick={() => (!file ? needFile() : fileOnlyMutation.isPending ? undefined : uploadMutation.mutate())}
                >
                  Read the document
                </Button>
              </div>
            </>
          )
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
            <p className={`text-sm whitespace-pre-line ${result.needs_attention || result.scan ? 'text-red-600' : 'text-ink'}`}>{result.summary}</p>
            {result.needs_attention ? null : actions.length > 0 ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Pare will file (check and edit before saving)</p>
                <div className="space-y-3 max-h-[26rem] overflow-y-auto">
                  {actions.map((a, i) => (
                    <ActionCard
                      key={i}
                      profileId={profileId}
                      action={a}
                      onChange={(next) => setActions((prev) => prev.map((x, j) => (j === i ? next : x)))}
                      onRemove={() => setActions((prev) => prev.filter((_, j) => j !== i))}
                    />
                  ))}
                </div>
              </>
            ) : result.scan ? (
              <p className="text-sm text-muted">The scan is kept in documents in the meantime.</p>
            ) : (
              <p className="text-sm text-muted">
                {document ? 'Nothing could be filed automatically. The document stays in documents.' : 'Nothing could be filed automatically. The file has been saved to documents.'}
              </p>
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
