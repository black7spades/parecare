import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from '../../../lib/dateFormat';
import { formatDateOnly } from '../../../lib/datetime';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
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
  expectedDurationLabel,
  functionDomainLabel,
  temporalPatternLabel,
  LIMITATION_LEVELS,
  resolutionReasonLabel,
  type MedicalCondition,
} from '../../../lib/care';
import { PagePurpose } from '../../../components/PagePurpose';
import { useProfile } from './ProfileLayout';
import { ConditionEditor } from './conditions/ConditionEditor';
import { ResolveConditionModal, type ResolutionDetails } from './conditions/ResolveConditionModal';
import { RecordPanel, type RecordLink } from '../../../components/record/RecordPanel';
import { ContactStrip } from '../../../components/ContactStrip';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { useNavigate } from 'react-router-dom';
import { bookingHref } from '../../../lib/booking';


const fmtDate = (d: string | null | undefined) => formatDateOnly(d, 'd MMM yyyy');
const todayIso = () => format(new Date(), 'yyyy-MM-dd');

/** Over and done with: marked resolved, or its resolution date has passed. */
const isResolved = (c: MedicalCondition): boolean =>
  c.status === 'resolved' || (!!c.resolved_on && c.resolved_on <= todayIso());

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
  {
    key: 'resolution_reason',
    label: 'Why it resolved',
    compare: (a, b) => byText(resolutionReasonLabel(a.resolution_reason), resolutionReasonLabel(b.resolution_reason)),
  },
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
  const { profile, careName, canEdit, voice } = useProfile();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MedicalCondition | null>(null);
  const [bulkEditQueue, setBulkEditQueue] = useState<MedicalCondition[]>([]);
  // Conditions waiting on the Resolve step, and whether to close the open record after.
  const [resolving, setResolving] = useState<{ items: MedicalCondition[]; fromPanel: boolean } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['conditions', profile.id],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profile.id}/conditions`),
  });
  const conditions = (data?.conditions ?? []).filter((c) => c.category !== 'neurotype');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profile.id] });

  // Deleting is held back a few seconds with Undo, never a "sure?" box.
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const hidden = useHiddenIds();
  const deleteConditions = (items: MedicalCondition[]) => {
    if (items.length === 0) return;
    deferDelete({
      message: items.length === 1 ? `Deleted ${items[0].name}.` : `Deleted ${items.length} conditions.`,
      ids: items.map((c) => c.id),
      commit: () => Promise.all(items.map((c) => api.delete(`/care-profiles/${profile.id}/conditions/${c.id}`))),
      onCommitted: invalidate,
    });
  };

  // Marking resolved moves conditions off the list at once, with Undo for a
  // few seconds, the same way a delete does.
  const markResolved = (items: MedicalCondition[], details: ResolutionDetails) => {
    const open = items.filter((c) => !isResolved(c));
    if (open.length === 0) return;
    deferDelete({
      message: open.length === 1 ? `Marked ${open[0].name} resolved.` : `Marked ${open.length} conditions resolved.`,
      ids: open.map((c) => c.id),
      commit: () =>
        Promise.all(
          open.map((c) =>
            // Only what was given is sent. No date is guessed: resolving can
            // mean "stop tracking it", and nobody should have to work out the
            // day a cold cleared up. A date already on record is kept.
            api.patch(`/care-profiles/${profile.id}/conditions/${c.id}`, { status: 'resolved', ...details })
          )
        ),
      onCommitted: invalidate,
    });
  };

  // Resolved conditions stay on record but off the list until asked for.
  const [showResolved, setShowResolved] = useState(false);
  const visible = conditions.filter((c) => !hidden.has(c.id));
  const resolvedCount = visible.filter(isResolved).length;
  const listed = showResolved ? visible : visible.filter((c) => !isResolved(c));
  const panel = useRecordPanel(visible, (c) => c.id);
  const dv = useDataView<MedicalCondition>({
    rows: listed,
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
        resolutionReasonLabel(c.resolution_reason),
        c.resolution_notes,
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
        {
          key: 'resolve',
          label: 'Mark resolved',
          onRun: () => {
            const items = visible.filter((c) => dv.selected.has(c.id) && !isResolved(c));
            if (items.length > 0) setResolving({ items, fromPanel: false });
          },
        },
        {
          key: 'delete',
          label: 'Delete selected',
          destructive: true,
          onRun: () => {
            deleteConditions(visible.filter((c) => dv.selected.has(c.id)));
            dv.clearSelection();
          },
        },
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
          <EditableSubheader copyKey="profile.conditions.subheader" voice={voice} />
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
        onFilter={(key, value) => {
          // Asking for resolved conditions brings them back into the list.
          if (key === 'status' && value === 'resolved') setShowResolved(true);
          dv.setFilter(key, value);
        }}
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
              ? `No conditions recorded for ${voice.object} yet.`
              : listed.length === 0
                ? `No current conditions for ${voice.object}.`
                : 'No conditions match your search or filters.'}
          </p>
          {conditions.length === 0 && canEdit ? (
            <Button size="sm" className="mt-3" onClick={() => setAdding(true)}>Add condition</Button>
          ) : null}
        </div>
      ) : (
        <div className="card p-0 fit-table">
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
                <SortableTh label="Why it resolved" sortKey="resolution_reason" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="hidden lg:table-cell" />
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
                  <tr key={c.id} {...panel.rowProps(c.id)} className={`border-b border-border last:border-0 align-top ${isResolved(c) ? 'opacity-60' : ''} ${RECORD_ROW_CLASS}`}>
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
                    <td className="px-3 py-2 text-ink hidden lg:table-cell">{resolutionReasonLabel(c.resolution_reason)}</td>
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
                        <Button size="xs" variant="ghost-danger" aria-label={`Delete ${c.name}`} title="Delete" onClick={() => deleteConditions([c])}>
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

      {resolvedCount > 0 ? (
        <Button size="xs" variant="ghost" onClick={() => setShowResolved((v) => !v)}>
          {showResolved
            ? 'Hide resolved conditions'
            : `Show ${resolvedCount} resolved ${resolvedCount === 1 ? 'condition' : 'conditions'}`}
        </Button>
      ) : null}

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

      {resolving ? (
        <ResolveConditionModal
          names={resolving.items.map((c) => c.name)}
          onClose={() => setResolving(null)}
          onConfirm={(details) => {
            markResolved(resolving.items, details);
            if (resolving.fromPanel) panel.close();
            else dv.clearSelection();
            setResolving(null);
          }}
        />
      ) : null}

      {panel.current ? (() => {
        const c = panel.current;
        const yes = (v: boolean | null | undefined) => (v ? 'Yes' : null);
        const limitLabel = (v: string) => LIMITATION_LEVELS.find((l) => l.value === v)?.label ?? v;
        const links: RecordLink[] = [
          ...(c.appointments ?? []).map((a) => ({
            label: 'Appointment',
            value: `${a.title}, ${a.starts_at ? format(new Date(a.starts_at), 'd MMM yyyy') : a.status === 'cancelled' ? 'cancelled' : 'not booked yet, book it'}`,
            // Not booked yet: the link goes straight to booking it.
            to: `/app/${profile.id}/appointments?${a.starts_at || a.status === 'cancelled' ? 'record' : 'book'}=${a.id}`,
          })),
          ...(c.medications ?? []).map((m) => ({
            label: m.active ? 'Medication' : 'Medication, stopped',
            value: m.name,
            to: m.id ? `/app/${profile.id}/medications?record=${m.id}` : `/app/${profile.id}/medications`,
          })),
          ...(c.treatments ?? []).map((t) => ({
            label: t.active ? 'Treatment' : 'Treatment, stopped',
            value: t.name,
            to: `/app/${profile.id}/treatments?record=${t.id}`,
          })),
          ...(c.documents ?? []).map((d) => ({
            label: 'Document',
            value: d.label,
            to: `/app/${profile.id}/documents?doc=${d.id}`,
          })),
        ];
        return (
          <RecordPanel
            key={c.id}
            kindLabel="Condition"
            title={c.name}
            kind="conditions"
            recordId={c.id}
            profileId={profile.id}
            canEdit={canEdit}
            fields={[
              { label: 'Category', value: conditionCategoryLabel(c.category) },
              { label: 'Type', value: conditionTypeLabel(c.condition_type) },
              { label: 'Severity', value: CONDITION_SEVERITIES.find((x) => x.value === c.severity)?.label ?? c.severity },
              { label: 'Normal level', value: c.baseline_severity != null ? `${c.baseline_severity} out of 10` : null },
              { label: 'Status', value: conditionStatusLabel(c.status) },
              { label: 'Started', value: fmtDate(c.started_on) },
              { label: 'Resolved', value: fmtDate(c.resolved_on) },
              { label: 'Why it resolved', value: resolutionReasonLabel(c.resolution_reason) },
              { label: 'What happened', value: c.resolution_notes },
              { label: 'Expected duration', value: expectedDurationLabel(c.expected_duration) },
              { label: 'Permanent', value: yes(c.is_permanent) },
              { label: 'Contagious', value: yes(c.is_contagious) },
              { label: 'Isolation required', value: yes(c.isolation_required) },
              { label: 'Body region', value: c.region },
              {
                label: 'Codes',
                value: (c.codes ?? []).map((code) => `${codeSystemLabel(code.system)} ${code.code}`).join(', '),
              },
              {
                label: 'Daily life',
                value: (c.functions ?? [])
                  .map((f) =>
                    [
                      `${functionDomainLabel(f.domain)}: ${limitLabel(f.limitation_level).toLowerCase()} limit`,
                      f.temporal_pattern ? temporalPatternLabel(f.temporal_pattern).toLowerCase() : null,
                    ]
                      .filter(Boolean)
                      .join(', ')
                  )
                  .join('\n'),
              },
              {
                label: 'Symptoms',
                value: (c.symptoms ?? [])
                  .filter((sy) => !sy.resolved_at)
                  .map((sy) => `${sy.name}, ${sy.severity} out of 10`)
                  .join('\n'),
              },
              { label: 'Notes', value: c.notes },
            ]}
            links={links}
            onEdit={() => setEditing(c)}
            extra={[
              {
                label: 'Book an appointment for this',
                // With whoever treats it, when someone does.
                onRun: () => navigate(bookingHref(profile.id, { condition: c.id, provider: c.treating?.source === 'contact' ? c.treating.id : null })),
              },
            ]}
            done={
              isResolved(c)
                ? null
                : {
                    label: 'Mark resolved',
                    onRun: () => setResolving({ items: [c], fromPanel: true }),
                  }
            }
            onDelete={() => {
              deleteConditions([c]);
              panel.close();
            }}
            onClose={panel.close}
          >
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Who treats it</h3>
              {c.treating ? (
                <ContactStrip contact={c.treating} profileId={profile.id} book={{ condition: c.id }} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted">No one linked yet.</p>
                  {canEdit ? <Button size="xs" variant="ghost" onClick={() => setEditing(c)}>Add who treats it</Button> : null}
                </div>
              )}
            </section>
          </RecordPanel>
        );
      })() : null}
    </div>
  );
}

