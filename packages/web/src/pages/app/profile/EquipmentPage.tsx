import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { CONTACT_LINK, ContactStrip } from '../../../components/ContactStrip';
import { useDataView, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { SortableTh } from '../../../components/data/SortableTh';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { useHealthConfig } from '../../../lib/appConfig';
import { formatDateOnly } from '../../../lib/datetime';
import { OWNERSHIP, firstName, ownershipLabel, whose } from '../../../lib/lifeEvents';
import type { Asset } from '../../../lib/care';
import { DirectoryAssetEditor } from '../DirectoryAssetsPage';
import { useProfile } from './ProfileLayout';

const byText = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').localeCompare(b ?? '');
const byDay = (a: string | null | undefined, b: string | null | undefined) => (a ?? '9999').localeCompare(b ?? '9999');
const fromName = (a: Asset) => a.supplier_contact?.name ?? a.supplier ?? '';

const SORTS: DataSort<Asset>[] = [
  { key: 'eq_name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'eq_ownership', label: 'Ownership', compare: (a, b) => byText(ownershipLabel(a.ownership), ownershipLabel(b.ownership)) },
  { key: 'eq_from', label: 'From', compare: (a, b) => byText(fromName(a), fromName(b)) },
  { key: 'eq_return', label: 'Return by', compare: (a, b) => byDay(a.return_by, b.return_by) },
  { key: 'eq_service', label: 'Service due', compare: (a, b) => byDay(a.service_due_on, b.service_due_on) },
];

/**
 * One person's equipment: what they use, whether it is theirs, on loan or
 * hired, who it came from, and when it goes back or is due a service. The
 * same records as the account's equipment register.
 */
export function EquipmentPage() {
  const { profile, canEdit, isSelf } = useProfile();
  const name = firstName(profile);
  const queryClient = useQueryClient();
  const health = useHealthConfig();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<{ asset: Asset | null; name?: string; fromTaskId?: string | null; fromJourneyItemId?: string | null } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['equipment', profile.id],
    queryFn: () => api.get<{ equipment: Asset[] }>(`/care-profiles/${profile.id}/equipment`),
  });

  // Opened from an "Equipment to get" step: the form starts with its name.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (canEdit) setEditing({ asset: null, name: params.get('name') ?? '', fromTaskId: params.get('from_task'), fromJourneyItemId: params.get('from_journey_item') });
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('new');
      next.delete('name');
      next.delete('from_task');
      next.delete('from_journey_item');
      return next;
    }, { replace: true });
  }, [params, setParams, canEdit]);

  const hidden = useHiddenIds();
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const items = (data?.equipment ?? []).filter((a) => !hidden.has(a.id));
  const panel = useRecordPanel(items, (a) => a.id);
  const ownershipFilter = {
    key: 'ownership',
    label: 'Ownership',
    options: OWNERSHIP.map((o) => ({ value: o.value, label: o.label })),
    match: (a: Asset, v: string) => a.ownership === v,
  };
  const dv = useDataView<Asset>({
    rows: items,
    getId: (a) => a.id,
    searchText: (a) => [a.name, a.category, a.make_model, fromName(a), a.notes].filter(Boolean).join(' '),
    sorts: SORTS,
    filters: [ownershipFilter],
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['equipment', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['tasks', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['directory-assets'] });
  };

  // Remove takes it off this person only; the register keeps it.
  const removeItem = (a: Asset) =>
    deferDelete({
      message: `Removed the ${a.name} from ${whose(isSelf, name)} equipment.`,
      ids: [a.id],
      commit: () => api.delete(`/care-profiles/${profile.id}/equipment/${a.id}`),
      onCommitted: invalidate,
    });

  const dueSoon = (d: string | null | undefined) => !!d && d <= format(new Date(Date.now() + 14 * 86400000), 'yyyy-MM-dd');

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink">Equipment</h2>
          <p className="text-xs text-muted">{isSelf ? 'What you use' : `What ${name} uses`}, who it came from, and when it goes back or is due a service.</p>
        </div>
        {canEdit && items.length > 0 ? <Button size="sm" onClick={() => setEditing({ asset: null })}>Add equipment</Button> : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card text-center py-10 space-y-3">
          <p className="text-sm text-ink">Wheelchairs, hoists, CPAP machines and anything on loan go here, with when it goes back.</p>
          {canEdit ? <Button onClick={() => setEditing({ asset: null })}>Add equipment</Button> : null}
        </div>
      ) : (
        <>
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search equipment…"
            sorts={SORTS.map((s) => ({ key: s.key, label: s.label }))}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            filters={[ownershipFilter].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
            filterValues={dv.filterValues}
            onFilter={dv.setFilter}
            page={dv.page}
            totalPages={dv.totalPages}
            pageSize={dv.pageSize}
            totalFiltered={dv.totalFiltered}
            onPageChange={dv.setPage}
            onPageSizeChange={dv.setPageSize}
          />
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <SortableTh label="Name" sortKey="eq_name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Ownership" sortKey="eq_ownership" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="From" sortKey="eq_from" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Return by" sortKey="eq_return" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Service due" sortKey="eq_service" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {dv.view.map((a) => (
                  <tr key={a.id} {...panel.rowProps(a.id)} className={`border-b border-border last:border-0 align-top ${RECORD_ROW_CLASS}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{a.name}</div>
                      {a.category ? <div className="text-xs text-muted">{a.category}</div> : null}
                    </td>
                    <td className="px-3 py-2">{ownershipLabel(a.ownership)}</td>
                    <td className="px-3 py-2">{fromName(a)}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${dueSoon(a.return_by) ? 'font-medium text-red-700 dark:text-red-300' : ''}`}>{formatDateOnly(a.return_by)}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${dueSoon(a.service_due_on) ? 'font-medium text-red-700 dark:text-red-300' : ''}`}>{formatDateOnly(a.service_due_on)}</td>
                    {canEdit ? (
                      <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                        <Button size="xs" variant="ghost" aria-label={`Edit ${a.name}`} title="Edit" onClick={() => setEditing({ asset: a })}><PencilIcon /></Button>
                        <Button size="xs" variant="ghost-danger" aria-label={`Remove ${a.name}`} title="Remove" onClick={() => removeItem(a)}><TrashIcon /></Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {panel.current ? (() => {
        const a = panel.current;
        return (
          <RecordPanel
            key={a.id}
            kindLabel="Equipment"
            title={a.name}
            subtitle={a.category ?? undefined}
            kind="assets"
            recordId={a.id}
            profileId={profile.id}
            canEdit={canEdit}
            fields={[
              { label: 'Ownership', value: ownershipLabel(a.ownership) },
              { label: 'Return by', value: formatDateOnly(a.return_by) },
              { label: 'Service due', value: formatDateOnly(a.service_due_on) },
              { label: 'Make or model', value: a.make_model },
              { label: 'Serial or unit number', value: a.serial_number },
              { label: 'Warranty expiry', value: formatDateOnly(a.warranty_expiry) },
              { label: 'Where it is kept', value: a.location },
              { label: 'Notes', value: a.notes },
            ]}
            links={(a.tasks ?? []).filter((t) => !t.completed).map((t) => ({ label: 'Task', value: t.title, to: `/app/${profile.id}/tasks?record=${t.id}` }))}
            onEdit={() => setEditing({ asset: a })}
            deleteLabel="Remove"
            onDelete={() => {
              removeItem(a);
              panel.close();
            }}
            onClose={panel.close}
          >
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">From</h3>
              {a.supplier_contact ? (
                <ContactStrip contact={a.supplier_contact} book={false} />
              ) : a.supplier ? (
                <p className="text-sm text-ink">{a.supplier}</p>
              ) : (
                <p className="text-sm text-muted">Who it came from is not on file yet.</p>
              )}
              <p className="mt-2 text-xs text-muted">
                Also in the <Link to={`/app/directory/assets?record=${a.id}`} className={CONTACT_LINK}>equipment register</Link>.
              </p>
            </section>
          </RecordPanel>
        );
      })() : null}

      {editing ? (
        <DirectoryAssetEditor
          open
          asset={editing.asset}
          currencySymbol={health.currency_symbol}
          profileId={profile.id}
          initialName={editing.name}
          fromTaskId={editing.fromTaskId}
          fromJourneyItemId={editing.fromJourneyItemId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
