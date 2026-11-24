import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Modal } from '../../../components/ui/Modal';
import { Input, Textarea } from '../../../components/ui/Input';
import { PagePurpose } from '../../../components/PagePurpose';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { SortableTh } from '../../../components/data/SortableTh';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import {
  SUBSTANCE_CLASSES,
  SUBSTANCE_STATUSES,
  SUBSTANCE_ROUTES,
  substanceClassLabel,
  substanceStatusLabel,
  substanceRouteLabel,
  type SubstanceUse,
} from '../../../lib/care';
import { useProfile } from './ProfileLayout';
import { formatDateOnly } from '../../../lib/datetime';

const byText = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').localeCompare(b ?? '', undefined, { numeric: true });

const SORTS: DataSort<SubstanceUse>[] = [
  { key: 'substance', label: 'Substance', compare: (a, b) => a.substance.localeCompare(b.substance) },
  { key: 'class', label: 'Class', compare: (a, b) => substanceClassLabel(a.substance_class).localeCompare(substanceClassLabel(b.substance_class)) },
  { key: 'status', label: 'Status', compare: (a, b) => substanceStatusLabel(a.status).localeCompare(substanceStatusLabel(b.status)) },
  { key: 'route', label: 'How', compare: (a, b) => byText(substanceRouteLabel(a.route), substanceRouteLabel(b.route)) },
  { key: 'amount', label: 'Amount', compare: (a, b) => byText(a.quantity, b.quantity) },
  { key: 'unit', label: 'Unit', compare: (a, b) => byText(a.quantity_unit, b.quantity_unit) },
  { key: 'frequency', label: 'How often', compare: (a, b) => byText(a.frequency, b.frequency) },
  { key: 'started', label: 'Started', compare: (a, b) => (a.started_on ?? '').localeCompare(b.started_on ?? '') },
];

const FILTERS: DataFilter<SubstanceUse>[] = [
  {
    key: 'status',
    label: 'Status',
    options: SUBSTANCE_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    match: (row, value) => row.status === value,
  },
  {
    key: 'class',
    label: 'Class',
    options: SUBSTANCE_CLASSES.map((c) => ({ value: c.value, label: c.label })),
    match: (row, value) => row.substance_class === value,
  },
];

/**
 * The data-entry home for substance use: which substances a person takes,
 * legal or illegal, how they take them, how much, how often, and where each
 * sits in a lifecycle from using now to recovery. One row per substance.
 */
export function SubstanceUsePage() {
  const { profile, canEdit, voice } = useProfile();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SubstanceUse | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['substance-use', profile.id],
    queryFn: () => api.get<{ substance_use: SubstanceUse[] }>(`/care-profiles/${profile.id}/substance-use`),
  });
  const records = data?.substance_use ?? [];

  // Deleting is held back a few seconds with Undo, never a "sure?" box.
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const hidden = useHiddenIds();
  const deleteRecord = (r: SubstanceUse) =>
    deferDelete({
      message: `Deleted the record for ${r.substance}.`,
      ids: [r.id],
      commit: () => api.delete(`/care-profiles/${profile.id}/substance-use/${r.id}`),
      onCommitted: () => void queryClient.invalidateQueries({ queryKey: ['substance-use', profile.id] }),
    });

  const visible = records.filter((r) => !hidden.has(r.id));
  const panel = useRecordPanel(visible, (r) => r.id);
  const dv = useDataView<SubstanceUse>({
    rows: visible,
    getId: (r) => r.id,
    searchText: (r) =>
      [r.substance, substanceClassLabel(r.substance_class), substanceStatusLabel(r.status), r.frequency, r.notes].filter(Boolean).join(' '),
    sorts: SORTS,
    filters: FILTERS,
    defaultPageSize: 25,
  });

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Substance use</h2>
            <PagePurpose kind="entry" />
          </div>
          <EditableSubheader copyKey="profile.substance-use.subheader" voice={voice} />
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add substance
          </Button>
        ) : null}
      </div>

      <DataToolbar
        search={dv.search}
        onSearch={dv.setSearch}
        searchPlaceholder="Search substances..."
        sorts={SORTS.map((s) => ({ key: s.key, label: s.label }))}
        sortKey={dv.sortKey}
        onSort={dv.setSortKey}
        filters={FILTERS}
        filterValues={dv.filterValues}
        onFilter={dv.setFilter}
        selectedCount={0}
        bulkActions={[]}
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
            {records.length === 0
              ? `No substance use recorded for ${voice.object} yet.`
              : 'No substances match your search.'}
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <SortableTh label="Substance" sortKey="substance" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Class" sortKey="class" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Status" sortKey="status" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="How" sortKey="route" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Amount" sortKey="amount" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Unit" sortKey="unit" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="How often" sortKey="frequency" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Started" sortKey="started" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((r) => (
                <tr key={r.id} {...panel.rowProps(r.id)} className={`border-b border-border last:border-0 align-top ${RECORD_ROW_CLASS}`}>
                  <td className="px-3 py-2 font-medium text-ink">{r.substance}</td>
                  <td className="px-3 py-2 text-muted">{substanceClassLabel(r.substance_class)}</td>
                  <td className="px-3 py-2">
                    <span className="badge bg-surface-2 text-muted text-xs">{substanceStatusLabel(r.status)}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{substanceRouteLabel(r.route) || '-'}</td>
                  <td className="px-3 py-2 text-muted">{r.quantity || '-'}</td>
                  <td className="px-3 py-2 text-muted">{r.quantity_unit || '-'}</td>
                  <td className="px-3 py-2 text-muted">{r.frequency || '-'}</td>
                  <td className="px-3 py-2 text-muted">
                    {r.started_on ? formatDateOnly(r.started_on, 'MMM yyyy') : '-'}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="xs" variant="ghost" className="mr-1" aria-label={`Edit ${r.substance}`} title="Edit" onClick={() => setEditing(r)}>
                        <PencilIcon />
                      </Button>
                      <Button size="xs" variant="ghost-danger" aria-label={`Delete ${r.substance}`} title="Delete" onClick={() => deleteRecord(r)}>
                        <TrashIcon />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? <SubstanceEditor profileId={profile.id} onClose={() => setAdding(false)} /> : null}
      {editing ? <SubstanceEditor profileId={profile.id} record={editing} onClose={() => setEditing(null)} /> : null}

      {panel.current ? (() => {
        const r = panel.current;
        return (
          <RecordPanel
            key={r.id}
            kindLabel="Substance use"
            title={r.substance}
            subtitle={substanceStatusLabel(r.status)}
            kind="substance-use"
            recordId={r.id}
            profileId={profile.id}
            canEdit={canEdit}
            fields={[
              { label: 'Substance', value: r.substance },
              { label: 'Class', value: substanceClassLabel(r.substance_class) },
              { label: 'Status', value: substanceStatusLabel(r.status) },
              { label: 'How it is taken', value: substanceRouteLabel(r.route) },
              { label: 'Amount', value: r.quantity },
              { label: 'Unit', value: r.quantity_unit },
              { label: 'How often', value: r.frequency },
              { label: 'Started', value: r.started_on ? formatDateOnly(r.started_on, 'd MMM yyyy') : null },
              { label: 'Stopped', value: r.quit_on ? formatDateOnly(r.quit_on, 'd MMM yyyy') : null },
              { label: 'Notes', value: r.notes },
            ]}
            onEdit={() => setEditing(r)}
            onDelete={() => {
              deleteRecord(r);
              panel.close();
            }}
            onClose={panel.close}
          />
        );
      })() : null}
    </div>
  );
}

interface CatalogueItem {
  id: string;
  name: string;
  substance_class: string;
}

/** Add or edit one substance-use record. Every fact is its own field. */
function SubstanceEditor({ profileId, record, onClose }: { profileId: string; record?: SubstanceUse; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [substance, setSubstance] = useState(record?.substance ?? '');
  const [substanceClass, setSubstanceClass] = useState(record?.substance_class ?? 'other');
  const [status, setStatus] = useState(record?.status ?? 'active');
  const [route, setRoute] = useState(record?.route ?? '');
  const [quantity, setQuantity] = useState(record?.quantity ?? '');
  const [quantityUnit, setQuantityUnit] = useState(record?.quantity_unit ?? '');
  const [frequency, setFrequency] = useState(record?.frequency ?? '');
  const [startedOn, setStartedOn] = useState(record?.started_on ? record.started_on.slice(0, 10) : '');
  const [quitOn, setQuitOn] = useState(record?.quit_on ? record.quit_on.slice(0, 10) : '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [error, setError] = useState('');

  // Suggestions from the shared catalogue as the substance is typed.
  const { data: cat } = useQuery({
    queryKey: ['substance-catalogue', substance],
    queryFn: () => api.get<{ items: CatalogueItem[] }>(`/substance-catalogue?search=${encodeURIComponent(substance.trim())}`),
    enabled: !record && substance.trim().length > 0,
  });
  const suggestions = cat?.items ?? [];

  // When the typed substance exactly matches a catalogue entry, adopt its class.
  useEffect(() => {
    if (record) return;
    const hit = suggestions.find((s) => s.name.toLowerCase() === substance.trim().toLowerCase());
    if (hit) setSubstanceClass(hit.substance_class);
  }, [suggestions, substance, record]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        substance: substance.trim(),
        substance_class: substanceClass,
        status,
        route: route || null,
        quantity: quantity.trim() || null,
        quantity_unit: quantityUnit.trim() || null,
        frequency: frequency.trim() || null,
        started_on: startedOn || null,
        quit_on: quitOn || null,
        notes: notes.trim() || null,
      };
      return record
        ? api.patch(`/care-profiles/${profileId}/substance-use/${record.id}`, body)
        : api.post(`/care-profiles/${profileId}/substance-use`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['substance-use', profileId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save.'),
  });

  const selectClass =
    'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <Modal open onClose={onClose} title={record ? `Edit ${record.substance}` : 'Add substance'}>
      <div className="space-y-3">
        <div>
          <Input
            label="Substance"
            value={substance}
            onChange={(e) => setSubstance(e.target.value)}
            list="substance-suggestions"
            placeholder="e.g. Nicotine, Alcohol, Cannabis"
          />
          <datalist id="substance-suggestions">
            {suggestions.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Class</label>
            <select className={selectClass} value={substanceClass} onChange={(e) => setSubstanceClass(e.target.value)}>
              {SUBSTANCE_CLASSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Status</label>
            <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {SUBSTANCE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">How it is taken</label>
            <select className={selectClass} value={route} onChange={(e) => setRoute(e.target.value)}>
              <option value="">Not set</option>
              {SUBSTANCE_ROUTES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <Input label="Amount" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 15" />
          <Input label="Unit" value={quantityUnit} onChange={(e) => setQuantityUnit(e.target.value)} placeholder="e.g. cigarettes" />
        </div>

        <Input label="How often" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. daily, weekends only" />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Started" type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          <Input label="Stopped" type="date" value={quitOn} onChange={(e) => setQuitOn(e.target.value)} hint="If they have stopped" />
        </div>

        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!substance.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
