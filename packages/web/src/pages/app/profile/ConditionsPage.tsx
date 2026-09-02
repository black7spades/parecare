import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Modal } from '../../../components/ui/Modal';
import { useDataView, type DataFilter, type DataSort } from '../../../components/data/useDataView';
import { SortableTh } from '../../../components/data/SortableTh';
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

const severityRank = (c: MedicalCondition): number =>
  CONDITION_SEVERITIES.findIndex((s) => s.value === c.severity);
const treatmentCount = (c: MedicalCondition): number =>
  (c.medications?.length ?? 0) + (c.treatments?.length ?? 0);
const byText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').localeCompare(b ?? '');

// One entry per visible column, so the dropdown and the column headers are the
// same control rather than two that disagree.
const SORTS: DataSort<MedicalCondition>[] = [
  { key: 'name', label: 'Condition', compare: (a, b) => byText(a.name, b.name) },
  { key: 'category', label: 'Category', compare: (a, b) => byText(a.category, b.category) },
  { key: 'condition_type', label: 'Type', compare: (a, b) => byText(a.condition_type, b.condition_type) },
  { key: 'severity', label: 'Severity', defaultDir: 'desc', compare: (a, b) => severityRank(a) - severityRank(b) },
  { key: 'status', label: 'Status', compare: (a, b) => byText(a.status, b.status) },
  { key: 'started_on', label: 'Started', defaultDir: 'desc', compare: (a, b) => byText(a.started_on, b.started_on) },
  { key: 'resolved_on', label: 'Resolved', defaultDir: 'desc', compare: (a, b) => byText(a.resolved_on, b.resolved_on) },
  { key: 'codes', label: 'Codes', defaultDir: 'desc', compare: (a, b) => (a.codes?.length ?? 0) - (b.codes?.length ?? 0) },
  { key: 'treatments', label: 'Treatments', defaultDir: 'desc', compare: (a, b) => treatmentCount(a) - treatmentCount(b) },
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


export function ConditionsPage() {
  const { profile, careName, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MedicalCondition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MedicalCondition | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkEditQueue, setBulkEditQueue] = useState<MedicalCondition[]>([]);

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
    sorts: SORTS,
    filters: [CATEGORY_FILTER, TYPE_FILTER, STATUS_FILTER],
    defaultPageSize: 25,
  });



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
          <EditableSubheader copyKey="profile.conditions.subheader" vars={{ name: careName }} />
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
                <SortableTh label="Condition" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Category" sortKey="category" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Type" sortKey="condition_type" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Severity" sortKey="severity" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Status" sortKey="status" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Started" sortKey="started_on" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Resolved" sortKey="resolved_on" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="hidden md:table-cell" />
                <SortableTh label="Codes" sortKey="codes" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="hidden lg:table-cell" />
                <SortableTh label="Treatments" sortKey="treatments" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="hidden lg:table-cell" />
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

