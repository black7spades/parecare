import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useProfile } from './ProfileLayout';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import {
  HEALTH_STATUS_CATEGORIES,
  HEALTH_STATUS_STATUSES,
  healthStatusCategoryLabel,
  healthStatusStatusLabel,
  type HealthStatus,
  type HealthStatusSymptom,
  type HealthStatusDocument,
  type Provider,
  type CareDocument,
} from '../../../lib/care';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300',
  monitoring: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  resolving: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
  resolved: 'bg-primary-50 text-primary',
};

const SEVERITY_LABELS = ['Mild', 'Low', 'Moderate', 'High', 'Severe'] as const;

const byOnset = (a: HealthStatus, b: HealthStatus) =>
  new Date(b.onset_date).getTime() - new Date(a.onset_date).getTime();
const byName = (a: HealthStatus, b: HealthStatus) => a.name.localeCompare(b.name);

const SORTS: DataSort<HealthStatus>[] = [
  { key: 'onset', label: 'By onset date', compare: byOnset },
  { key: 'name', label: 'By name (A-Z)', compare: byName },
  { key: 'status', label: 'Active first', compare: (a, b) => {
    const order = ['active', 'monitoring', 'resolving', 'resolved'];
    return (order.indexOf(a.status) - order.indexOf(b.status)) || byOnset(a, b);
  }},
];

const FILTERS: DataFilter<HealthStatus>[] = [
  {
    key: 'category',
    label: 'Category',
    options: HEALTH_STATUS_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
    match: (row, value) => row.category === value,
  },
  {
    key: 'status',
    label: 'Status',
    options: HEALTH_STATUS_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    match: (row, value) => row.status === value,
  },
];

const FLAGGED_DAYS = 21;

function isFlagged(hs: HealthStatus): boolean {
  if (hs.status !== 'active' && hs.status !== 'monitoring') return false;
  const onset = new Date(hs.onset_date);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - FLAGGED_DAYS);
  return onset < threshold;
}

interface StatusFormData {
  name: string;
  category: string;
  status: string;
  onset_date: string;
  expected_resolution_date: string;
  actual_resolution_date: string;
  is_contagious: boolean;
  isolation_required: boolean;
  region: string;
}

const emptyForm = (): StatusFormData => ({
  name: '',
  category: 'illness',
  status: 'active',
  onset_date: new Date().toISOString().slice(0, 10),
  expected_resolution_date: '',
  actual_resolution_date: '',
  is_contagious: false,
  isolation_required: false,
  region: '',
});

const formFromStatus = (hs: HealthStatus): StatusFormData => ({
  name: hs.name,
  category: hs.category,
  status: hs.status,
  onset_date: hs.onset_date,
  expected_resolution_date: hs.expected_resolution_date ?? '',
  actual_resolution_date: hs.actual_resolution_date ?? '',
  is_contagious: hs.is_contagious,
  isolation_required: hs.isolation_required,
  region: hs.region ?? '',
});

const SELECT = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

// --- Symptom autocomplete from catalogue ---

function SymptomForm({
  profileId,
  statusId,
  onSaved,
}: {
  profileId: string;
  statusId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [severity, setSeverity] = useState(3);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data: suggestionData } = useQuery({
    queryKey: ['symptom-catalogue', name],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>(`/symptom-catalogue?search=${encodeURIComponent(name)}`),
    enabled: name.trim().length > 0,
  });
  const suggestions = (suggestionData?.items ?? []).slice(0, 8);
  const trimmed = name.trim();
  const exactMatch = suggestions.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  const options = [...suggestions.map((s) => s.name), ...(trimmed && !exactMatch ? [trimmed] : [])];

  useEffect(() => { setHighlight(0); }, [name]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const mutation = useMutation({
    mutationFn: (symptomName: string) =>
      api.post(`/care-profiles/${profileId}/health-statuses/${statusId}/symptoms`, {
        name: symptomName,
        severity,
      }),
    onSuccess: () => {
      setName('');
      setSeverity(3);
      setOpen(false);
      onSaved();
    },
  });

  const submit = (n: string) => {
    if (!n.trim() || mutation.isPending) return;
    mutation.mutate(n.trim());
  };

  return (
    <div className="flex flex-wrap items-end gap-2 mt-3">
      <div className="flex-1 min-w-[12rem] relative" ref={boxRef}>
        <label className="block text-sm font-medium text-ink mb-1">Symptom</label>
        <input
          type="text"
          role="combobox"
          aria-expanded={open && options.length > 0}
          placeholder="Type to search symptoms..."
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          value={name}
          onChange={(e) => { setName(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, options.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (options[highlight]) submit(options[highlight]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {open && options.length > 0 ? (
          <ul className="absolute left-0 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg z-20">
            {options.map((n, i) => {
              const isNew = i >= suggestions.length;
              return (
                <li key={`${n}-${isNew}`}>
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-1.5 text-sm ${i === highlight ? 'bg-primary-50 text-primary' : 'text-ink hover:bg-surface-2'}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => submit(n)}
                  >
                    {isNew ? <>Add &ldquo;{n}&rdquo; as a new symptom</> : n}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div className="w-28">
        <label className="block text-sm font-medium text-ink mb-1">Severity</label>
        <select className={SELECT} value={severity} onChange={(e) => setSeverity(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((v) => (
            <option key={v} value={v}>{v} - {SEVERITY_LABELS[v - 1]}</option>
          ))}
        </select>
      </div>
      <Button size="sm" loading={mutation.isPending} disabled={!name.trim()} onClick={() => submit(name)}>
        Add symptom
      </Button>
    </div>
  );
}

function SymptomRow({
  symptom,
  profileId,
  statusId,
  canEdit,
  onChanged,
}: {
  symptom: HealthStatusSymptom;
  profileId: string;
  statusId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const resolveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/health-statuses/${statusId}/symptoms/${symptom.id}`, {
        resolved_at: symptom.resolved_at ? null : new Date().toISOString(),
      }),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api.delete(`/care-profiles/${profileId}/health-statuses/${statusId}/symptoms/${symptom.id}`),
    onSuccess: onChanged,
  });

  return (
    <div className="flex items-center gap-3 py-1.5 text-sm border-b border-border last:border-0">
      <span className={`font-medium ${symptom.resolved_at ? 'line-through text-muted' : 'text-ink'}`}>
        {symptom.name}
      </span>
      <span className="text-xs text-muted">
        {symptom.severity}/5 {SEVERITY_LABELS[symptom.severity - 1]}
      </span>
      <span className="text-xs text-muted ml-auto">
        {format(new Date(symptom.noted_at), 'd MMM yyyy')}
      </span>
      {symptom.notes ? <span className="text-xs text-muted italic">{symptom.notes}</span> : null}
      {canEdit ? (
        <>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => resolveMutation.mutate()}>
            {symptom.resolved_at ? 'Reopen' : 'Resolve'}
          </button>
          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => deleteMutation.mutate()}>
            Remove
          </button>
        </>
      ) : null}
    </div>
  );
}

// --- Book Appointment section ---

function BookAppointment({ profileId }: { profileId: string }) {
  const { data } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
  });
  const providers = data?.providers ?? [];
  const bookable = providers.filter((p) => p.booking_link);
  const hasProviders = providers.length > 0;

  if (!hasProviders) {
    return (
      <div className="text-sm text-muted">
        No health care providers linked yet.{' '}
        <Link to="../providers" className="text-primary hover:underline">Add a provider</Link>{' '}
        to enable appointment booking.
      </div>
    );
  }

  if (bookable.length === 0) {
    return (
      <div className="text-sm text-muted">
        No providers have a booking link.{' '}
        <Link to="../providers" className="text-primary hover:underline">Edit a provider</Link>{' '}
        and add their booking URL.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {bookable.map((p) => (
        <a
          key={p.id}
          href={p.booking_link!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-ink hover:bg-primary-50 hover:border-primary hover:text-primary transition-colors"
        >
          <span className="font-medium">{p.name}</span>
          {p.organisation ? <span className="text-xs text-muted">{p.organisation}</span> : null}
        </a>
      ))}
    </div>
  );
}

// --- Document linking ---

function LinkedDocuments({
  profileId,
  statusId,
  documents,
  canEdit,
  onChanged,
}: {
  profileId: string;
  statusId: string;
  documents: HealthStatusDocument[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [linking, setLinking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: allDocsData } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
    enabled: linking,
  });
  const allDocs = allDocsData?.documents ?? [];
  const linkedIds = new Set(documents.map((d) => d.id));
  const unlinkable = allDocs.filter((d) => !linkedIds.has(d.id));

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setUploading(true);
      const form = new FormData();
      form.append('file', file);
      form.append('category', 'medical_record');
      form.append('label', file.name.replace(/\.[^.]+$/, ''));
      const doc = await api.upload<{ document: CareDocument }>(`/care-profiles/${profileId}/documents`, form);
      await api.post(`/care-profiles/${profileId}/health-statuses/${statusId}/documents`, {
        document_id: doc.document.id,
      });
    },
    onSuccess: () => {
      setUploading(false);
      void queryClient.invalidateQueries({ queryKey: ['documents', profileId] });
      onChanged();
    },
    onError: () => setUploading(false),
  });

  const linkMutation = useMutation({
    mutationFn: (docId: string) =>
      api.post(`/care-profiles/${profileId}/health-statuses/${statusId}/documents`, { document_id: docId }),
    onSuccess: () => { setLinking(false); onChanged(); },
  });

  const unlinkMutation = useMutation({
    mutationFn: (docId: string) =>
      api.delete(`/care-profiles/${profileId}/health-statuses/${statusId}/documents/${docId}`),
    onSuccess: onChanged,
  });

  return (
    <div>
      {documents.length > 0 ? (
        <div className="space-y-1">
          {documents.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm">
              <span className="text-ink">{d.label}</span>
              <span className="text-xs text-muted">{d.mime_type}</span>
              {d.file_size_bytes ? <span className="text-xs text-muted">{(d.file_size_bytes / 1024).toFixed(0)} KB</span> : null}
              <Link to="../documents" className="text-xs text-primary hover:underline ml-auto">
                View in Documents
              </Link>
              {canEdit ? (
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => unlinkMutation.mutate(d.id)}>
                  Unlink
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No documents attached.</p>
      )}

      {canEdit ? (
        <div className="flex flex-wrap gap-2 mt-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.heic"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadMutation.mutate(f);
              e.target.value = '';
            }}
          />
          <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
            Upload document
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setLinking(!linking)}>
            {linking ? 'Cancel' : 'Link existing'}
          </Button>
        </div>
      ) : null}

      {linking && unlinkable.length > 0 ? (
        <div className="mt-2 max-h-32 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {unlinkable.map((d) => (
            <button
              key={d.id}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm text-ink hover:bg-surface-2 flex items-center justify-between"
              onClick={() => linkMutation.mutate(d.id)}
            >
              <span>{d.label}</span>
              <span className="text-xs text-muted">{d.category}</span>
            </button>
          ))}
        </div>
      ) : linking && unlinkable.length === 0 ? (
        <p className="text-xs text-muted mt-2">No other documents available to link.</p>
      ) : null}
    </div>
  );
}

// --- Status form modal ---

function StatusFormModal({
  open,
  onClose,
  profileId,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  editing: HealthStatus | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<StatusFormData>(editing ? formFromStatus(editing) : emptyForm());
  const set = <K extends keyof StatusFormData>(k: K, v: StatusFormData[K]) => setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        expected_resolution_date: form.expected_resolution_date || null,
        actual_resolution_date: form.actual_resolution_date || null,
        region: form.region || null,
      };
      return editing
        ? api.patch(`/care-profiles/${profileId}/health-statuses/${editing.id}`, body)
        : api.post(`/care-profiles/${profileId}/health-statuses`, body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit health status' : 'Add health status'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Input label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} required />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Category</label>
            <select className={SELECT} value={form.category} onChange={(e) => set('category', e.target.value)}>
              {HEALTH_STATUS_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Status</label>
            <select className={SELECT} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {HEALTH_STATUS_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input label="Onset date" type="date" value={form.onset_date} onChange={(e) => set('onset_date', e.target.value)} required />
          <Input label="Expected resolution" type="date" value={form.expected_resolution_date} onChange={(e) => set('expected_resolution_date', e.target.value)} />
          <Input label="Actual resolution" type="date" value={form.actual_resolution_date} onChange={(e) => set('actual_resolution_date', e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_contagious} onChange={(e) => set('is_contagious', e.target.checked)} />
            Contagious
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isolation_required} onChange={(e) => set('isolation_required', e.target.checked)} />
            Isolation required
          </label>
        </div>

        <Input label="Body region" value={form.region} onChange={(e) => set('region', e.target.value)} hint="Where on the body, if applicable" />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!form.name.trim()}>
            {editing ? 'Save changes' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- Main status card ---

function StatusCard({
  hs,
  profileId,
  canEdit,
  onEdit,
  onDeleted,
  onChanged,
}: {
  hs: HealthStatus;
  profileId: string;
  canEdit: boolean;
  onEdit: () => void;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(hs.status === 'active');
  const flagged = isFlagged(hs);

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profileId}/health-statuses/${hs.id}`),
    onSuccess: onDeleted,
  });

  const migrateMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/health-statuses/${hs.id}/migrate`, {
        new_condition_name: hs.name,
      }),
    onSuccess: onChanged,
  });

  return (
    <div className={`card ${flagged ? 'ring-2 ring-amber-400' : ''}`}>
      {flagged ? (
        <div className="text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 -mx-4 -mt-4 px-4 py-2 rounded-t-lg mb-3">
          Active for more than {FLAGGED_DAYS} days. Consider migrating to a medical condition for ongoing tracking.
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-ink">{hs.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[hs.status] ?? 'bg-surface-2 text-muted'}`}>
              {healthStatusStatusLabel(hs.status)}
            </span>
            <span className="text-xs text-muted">{healthStatusCategoryLabel(hs.category)}</span>
            {hs.is_contagious ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 font-medium">Contagious</span> : null}
            {hs.isolation_required ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 font-medium">Isolation</span> : null}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted">
            <span>Onset: {format(new Date(hs.onset_date), 'd MMM yyyy')}</span>
            {hs.expected_resolution_date ? <span>Expected resolution: {format(new Date(hs.expected_resolution_date), 'd MMM yyyy')}</span> : null}
            {hs.actual_resolution_date ? <span>Resolved: {format(new Date(hs.actual_resolution_date), 'd MMM yyyy')}</span> : null}
            {hs.region ? <span>Region: {hs.region}</span> : null}
          </div>

          {hs.linked_condition_id ? (
            <p className="text-xs text-primary mt-1">Linked to a medical condition</p>
          ) : null}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          {canEdit ? (
            <>
              <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>
              {flagged && !hs.linked_condition_id ? (
                <Button size="sm" variant="secondary" onClick={() => migrateMutation.mutate()} loading={migrateMutation.isPending}>
                  Migrate to condition
                </Button>
              ) : null}
              <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate()} loading={deleteMutation.isPending}>
                Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 space-y-4">
          {/* Symptoms */}
          <div>
            <h4 className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">Symptoms</h4>
            {hs.symptoms.length === 0 ? (
              <p className="text-xs text-muted">No symptoms recorded yet.</p>
            ) : (
              hs.symptoms.map((sym) => (
                <SymptomRow
                  key={sym.id}
                  symptom={sym}
                  profileId={profileId}
                  statusId={hs.id}
                  canEdit={canEdit}
                  onChanged={onChanged}
                />
              ))
            )}
            {canEdit ? (
              <SymptomForm profileId={profileId} statusId={hs.id} onSaved={onChanged} />
            ) : null}
          </div>

          {/* Book appointment */}
          <div className="border-t border-border pt-3">
            <h4 className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">Book appointment</h4>
            <BookAppointment profileId={profileId} />
          </div>

          {/* Documents */}
          <div className="border-t border-border pt-3">
            <h4 className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">
              Documents
              <span className="font-normal text-muted ml-1">Medical certificates, test results, imaging</span>
            </h4>
            <LinkedDocuments
              profileId={profileId}
              statusId={hs.id}
              documents={hs.documents}
              canEdit={canEdit}
              onChanged={onChanged}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- Main page ---

export function HealthStatusPage() {
  const { profile, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<HealthStatus | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['health-statuses', profile.id],
    queryFn: () => api.get<{ health_statuses: HealthStatus[] }>(`/care-profiles/${profile.id}/health-statuses`),
  });
  const statuses = data?.health_statuses ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['health-statuses', profile.id] });

  const dv = useDataView({
    rows: statuses,
    getId: (r) => r.id,
    searchText: (r) => `${r.name} ${r.category} ${r.region ?? ''} ${r.symptoms.map((s) => s.name).join(' ')}`,
    sorts: SORTS,
    filters: FILTERS,
  });

  const flaggedCount = statuses.filter(isFlagged).length;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Health status</h1>
          <p className="text-sm text-muted">Track illnesses, injuries, recovery, and any health events that need monitoring.</p>
        </div>
        {canEdit ? (
          <Button onClick={() => { setEditing(null); setModalOpen(true); }}>Add</Button>
        ) : null}
      </div>

      {flaggedCount > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          {flaggedCount} {flaggedCount === 1 ? 'item has' : 'items have'} been active for more than {FLAGGED_DAYS} days.
          Consider migrating to a medical condition for long-term tracking.
        </div>
      ) : null}

      <DataToolbar
        search={dv.search}
        onSearch={dv.setSearch}
        searchPlaceholder="Search health statuses..."
        sorts={SORTS}
        sortKey={dv.sortKey}
        onSort={dv.setSortKey}
        filters={FILTERS}
        filterValues={dv.filterValues}
        onFilter={dv.setFilter}
      />

      {isLoading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : dv.view.length === 0 ? (
        <p className="text-sm text-muted">
          {statuses.length === 0
            ? 'No health statuses recorded yet.'
            : 'No results match your search.'}
        </p>
      ) : (
        <div className="space-y-3">
          {dv.view.map((hs) => (
            <StatusCard
              key={hs.id}
              hs={hs}
              profileId={profile.id}
              canEdit={canEdit}
              onEdit={() => { setEditing(hs); setModalOpen(true); }}
              onDeleted={invalidate}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}

      {modalOpen ? (
        <StatusFormModal
          open={modalOpen}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          profileId={profile.id}
          editing={editing}
          onSaved={invalidate}
        />
      ) : null}
    </div>
  );
}
