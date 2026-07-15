import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { CatalogueCombo } from '../../../components/CatalogueCombo';
import { useDataView, type DataFilter, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import {
  CODE_SYSTEMS,
  CONDITION_CATEGORIES,
  CONDITION_SEVERITIES,
  CONDITION_STATUSES,
  CONDITION_TYPES,
  EXPECTED_DURATIONS,
  FUNCTION_DOMAINS,
  LIMITATION_LEVELS,
  TEMPORAL_PATTERNS,
  TREATMENT_CATEGORIES,
  TREATMENT_STATUS_OPTIONS,
  codeSystemLabel,
  conditionCategoryLabel,
  conditionStatusLabel,
  conditionTypeLabel,
  functionDomainLabel,
  temporalPatternLabel,
  treatmentCategoryLabel,
  treatmentStatusLabel,
  type ConditionCode,
  type ConditionFunction,
  type ConditionSymptom,
  type MedicalCondition,
} from '../../../lib/care';
import { useProfile } from './ProfileLayout';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const fmtDate = (d: string | null | undefined) => (d ? format(new Date(d), 'd MMM yyyy') : '');

const SEVERITY_LABELS = ['Mild', 'Low', 'Moderate', 'High', 'Severe'] as const;

const SORTS: DataSort<MedicalCondition>[] = [
  { key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  {
    key: 'started',
    label: 'Started, newest first',
    compare: (a, b) => (b.started_on ?? '').localeCompare(a.started_on ?? ''),
  },
  {
    key: 'severity',
    label: 'Severity, worst first',
    compare: (a, b) =>
      CONDITION_SEVERITIES.findIndex((s) => s.value === b.severity) -
      CONDITION_SEVERITIES.findIndex((s) => s.value === a.severity),
  },
  {
    key: 'category',
    label: 'Category',
    compare: (a, b) => (a.category ?? '').localeCompare(b.category ?? ''),
  },
];

const CATEGORY_FILTER: DataFilter<MedicalCondition> = {
  key: 'category',
  label: 'Category',
  options: CONDITION_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
  match: (c, v) => c.category === v,
};

const TYPE_FILTER: DataFilter<MedicalCondition> = {
  key: 'condition_type',
  label: 'Type',
  options: CONDITION_TYPES.map((t) => ({ value: t.value, label: t.label })),
  match: (c, v) => c.condition_type === v,
};

const STATUS_FILTER: DataFilter<MedicalCondition> = {
  key: 'status',
  label: 'Status',
  options: CONDITION_STATUSES.map((s) => ({ value: s.value, label: s.label })),
  match: (c, v) => c.status === v,
};

type SortDir = 'asc' | 'desc';
type SortCol = 'name' | 'category' | 'condition_type' | 'severity' | 'status' | 'started_on';

export function ConditionsPage() {
  const { profile, careName, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MedicalCondition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MedicalCondition | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkEditQueue, setBulkEditQueue] = useState<MedicalCondition[]>([]);
  const [colSort, setColSort] = useState<{ col: SortCol; dir: SortDir }>({ col: 'name', dir: 'asc' });

  const { data, isLoading } = useQuery({
    queryKey: ['conditions', profile.id],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profile.id}/conditions`),
  });
  const conditions = data?.conditions ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profile.id] });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/conditions/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      invalidate();
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => api.delete(`/care-profiles/${profile.id}/conditions/${id}`))),
    onSuccess: () => {
      setConfirmBulkDelete(false);
      dv.clearSelection();
      invalidate();
    },
  });

  const headerSort: DataSort<MedicalCondition> = {
    key: `col-${colSort.col}-${colSort.dir}`,
    label: '',
    compare: (a, b) => {
      const valA = String(a[colSort.col] ?? '');
      const valB = String(b[colSort.col] ?? '');
      let cmp: number;
      if (colSort.col === 'severity') {
        cmp =
          CONDITION_SEVERITIES.findIndex((s) => s.value === a.severity) -
          CONDITION_SEVERITIES.findIndex((s) => s.value === b.severity);
      } else {
        cmp = valA.localeCompare(valB);
      }
      return colSort.dir === 'desc' ? -cmp : cmp;
    },
  };

  const dv = useDataView<MedicalCondition>({
    rows: conditions,
    getId: (c) => c.id,
    searchText: (c) =>
      [
        c.name,
        conditionTypeLabel(c.condition_type),
        conditionCategoryLabel(c.category),
        c.severity,
        conditionStatusLabel(c.status),
        ...(c.codes ?? []).map((code) => code.code),
        c.notes,
      ]
        .filter(Boolean)
        .join(' '),
    sorts: [...SORTS, headerSort],
    filters: [CATEGORY_FILTER, TYPE_FILTER, STATUS_FILTER],
    defaultPageSize: 25,
  });

  useEffect(() => {
    dv.setSortKey(headerSort.key);
  }, [colSort.col, colSort.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleColSort = (col: SortCol) => {
    setColSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }
    );
  };

  const bulkActions: ToolbarBulkAction[] = canEdit
    ? [
        {
          key: 'edit',
          label: 'Edit selected',
          onRun: () => {
            const queue = conditions.filter((c) => dv.selected.has(c.id));
            if (queue.length === 0) return;
            setBulkEditQueue(queue.slice(1));
            setEditing(queue[0]);
          },
        },
        { key: 'delete', label: 'Delete selected', destructive: true, onRun: () => setConfirmBulkDelete(true) },
      ]
    : [];

  const advanceQueue = () => {
    if (bulkEditQueue.length > 0) {
      setEditing(bulkEditQueue[0]);
      setBulkEditQueue(bulkEditQueue.slice(1));
    } else {
      setEditing(null);
      dv.clearSelection();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink">Conditions</h2>
          <p className="text-sm text-muted">
            Everything {careName} lives with: illnesses, injuries, recovery, disabilities, and long-term
            conditions, each with their category, severity, diagnosis codes, treatments, and symptoms.
          </p>
        </div>
        {canEdit ? <Button size="sm" onClick={() => setAdding(true)}>Add condition</Button> : null}
      </div>

      <DataToolbar
        search={dv.search}
        onSearch={dv.setSearch}
        searchPlaceholder="Search conditions or codes..."
        sorts={SORTS.map((s) => ({ key: s.key, label: s.label }))}
        sortKey={dv.sortKey}
        onSort={dv.setSortKey}
        filters={[CATEGORY_FILTER, TYPE_FILTER, STATUS_FILTER].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
        filterValues={dv.filterValues}
        onFilter={dv.setFilter}
        selectedCount={dv.selected.size}
        bulkActions={bulkActions}
        onClearSelection={dv.clearSelection}
        page={dv.page}
        totalPages={dv.totalPages}
        pageSize={dv.pageSize}
        totalFiltered={dv.totalFiltered}
        onPageChange={dv.setPage}
        onPageSizeChange={dv.setPageSize}
      />

      {isLoading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">
            {conditions.length === 0
              ? `No conditions recorded for ${careName} yet.`
              : 'No conditions match your search or filters.'}
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                {canEdit ? <th className="px-3 py-2 w-8" /> : null}
                <SortableHeader col="name" label="Condition" current={colSort} onSort={toggleColSort} />
                <SortableHeader col="category" label="Category" current={colSort} onSort={toggleColSort} />
                <SortableHeader col="condition_type" label="Type" current={colSort} onSort={toggleColSort} />
                <SortableHeader col="severity" label="Severity" current={colSort} onSort={toggleColSort} />
                <SortableHeader col="status" label="Status" current={colSort} onSort={toggleColSort} />
                <SortableHeader col="started_on" label="Started" current={colSort} onSort={toggleColSort} />
                <th className="px-3 py-2 hidden md:table-cell">Resolved</th>
                <th className="px-3 py-2 hidden lg:table-cell">Codes</th>
                <th className="px-3 py-2 hidden lg:table-cell">Treatments</th>
                {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((c) => {
                const allTreatments = [
                  ...(c.medications ?? []).map((m) => m.name),
                  ...(c.treatments ?? []).map((t) => t.name),
                ];
                const treatmentCount = allTreatments.length;
                return (
                  <tr key={c.id} className="border-b border-border last:border-0 align-top">
                    {canEdit ? (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.name}`}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                          checked={dv.selected.has(c.id)}
                          onChange={() => dv.toggle(c.id)}
                        />
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      <span className="font-medium text-ink">{c.name}</span>
                      {c.is_permanent ? (
                        <span className="ml-2 badge bg-surface-2 text-muted text-xs">Permanent</span>
                      ) : null}
                      {c.is_contagious ? (
                        <span className="ml-1 badge bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs">Contagious</span>
                      ) : null}
                      {(c.functions?.length ?? 0) > 0 ? (
                        <p className="text-xs text-muted mt-0.5">
                          Affects {c.functions!.map((f) => functionDomainLabel(f.domain).toLowerCase()).join(', ')}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-ink">{conditionCategoryLabel(c.category)}</td>
                    <td className="px-3 py-2 text-ink">{conditionTypeLabel(c.condition_type)}</td>
                    <td className="px-3 py-2 text-ink capitalize">{c.severity ?? ''}</td>
                    <td className="px-3 py-2 text-ink">{conditionStatusLabel(c.status)}</td>
                    <td className="px-3 py-2 text-ink whitespace-nowrap">{fmtDate(c.started_on)}</td>
                    <td className="px-3 py-2 text-ink whitespace-nowrap hidden md:table-cell">{fmtDate(c.resolved_on)}</td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      {(c.codes ?? []).map((code) => (
                        <span key={code.id} className="badge bg-surface-2 text-ink text-xs mr-1 mb-1" title={codeSystemLabel(code.system)}>
                          {code.code}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      {treatmentCount > 0 ? (
                        <span
                          className="text-ink cursor-default"
                          title={allTreatments.join(', ')}
                        >
                          {treatmentCount} ({allTreatments.slice(0, 2).join(', ')}{allTreatments.length > 2 ? `, +${allTreatments.length - 2}` : ''})
                        </span>
                      ) : (
                        <span className="text-muted"></span>
                      )}
                    </td>
                    {canEdit ? (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button size="xs" variant="ghost" className="mr-1" onClick={() => setEditing(c)}>
                          Edit
                        </Button>
                        <Button size="xs" variant="ghost-danger" onClick={() => setConfirmDelete(c)}>
                          Delete
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <ConditionEditor
          profileId={profile.id}
          condition={null}
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            setAdding(false);
            invalidate();
            setEditing(saved);
          }}
        />
      ) : null}
      {editing ? (
        <ConditionEditor
          profileId={profile.id}
          condition={editing}
          onClose={() => {
            setEditing(null);
            setBulkEditQueue([]);
          }}
          onSaved={() => {
            invalidate();
            advanceQueue();
          }}
        />
      ) : null}

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete condition">
        <p className="text-sm text-muted mb-4">
          Delete <span className="font-medium text-ink">{confirmDelete?.name}</span> and its codes, functional
          impact, symptoms, and treatment links? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
          >
            Delete
          </Button>
        </div>
      </Modal>

      <Modal open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} title="Delete conditions">
        <p className="text-sm text-muted mb-4">
          Delete {dv.selected.size} {dv.selected.size === 1 ? 'condition' : 'conditions'} and their codes,
          functional impact, symptoms, and treatment links? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
          <Button
            variant="danger"
            loading={bulkDeleteMutation.isPending}
            onClick={() => bulkDeleteMutation.mutate([...dv.selected])}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function SortableHeader({
  col,
  label,
  current,
  onSort,
}: {
  col: SortCol;
  label: string;
  current: { col: SortCol; dir: SortDir };
  onSort: (col: SortCol) => void;
}) {
  const active = current.col === col;
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        className={`inline-flex items-center gap-1 hover:text-ink ${active ? 'text-ink font-semibold' : ''}`}
        onClick={() => onSort(col)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active ? (
          <span className="text-[10px]">{current.dir === 'asc' ? '▲' : '▼'}</span>
        ) : (
          <span className="text-[10px] opacity-0 group-hover:opacity-50">▲</span>
        )}
      </button>
    </th>
  );
}

function ConditionEditor({
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
  const [name, setName] = useState(condition?.name ?? '');
  const [category, setCategory] = useState(condition?.category ?? '');
  const [conditionType, setConditionType] = useState(condition?.condition_type ?? '');
  const [severity, setSeverity] = useState(condition?.severity ?? '');
  const [status, setStatus] = useState(condition?.status ?? 'active');
  const [startedOn, setStartedOn] = useState(condition?.started_on ?? '');
  const [resolvedOn, setResolvedOn] = useState(condition?.resolved_on ?? '');
  const [expectedDuration, setExpectedDuration] = useState(condition?.expected_duration ?? '');
  const [isPermanent, setIsPermanent] = useState(condition?.is_permanent ?? false);
  const [isContagious, setIsContagious] = useState(condition?.is_contagious ?? false);
  const [isolationRequired, setIsolationRequired] = useState(condition?.isolation_required ?? false);
  const [region, setRegion] = useState(condition?.region ?? '');
  const [notes, setNotes] = useState(condition?.notes ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!condition) return;
    setName(condition.name);
    setCategory(condition.category ?? '');
    setConditionType(condition.condition_type ?? '');
    setSeverity(condition.severity ?? '');
    setStatus(condition.status);
    setStartedOn(condition.started_on ?? '');
    setResolvedOn(condition.resolved_on ?? '');
    setExpectedDuration(condition.expected_duration ?? '');
    setIsPermanent(condition.is_permanent ?? false);
    setIsContagious(condition.is_contagious ?? false);
    setIsolationRequired(condition.isolation_required ?? false);
    setRegion(condition.region ?? '');
    setNotes(condition.notes ?? '');
  }, [condition]);

  const showIllnessFields = category === 'illness' || category === 'acute_illness' || category === 'chronic_flare';

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        category: category || null,
        condition_type: conditionType || null,
        severity: severity || null,
        status,
        started_on: startedOn || null,
        resolved_on: resolvedOn || null,
        expected_duration: expectedDuration || null,
        is_permanent: conditionType === 'disability' ? isPermanent : null,
        is_contagious: isContagious,
        isolation_required: isolationRequired,
        region: region.trim() || null,
        notes: notes.trim() || null,
      };
      return isNew
        ? api.post<{ condition: MedicalCondition }>(`/care-profiles/${profileId}/conditions`, body)
        : api.patch<{ condition: MedicalCondition }>(`/care-profiles/${profileId}/conditions/${condition.id}`, body);
    },
    onSuccess: (res) => onSaved(res.condition),
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the condition.'),
  });

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add condition' : `Edit ${condition.name}`} wide>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <span className="block text-sm font-medium text-ink mb-1">Condition</span>
            <CatalogueCombo
              endpoint="/condition-catalogue"
              ariaLabel="Condition name"
              placeholder="Type to search, e.g. Type 2 diabetes"
              initial={name}
              keepValue
              onPick={setName}
              widthClass="w-full"
            />
          </div>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Category</span>
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Not set</option>
              {CONDITION_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Type</span>
            <select className={inputClass} value={conditionType} onChange={(e) => setConditionType(e.target.value)}>
              <option value="">Work out from the dates</option>
              {CONDITION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted mt-1">
              {CONDITION_TYPES.find((t) => t.value === conditionType)?.description ??
                'Left blank, a resolved condition counts as acute and one running over three months as chronic.'}
            </p>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Severity</span>
            <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Not set</option>
              {CONDITION_SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Status</span>
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {CONDITION_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <Input
            label="Started"
            type="date"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
          />
          <Input
            label="Resolved"
            type="date"
            value={resolvedOn}
            onChange={(e) => setResolvedOn(e.target.value)}
            hint="Filling this marks the condition resolved."
          />
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Expected duration</span>
            <select className={inputClass} value={expectedDuration} onChange={(e) => setExpectedDuration(e.target.value)}>
              <option value="">Not set</option>
              {EXPECTED_DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </label>
          {conditionType === 'disability' ? (
            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                checked={isPermanent}
                onChange={(e) => setIsPermanent(e.target.checked)}
              />
              <span className="text-sm text-ink">Permanent, not expected to improve</span>
            </label>
          ) : null}
          {showIllnessFields ? (
            <>
              <label className="flex items-center gap-2 self-end pb-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={isContagious}
                  onChange={(e) => setIsContagious(e.target.checked)}
                />
                <span className="text-sm text-ink">Contagious</span>
              </label>
              <label className="flex items-center gap-2 self-end pb-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={isolationRequired}
                  onChange={(e) => setIsolationRequired(e.target.checked)}
                />
                <span className="text-sm text-ink">Isolation required</span>
              </label>
            </>
          ) : null}
          {(category === 'injury' || showIllnessFields) ? (
            <Input
              label="Body region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              hint="Where on the body, if applicable"
            />
          ) : null}
        </div>
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        {!isNew ? (
          <>
            <CodesSection profileId={profileId} condition={condition} />
            <FunctionsSection profileId={profileId} condition={condition} />
          </>
        ) : null}

        <TreatmentPlanSection profileId={profileId} condition={condition} isNew={isNew} />

        {showIllnessFields && !isNew ? (
          <SymptomsSection profileId={profileId} condition={condition} />
        ) : null}

        {isNew && showIllnessFields ? (
          <p className="text-xs text-muted">
            Symptoms can be added straight after saving.
          </p>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={saveMutation.isPending} disabled={!name.trim()} onClick={() => saveMutation.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CodesSection({ profileId, condition }: { profileId: string; condition: MedicalCondition }) {
  const queryClient = useQueryClient();
  const [codes, setCodes] = useState<ConditionCode[]>(condition.codes ?? []);
  const [system, setSystem] = useState<'icd10' | 'snomed'>('icd10');
  const [code, setCode] = useState('');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });

  const addMutation = useMutation({
    mutationFn: () =>
      api.post<{ code: ConditionCode }>(`/care-profiles/${profileId}/conditions/${condition.id}/codes`, {
        system,
        code: code.trim(),
      }),
    onSuccess: (res) => {
      if (res.code && !codes.some((c) => c.id === res.code.id)) setCodes([...codes, res.code]);
      setCode('');
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (codeId: string) =>
      api.delete(`/care-profiles/${profileId}/conditions/${condition.id}/codes/${codeId}`),
    onSuccess: (_res, codeId) => {
      setCodes(codes.filter((c) => c.id !== codeId));
      invalidate();
    },
  });

  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-ink mb-1">Standard codes</h3>
      <p className="text-xs text-muted mb-2">
        ICD-10 and SNOMED CT codes let this record work with hospital and clinic systems.
      </p>
      <div className="space-y-1.5">
        {codes.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-sm">
            <span className="badge bg-surface-2 text-muted text-xs w-24 justify-center">{codeSystemLabel(c.system)}</span>
            <span className="font-mono text-ink">{c.code}</span>
            <Button size="xs" variant="ghost-danger" className="ml-auto" onClick={() => removeMutation.mutate(c.id)}>
              Remove
            </Button>
          </div>
        ))}
        {codes.length === 0 ? <p className="text-sm text-muted">No codes recorded.</p> : null}
      </div>
      <div className="flex items-end gap-2 mt-2">
        <label className="block">
          <span className="block text-xs text-muted mb-1">System</span>
          <select
            className={inputClass}
            value={system}
            onChange={(e) => setSystem(e.target.value as 'icd10' | 'snomed')}
          >
            {CODE_SYSTEMS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <div className="flex-1">
          <Input
            label="Code"
            placeholder={system === 'icd10' ? 'e.g. E11.9' : 'e.g. 44054006'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <Button size="sm" variant="secondary" disabled={!code.trim()} loading={addMutation.isPending} onClick={() => addMutation.mutate()}>
          Add code
        </Button>
      </div>
    </div>
  );
}

function FunctionsSection({ profileId, condition }: { profileId: string; condition: MedicalCondition }) {
  const queryClient = useQueryClient();
  const [functions, setFunctions] = useState<ConditionFunction[]>(condition.functions ?? []);
  const [domain, setDomain] = useState('mobility');
  const [level, setLevel] = useState('moderate');
  const [pattern, setPattern] = useState('');
  const [impact, setImpact] = useState('');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });

  const addMutation = useMutation({
    mutationFn: () =>
      api.post<{ function: ConditionFunction }>(`/care-profiles/${profileId}/conditions/${condition.id}/functions`, {
        domain,
        limitation_level: level,
        temporal_pattern: pattern || null,
        impact_on_activities: impact.trim() || null,
      }),
    onSuccess: (res) => {
      setFunctions([...functions, res.function]);
      setImpact('');
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (fnId: string) =>
      api.delete(`/care-profiles/${profileId}/conditions/${condition.id}/functions/${fnId}`),
    onSuccess: (_res, fnId) => {
      setFunctions(functions.filter((f) => f.id !== fnId));
      invalidate();
    },
  });

  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-ink mb-1">Functional impact</h3>
      <p className="text-xs text-muted mb-2">
        Which parts of daily life this limits, how much, and whether that is changing.
      </p>
      <div className="space-y-1.5">
        {functions.map((f) => (
          <div key={f.id} className="flex items-start gap-2 text-sm">
            <span className="badge bg-surface-2 text-ink text-xs">{functionDomainLabel(f.domain)}</span>
            <span className="text-ink capitalize">{f.limitation_level}</span>
            {f.temporal_pattern ? <span className="text-muted">{temporalPatternLabel(f.temporal_pattern)}</span> : null}
            {f.impact_on_activities ? <span className="text-muted flex-1">{f.impact_on_activities}</span> : null}
            <Button size="xs" variant="ghost-danger" className="ml-auto" onClick={() => removeMutation.mutate(f.id)}>
              Remove
            </Button>
          </div>
        ))}
        {functions.length === 0 ? <p className="text-sm text-muted">No functional impact recorded.</p> : null}
      </div>
      <div className="grid sm:grid-cols-2 gap-2 mt-2">
        <label className="block">
          <span className="block text-xs text-muted mb-1">Affected area</span>
          <select className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value)}>
            {FUNCTION_DOMAINS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">How limited</span>
          <select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LIMITATION_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Pattern</span>
          <select className={inputClass} value={pattern} onChange={(e) => setPattern(e.target.value)}>
            <option value="">Not set</option>
            {TEMPORAL_PATTERNS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        <div>
          <Input
            label="What it means day to day"
            placeholder="e.g. Cannot stand longer than 10 minutes"
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end mt-2">
        <Button size="sm" variant="secondary" loading={addMutation.isPending} onClick={() => addMutation.mutate()}>
          Add impact
        </Button>
      </div>
    </div>
  );
}

function TreatmentPlanSection({
  profileId,
  condition,
  isNew,
}: {
  profileId: string;
  condition: MedicalCondition | null;
  isNew: boolean;
}) {
  const queryClient = useQueryClient();
  const [treatments, setTreatments] = useState(condition?.treatments ?? []);
  const [name, setName] = useState('');
  const [treatmentCategory, setTreatmentCategory] = useState('therapy');
  const [treatmentStatus, setTreatmentStatus] = useState('active');
  const [reviewDate, setReviewDate] = useState('');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['treatments', profileId] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      api.post<{ treatment: { id: string; name: string; category: string; current_status: string; last_review_date: string | null; active: boolean } }>(
        `/care-profiles/${profileId}/treatments`,
        {
          name: name.trim(),
          category: treatmentCategory,
          current_status: treatmentStatus,
          last_review_date: reviewDate || null,
          medical_condition_id: condition?.id ?? null,
        }
      ),
    onSuccess: (res) => {
      setTreatments([...treatments, res.treatment]);
      setName('');
      setReviewDate('');
      invalidate();
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, current_status }: { id: string; current_status: string }) =>
      api.patch(`/care-profiles/${profileId}/treatments/${id}`, { current_status }),
    onSuccess: (_res, vars) => {
      setTreatments(treatments.map((t) => (t.id === vars.id ? { ...t, current_status: vars.current_status } : t)));
      invalidate();
    },
  });

  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-ink mb-1">Treatment plan</h3>
      <p className="text-xs text-muted mb-2">
        {isNew
          ? 'Add treatments for this condition. They will also appear on the Treatments page.'
          : 'Everything managing this condition. Medications are prescribed on the Treatments page and appear here once linked to this condition.'}
      </p>
      <div className="space-y-1.5">
        {!isNew && (condition?.medications ?? []).map((m, i) => (
          <div key={`med-${i}`} className="flex items-center gap-2 text-sm">
            <span className="badge bg-surface-2 text-muted text-xs w-28 justify-center">Medication</span>
            <span className="text-ink">{m.name}</span>
            <span className="text-muted">{m.active ? 'Active' : 'Stopped'}</span>
            <Link to="../medications" className="ml-auto text-xs text-primary hover:underline">
              Manage
            </Link>
          </div>
        ))}
        {treatments.map((t) => (
          <div key={t.id} className="flex items-center gap-2 text-sm">
            <span className="badge bg-surface-2 text-muted text-xs w-28 justify-center">{treatmentCategoryLabel(t.category)}</span>
            <span className="text-ink">{t.name}</span>
            {t.last_review_date ? (
              <span className="text-muted text-xs">reviewed {fmtDate(t.last_review_date)}</span>
            ) : null}
            <select
              aria-label={`Status of ${t.name}`}
              className="ml-auto rounded-md border border-border bg-card px-2 py-1 text-xs"
              value={t.current_status}
              onChange={(e) => statusMutation.mutate({ id: t.id, current_status: e.target.value })}
            >
              {TREATMENT_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{treatmentStatusLabel(s.value)}</option>
              ))}
            </select>
          </div>
        ))}
        {treatments.length === 0 && (condition?.medications ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nothing managing this condition yet.</p>
        ) : null}
      </div>
      <div className="grid sm:grid-cols-2 gap-2 mt-2">
        <div>
          <Input
            label="Treatment"
            placeholder="e.g. Physiotherapy, knee replacement, walking frame"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Kind</span>
          <select className={inputClass} value={treatmentCategory} onChange={(e) => setTreatmentCategory(e.target.value)}>
            {TREATMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Status</span>
          <select className={inputClass} value={treatmentStatus} onChange={(e) => setTreatmentStatus(e.target.value)}>
            {TREATMENT_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <Input label="Last reviewed" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
      </div>
      <div className="flex justify-end mt-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!name.trim() || (isNew && !condition)}
          loading={addMutation.isPending}
          onClick={() => addMutation.mutate()}
        >
          Add treatment
        </Button>
      </div>
    </div>
  );
}

function SymptomsSection({ profileId, condition }: { profileId: string; condition: MedicalCondition }) {
  const queryClient = useQueryClient();
  const symptoms = condition.symptoms ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });

  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-ink mb-1">Symptoms</h3>
      <p className="text-xs text-muted mb-2">
        Track the symptoms of this condition. Each symptom has a severity from 1 (mild) to 5 (severe).
      </p>
      {symptoms.length === 0 ? (
        <p className="text-sm text-muted">No symptoms recorded yet.</p>
      ) : (
        <div className="space-y-1">
          {symptoms.map((sym) => (
            <SymptomRow
              key={sym.id}
              symptom={sym}
              profileId={profileId}
              conditionId={condition.id}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
      <SymptomForm profileId={profileId} conditionId={condition.id} onSaved={invalidate} />
    </div>
  );
}

function SymptomRow({
  symptom,
  profileId,
  conditionId,
  onChanged,
}: {
  symptom: ConditionSymptom;
  profileId: string;
  conditionId: string;
  onChanged: () => void;
}) {
  const resolveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/conditions/${conditionId}/symptoms/${symptom.id}`, {
        resolved_at: symptom.resolved_at ? null : new Date().toISOString(),
      }),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api.delete(`/care-profiles/${profileId}/conditions/${conditionId}/symptoms/${symptom.id}`),
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
      <Button size="xs" variant="ghost" onClick={() => resolveMutation.mutate()}>
        {symptom.resolved_at ? 'Reopen' : 'Resolve'}
      </Button>
      <Button size="xs" variant="ghost-danger" onClick={() => deleteMutation.mutate()}>
        Remove
      </Button>
    </div>
  );
}

function SymptomForm({
  profileId,
  conditionId,
  onSaved,
}: {
  profileId: string;
  conditionId: string;
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
      api.post(`/care-profiles/${profileId}/conditions/${conditionId}/symptoms`, {
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

  const selectClass = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

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
        <select className={selectClass} value={severity} onChange={(e) => setSeverity(Number(e.target.value))}>
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
