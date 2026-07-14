import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
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
} from '../../../lib/care';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-red-50 text-red-700',
  monitoring: 'bg-amber-50 text-amber-700',
  resolving: 'bg-blue-50 text-blue-700',
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
  escalation_notes: string;
  region: string;
}

const emptyForm = (): StatusFormData => ({
  name: '',
  category: 'acute_illness',
  status: 'active',
  onset_date: new Date().toISOString().slice(0, 10),
  expected_resolution_date: '',
  actual_resolution_date: '',
  is_contagious: false,
  isolation_required: false,
  escalation_notes: '',
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
  escalation_notes: hs.escalation_notes ?? '',
  region: hs.region ?? '',
});

const SELECT = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

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
        escalation_notes: form.escalation_notes || null,
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
        <Textarea label="Escalation notes" value={form.escalation_notes} onChange={(e) => set('escalation_notes', e.target.value)} rows={2} hint="When to seek further medical attention" />

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
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/health-statuses/${statusId}/symptoms`, {
        name: name.trim(),
        severity,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      setName('');
      setSeverity(3);
      setNotes('');
      onSaved();
    },
  });

  return (
    <form
      className="flex flex-wrap items-end gap-2 mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) mutation.mutate();
      }}
    >
      <div className="flex-1 min-w-[10rem]">
        <Input label="Symptom" placeholder="e.g. Fever" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="w-28">
        <label className="block text-sm font-medium text-ink mb-1">Severity</label>
        <select className={SELECT} value={severity} onChange={(e) => setSeverity(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((v) => (
            <option key={v} value={v}>{v} - {SEVERITY_LABELS[v - 1]}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[10rem]">
        <Input label="Notes" placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button type="submit" size="sm" loading={mutation.isPending} disabled={!name.trim()}>Add symptom</Button>
    </form>
  );
}

function SymptomRow({
  symptom,
  profileId,
  statusId,
  onChanged,
}: {
  symptom: HealthStatusSymptom;
  profileId: string;
  statusId: string;
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
        Severity {symptom.severity}/5 - {SEVERITY_LABELS[symptom.severity - 1]}
      </span>
      <span className="text-xs text-muted ml-auto">
        {format(new Date(symptom.noted_at), 'd MMM yyyy')}
      </span>
      {symptom.notes ? <span className="text-xs text-muted italic">{symptom.notes}</span> : null}
      <button
        type="button"
        className="text-xs text-primary hover:underline"
        onClick={() => resolveMutation.mutate()}
      >
        {symptom.resolved_at ? 'Reopen' : 'Resolve'}
      </button>
      <button
        type="button"
        className="text-xs text-red-600 hover:underline"
        onClick={() => deleteMutation.mutate()}
      >
        Remove
      </button>
    </div>
  );
}

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
  const [expanded, setExpanded] = useState(false);
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
        <div className="text-xs font-medium text-amber-700 bg-amber-50 -mx-4 -mt-4 px-4 py-2 rounded-t-lg mb-3">
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
            {hs.is_contagious ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">Contagious</span> : null}
            {hs.isolation_required ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">Isolation</span> : null}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted">
            <span>Onset: {format(new Date(hs.onset_date), 'd MMM yyyy')}</span>
            {hs.expected_resolution_date ? <span>Expected resolution: {format(new Date(hs.expected_resolution_date), 'd MMM yyyy')}</span> : null}
            {hs.actual_resolution_date ? <span>Resolved: {format(new Date(hs.actual_resolution_date), 'd MMM yyyy')}</span> : null}
            {hs.region ? <span>Region: {hs.region}</span> : null}
          </div>

          {hs.escalation_notes ? (
            <p className="text-xs text-muted mt-1 italic">{hs.escalation_notes}</p>
          ) : null}

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
            {expanded ? 'Hide' : 'Symptoms'} ({hs.symptoms.length})
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
        <div className="mt-3 border-t border-border pt-3">
          {hs.symptoms.length === 0 ? (
            <p className="text-xs text-muted">No symptoms recorded.</p>
          ) : (
            hs.symptoms.map((sym) => (
              <SymptomRow
                key={sym.id}
                symptom={sym}
                profileId={profileId}
                statusId={hs.id}
                onChanged={onChanged}
              />
            ))
          )}
          {canEdit ? (
            <SymptomForm profileId={profileId} statusId={hs.id} onSaved={onChanged} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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
          <p className="text-sm text-muted">Acute illnesses, post-operative recovery, and short-term health events.</p>
        </div>
        {canEdit ? (
          <Button onClick={() => { setEditing(null); setModalOpen(true); }}>Add</Button>
        ) : null}
      </div>

      {flaggedCount > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
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
