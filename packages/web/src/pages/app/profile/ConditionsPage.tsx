import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Modal } from '../../../components/ui/Modal';
import { useDataView, type DataFilter, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import {
  CONDITION_CATEGORIES,
  CONDITION_SEVERITIES,
  CONDITION_STATUSES,
  CONDITION_TYPES,
  codeSystemLabel,
  conditionCategoryLabel,
  conditionStatusLabel,
  conditionTypeLabel,
  functionDomainLabel,
  type MedicalCondition,
} from '../../../lib/care';
import { PagePurpose } from '../../../components/PagePurpose';
import { useProfile } from './ProfileLayout';
import { ConditionEditor } from './conditions/ConditionEditor';


const fmtDate = (d: string | null | undefined) => (d ? format(new Date(d), 'd MMM yyyy') : '');

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
  const conditions = (data?.conditions ?? []).filter((c) => c.category !== 'neurotype');

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
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Conditions</h2>
            <PagePurpose kind="entry" />
          </div>
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
                        <Button size="xs" variant="ghost" className="mr-1" aria-label={`Edit ${c.name}`} title="Edit" onClick={() => setEditing(c)}>
                          <PencilIcon />
                        </Button>
                        <Button size="xs" variant="ghost-danger" aria-label={`Delete ${c.name}`} title="Delete" onClick={() => setConfirmDelete(c)}>
                          <TrashIcon />
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
          careName={careName}
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
          careName={careName}
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

