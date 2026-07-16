import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { CatalogueCombo } from '../../../components/CatalogueCombo';
import { useProfile } from './ProfileLayout';
import {
  CONDITION_SEVERITIES,
  DIAGNOSIS_STATUSES,
  NEUROTYPE_LABELS,
  diagnosisStatusLabel,
  neurotypeLabelText,
  type CareDocument,
  type MedicalCondition,
  type Provider,
} from '../../../lib/care';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function NeurotypePage() {
  const { profile, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<MedicalCondition | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['conditions', profile.id],
    queryFn: () =>
      api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profile.id}/conditions`),
  });
  const neurotypes = (data?.conditions ?? []).filter((c) => c.category === 'neurotype');
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profile.id] });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/conditions/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Neurotypes</h1>
          <p className="text-sm text-muted mt-1">
            Neurodivergent profiles such as autism, ADHD, dyslexia and others. These are lifelong from birth.
          </p>
        </div>
        {canEdit ? (
          <Button onClick={() => setAddOpen(true)}>Add neurotype</Button>
        ) : null}
      </div>

      {neurotypes.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm text-muted">No neurotypes recorded yet.</p>
          {canEdit ? (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAddOpen(true)}>
              Add neurotype
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {neurotypes.map((n) => (
            <NeurotypeCard
              key={n.id}
              condition={n}
              canEdit={canEdit}
              onEdit={() => setEditing(n)}
              onDelete={() => deleteMutation.mutate(n.id)}
            />
          ))}
        </div>
      )}

      {(addOpen || editing) ? (
        <NeurotypeEditor
          profileId={profile.id}
          condition={editing}
          onClose={() => { setAddOpen(false); setEditing(null); }}
          onSaved={() => {
            setAddOpen(false);
            setEditing(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function NeurotypeCard({
  condition,
  canEdit,
  onEdit,
  onDelete,
}: {
  condition: MedicalCondition;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-ink">{condition.name}</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm">
            {condition.neurotype ? (
              <div>
                <span className="text-muted">Type: </span>
                <span className="text-ink">{neurotypeLabelText(condition.neurotype)}</span>
              </div>
            ) : null}
            {condition.diagnosis_status ? (
              <div>
                <span className="text-muted">Status: </span>
                <span className="text-ink">{diagnosisStatusLabel(condition.diagnosis_status)}</span>
              </div>
            ) : null}
            {condition.diagnosis_date ? (
              <div>
                <span className="text-muted">Diagnosed: </span>
                <span className="text-ink">{format(new Date(condition.diagnosis_date), 'd MMM yyyy')}</span>
              </div>
            ) : null}
            {condition.diagnosing_provider ? (
              <div>
                <span className="text-muted">By: </span>
                <span className="text-ink">{condition.diagnosing_provider}</span>
              </div>
            ) : null}
            {condition.severity ? (
              <div>
                <span className="text-muted">Severity: </span>
                <span className="text-ink capitalize">{condition.severity}</span>
              </div>
            ) : null}
          </div>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="xs" variant="ghost" onClick={onEdit}>Edit</Button>
            <Button size="xs" variant="ghost-danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </div>
        ) : null}
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${condition.name}`}>
        <p className="text-sm text-muted mb-4">
          This removes the neurotype record. Any uploaded diagnosis documents remain in Documents.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { setConfirmDelete(false); onDelete(); }}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}

function NeurotypeEditor({
  profileId,
  condition,
  onClose,
  onSaved,
}: {
  profileId: string;
  condition: MedicalCondition | null;
  onClose: () => void;
  onSaved: (saved: MedicalCondition) => void;
}) {
  const isNew = condition === null;
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(condition?.name ?? '');
  const [neurotype, setNeurotype] = useState(condition?.neurotype ?? '');
  const [diagnosisStatus, setDiagnosisStatus] = useState(condition?.diagnosis_status ?? '');
  const [diagnosisDate, setDiagnosisDate] = useState(condition?.diagnosis_date ?? '');
  const [severity, setSeverity] = useState(condition?.severity ?? '');
  const [error, setError] = useState('');

  // Provider: pick existing or add new
  const [diagnosingProvider, setDiagnosingProvider] = useState(condition?.diagnosing_provider ?? '');
  const [providerMode, setProviderMode] = useState<'existing' | 'new' | 'manual'>('manual');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [newProviderName, setNewProviderName] = useState('');

  const { data: providersData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
  });
  const providers = providersData?.providers ?? [];

  // Document: pick existing or upload new
  const [diagnosisDocId, setDiagnosisDocId] = useState(condition?.diagnosis_document_id ?? null);
  const [docMode, setDocMode] = useState<'existing' | 'upload'>('upload');
  const [diagnosisFile, setDiagnosisFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const { data: docsData } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
  });
  const docs = docsData?.documents ?? [];
  const existingDoc = diagnosisDocId ? docs.find((d) => d.id === diagnosisDocId) : null;

  const saveProviderMutation = useMutation({
    mutationFn: () =>
      api.post<{ provider: Provider }>(`/care-profiles/${profileId}/providers`, {
        name: newProviderName.trim(),
        provider_type: 'specialist',
      }),
    onSuccess: (res) => {
      setDiagnosingProvider(res.provider.name);
      setSelectedProviderId(res.provider.id);
      setProviderMode('existing');
      setNewProviderName('');
      void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save provider.'),
  });

  const uploadDoc = async (file: File): Promise<string> => {
    const form = new FormData();
    form.append('file', file);
    form.append('category', 'medical_record');
    form.append('label', `Diagnosis: ${name.trim() || 'Neurotype'}`);
    const doc = await api.upload<{ document: CareDocument }>(`/care-profiles/${profileId}/documents`, form);
    void queryClient.invalidateQueries({ queryKey: ['documents', profileId] });
    return doc.document.id;
  };

  const extractFromDocument = async (docId: string) => {
    setExtracting(true);
    try {
      const res = await api.post<{
        extracted: {
          name?: string;
          neurotype?: string;
          diagnosis_date?: string;
          diagnosing_provider?: string;
          severity?: string;
        };
      }>(`/care-profiles/${profileId}/conditions/extract-from-document`, {
        document_id: docId,
        category: 'neurotype',
      });
      const e = res.extracted;
      if (e.name && !name) setName(e.name);
      if (e.neurotype && !neurotype) setNeurotype(e.neurotype);
      if (e.diagnosis_date && !diagnosisDate) setDiagnosisDate(e.diagnosis_date);
      if (e.diagnosing_provider && !diagnosingProvider) setDiagnosingProvider(e.diagnosing_provider);
      if (e.severity && !severity) setSeverity(e.severity);
      if (!diagnosisStatus) setDiagnosisStatus('formal');
    } catch {
      // Extraction is optional; if it fails, the user fills fields manually
    } finally {
      setExtracting(false);
    }
  };

  const handleDocUploadAndExtract = async (file: File) => {
    setUploading(true);
    try {
      const docId = await uploadDoc(file);
      setDiagnosisDocId(docId);
      setDiagnosisFile(null);
      await extractFromDocument(docId);
    } finally {
      setUploading(false);
    }
  };

  const handleExistingDocPick = async (docId: string) => {
    setDiagnosisDocId(docId);
    await extractFromDocument(docId);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      let finalDocId = diagnosisDocId;

      // If there's a pending file upload for a new condition, upload first
      if (diagnosisFile && !finalDocId) {
        setUploading(true);
        try {
          finalDocId = await uploadDoc(diagnosisFile);
          setDiagnosisDocId(finalDocId);
          setDiagnosisFile(null);
        } finally {
          setUploading(false);
        }
      }

      const body = {
        name: name.trim(),
        category: 'neurotype' as const,
        neurotype: neurotype || null,
        diagnosis_status: diagnosisStatus || null,
        diagnosis_date: diagnosisDate || null,
        diagnosing_provider: diagnosingProvider.trim() || null,
        diagnosis_document_id: finalDocId,
        severity: severity || null,
        expected_duration: 'lifelong' as const,
        condition_type: 'disability' as const,
        is_temporary: false,
        status: 'active' as const,
      };

      return isNew
        ? api.post<{ condition: MedicalCondition }>(`/care-profiles/${profileId}/conditions`, body)
        : api.patch<{ condition: MedicalCondition }>(
            `/care-profiles/${profileId}/conditions/${condition.id}`,
            body
          );
    },
    onSuccess: (res) => onSaved(res.condition),
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save.'),
  });

  const pillClass = (active: boolean) =>
    active
      ? 'px-3 py-1 text-xs rounded-full bg-card text-ink font-medium shadow-sm'
      : 'px-3 py-1 text-xs rounded-full text-muted hover:text-ink cursor-pointer';

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add neurotype' : `Edit ${condition.name}`} wide>
      <div className="space-y-4">
        {/* Name */}
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Condition name</span>
          <CatalogueCombo
            endpoint="/condition-catalogue"
            ariaLabel="Condition name"
            placeholder="e.g. Autism, ADHD, Dyslexia"
            initial={name}
            keepValue
            onPick={setName}
            widthClass="w-full"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {/* Neurotype label */}
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Neurotype</span>
            <select className={inputClass} value={neurotype} onChange={(e) => setNeurotype(e.target.value)}>
              <option value="">Select</option>
              {NEUROTYPE_LABELS.map((n) => (
                <option key={n.value} value={n.value}>{n.label}</option>
              ))}
            </select>
          </label>

          {/* Diagnosis status */}
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Diagnosis status</span>
            <select className={inputClass} value={diagnosisStatus} onChange={(e) => setDiagnosisStatus(e.target.value)}>
              <option value="">Not set</option>
              {DIAGNOSIS_STATUSES.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </label>

          {/* Diagnosis date */}
          <Input
            label="Diagnosis date"
            type="date"
            value={diagnosisDate}
            onChange={(e) => setDiagnosisDate(e.target.value)}
          />

          {/* Severity */}
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Severity</span>
            <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Not set</option>
              {CONDITION_SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Diagnosing provider */}
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Diagnosing clinician</span>
          <div className="flex items-center gap-1 rounded-full bg-surface-2 p-0.5 mb-2 w-fit">
            <button type="button" className={pillClass(providerMode === 'manual')} onClick={() => setProviderMode('manual')}>
              Type name
            </button>
            <button type="button" className={pillClass(providerMode === 'existing')} onClick={() => setProviderMode('existing')}>
              Choose provider
            </button>
            <button type="button" className={pillClass(providerMode === 'new')} onClick={() => setProviderMode('new')}>
              Add provider
            </button>
          </div>
          {providerMode === 'manual' ? (
            <Input
              aria-label="Diagnosing clinician name"
              value={diagnosingProvider}
              onChange={(e) => setDiagnosingProvider(e.target.value)}
              placeholder="Name of the clinician or practice"
            />
          ) : providerMode === 'existing' ? (
            <div className="space-y-2">
              <select
                className={inputClass}
                value={selectedProviderId}
                onChange={(e) => {
                  setSelectedProviderId(e.target.value);
                  const p = providers.find((pr) => pr.id === e.target.value);
                  if (p) setDiagnosingProvider(p.name);
                }}
              >
                <option value="">Choose a provider</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {providers.length === 0 ? (
                <p className="text-xs text-muted">No providers recorded yet. Switch to "Add provider" to create one.</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    aria-label="New provider name"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    placeholder="e.g. Dr Smith, Neurodevelopment Clinic"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={!newProviderName.trim()}
                  loading={saveProviderMutation.isPending}
                  onClick={() => saveProviderMutation.mutate()}
                >
                  Save to Providers
                </Button>
              </div>
              <p className="text-xs text-muted">This adds them to the Providers list so they can be reused across the profile.</p>
            </div>
          )}
        </div>

        {/* Diagnosis document */}
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Formal diagnosis document</span>
          {existingDoc ? (
            <div className="flex items-center gap-3 text-sm rounded-md border border-border bg-surface-2 px-3 py-2">
              <span className="text-ink flex-1 min-w-0 truncate">{existingDoc.label}</span>
              {existingDoc.file_size_bytes ? (
                <span className="text-xs text-muted">{(existingDoc.file_size_bytes / 1024).toFixed(0)} KB</span>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setDiagnosisDocId(null)}
              >
                Remove
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 rounded-full bg-surface-2 p-0.5 mb-2 w-fit">
                <button type="button" className={pillClass(docMode === 'upload')} onClick={() => setDocMode('upload')}>
                  Upload new
                </button>
                <button type="button" className={pillClass(docMode === 'existing')} onClick={() => setDocMode('existing')}>
                  Choose from Documents
                </button>
              </div>
              {docMode === 'upload' ? (
                <div className="flex items-center gap-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    className="text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-surface-2"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setDiagnosisFile(f);
                      if (f) handleDocUploadAndExtract(f);
                    }}
                  />
                  {(uploading || extracting) ? (
                    <span className="text-xs text-muted">
                      {uploading ? 'Uploading...' : 'Reading document...'}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  {docs.length === 0 ? (
                    <p className="text-sm text-muted">No documents uploaded yet. Switch to "Upload new" to add one.</p>
                  ) : (
                    <select
                      className={inputClass}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleExistingDocPick(e.target.value);
                      }}
                    >
                      <option value="">Choose a document</option>
                      {docs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                          {d.file_size_bytes ? ` (${(d.file_size_bytes / 1024).toFixed(0)} KB)` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </>
          )}
          <p className="text-xs text-muted mt-1">
            Upload or choose a formal diagnosis report. PareCare will try to read the document and fill in the details automatically.
          </p>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={saveMutation.isPending || uploading}
            disabled={!name.trim()}
            onClick={() => saveMutation.mutate()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
