import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { AddressFields, addressFrom, addressPayload, emptyAddress, type AddressValue } from '../../components/AddressFields';
import { ImportExport } from '../../components/ImportExport';
import { DataToolbar } from '../../components/data/DataToolbar';
import { SortableTh } from '../../components/data/SortableTh';
import { useDataView, type DataSort } from '../../components/data/useDataView';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';

interface LinkedProfile {
  profile_id: string;
  profile_name: string;
  address_kind: string | null;
}

interface DirectoryAddress {
  id: string;
  account_id: string;
  label: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_suburb: string | null;
  address_state: string | null;
  address_postcode: string | null;
  address_country: string | null;
  formatted: string | null;
  linked_profiles: LinkedProfile[] | null;
}

const SORTS: DataSort<DirectoryAddress>[] = [
  { key: 'label', label: 'Label', compare: (a, b) => (a.label ?? '').localeCompare(b.label ?? '') },
  { key: 'address', label: 'Address', compare: (a, b) => (a.formatted ?? '').localeCompare(b.formatted ?? '') },
  { key: 'suburb', label: 'Suburb', compare: (a, b) => (a.address_suburb ?? '').localeCompare(b.address_suburb ?? '') },
  { key: 'profiles', label: 'Linked profiles', compare: (a, b) => (b.linked_profiles?.length ?? 0) - (a.linked_profiles?.length ?? 0) },
];

export function DirectoryAddressesPage() {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DirectoryAddress | null>(null);
  const [deleting, setDeleting] = useState<DirectoryAddress | null>(null);
  const [linking, setLinking] = useState<DirectoryAddress | null>(null);
  const [linkingAll, setLinkingAll] = useState<DirectoryAddress[]>([]);
  const [editQueue, setEditQueue] = useState<DirectoryAddress[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['directory-addresses'],
    queryFn: () => api.get<{ addresses: DirectoryAddress[]; can_edit: boolean }>('/directory/addresses'),
  });
  const addresses = data?.addresses ?? [];
  const canEdit = data?.can_edit ?? false;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['directory-addresses'] });

  const dv = useDataView<DirectoryAddress>({
    rows: addresses,
    getId: (a) => a.id,
    searchText: (a) => [a.label, a.formatted, ...(a.linked_profiles ?? []).map((lp) => lp.profile_name)].filter(Boolean).join(' '),
    sorts: SORTS,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/directory/addresses/${id}`),
    onSuccess: () => { setDeleting(null); invalidate(); },
  });
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.delete(`/directory/addresses/${id}`); },
    onSuccess: () => { dv.clearSelection(); invalidate(); },
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Address directory</h2>
          <p className="text-sm text-muted">Every address in the system. Edit one here and it updates for everyone it is linked to.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ImportExport
            basePath="/directory/addresses"
            resource="addresses"
            canImport={canEdit}
            onImported={invalidate}
            templateHeaders={['Label', 'Address line 1', 'Address line 2', 'Suburb', 'State', 'Postcode', 'Country']}
            templateSample={['Home', '1 Main St', '', 'Morayfield', 'QLD', '4506', 'Australia']}
          />
          {canEdit ? <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>Add address</Button> : null}
        </div>
      </div>

      {addresses.length > 0 ? (
        <div className="mb-4">
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search addresses…"
            sorts={SORTS}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            filters={[]}
            filterValues={dv.filterValues}
            onFilter={dv.setFilter}
            selectedCount={dv.selectedRows.length}
            bulkActions={
              canEdit
                ? [
                    { key: 'link', label: 'Link selected', onRun: () => setLinkingAll(dv.selectedRows) },
                    { key: 'edit', label: 'Edit selected', onRun: () => { const q = [...dv.selectedRows]; setEditQueue(q); setEditing(q[0] ?? null); setEditorOpen(true); } },
                    { key: 'delete', label: 'Delete selected', destructive: true, onRun: () => bulkDeleteMutation.mutate(dv.selectedRows.map((a) => a.id)) },
                  ]
                : []
            }
            onClearSelection={dv.clearSelection}
            page={dv.page}
            totalPages={dv.totalPages}
            pageSize={dv.pageSize}
            totalFiltered={dv.totalFiltered}
            onPageChange={dv.setPage}
            onPageSizeChange={dv.setPageSize}
          />
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : addresses.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No addresses in the directory yet.</p>
        </div>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No addresses match your search.</p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-left text-xs text-muted">
                {canEdit ? (
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" aria-label="Select all" className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={dv.allSelected} onChange={dv.toggleAll} />
                  </th>
                ) : null}
                <SortableTh label="Label" sortKey="label" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Address" sortKey="address" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Suburb" sortKey="suburb" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Linked to" sortKey="profiles" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                {canEdit ? <th className="px-3 py-2 w-36" /> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 align-top hover:bg-surface-2/50">
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={dv.selected.has(a.id)} onChange={() => dv.toggle(a.id)} aria-label={`Select ${a.formatted ?? a.label ?? 'address'}`} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-ink font-medium">{a.label || <span className="text-muted font-normal">-</span>}</td>
                  <td className="px-3 py-2 text-muted">{a.formatted || '-'}</td>
                  <td className="px-3 py-2 text-muted">{a.address_suburb || '-'}</td>
                  <td className="px-3 py-2">
                    {a.linked_profiles && a.linked_profiles.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {a.linked_profiles.map((lp) => (
                          <span key={lp.profile_id} className="badge bg-surface-2 text-muted text-xs">{lp.profile_name}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">Not linked</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setLinking(a)}>Link</Button>
                        <Button size="sm" variant="secondary" onClick={() => { setEditing(a); setEditorOpen(true); }}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(a)}>Delete</Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddressEditor
        open={editorOpen}
        address={editing}
        onClose={() => { setEditorOpen(false); setEditQueue([]); }}
        onSaved={() => {
          invalidate();
          const next = editQueue.slice(1);
          if (next.length > 0) { setEditQueue(next); setEditing(next[0]); }
          else { setEditQueue([]); setEditorOpen(false); dv.clearSelection(); }
        }}
      />

      <LinkDialog address={linking} onClose={() => setLinking(null)} onLinked={() => { setLinking(null); invalidate(); }} />
      <LinkAllDialog addresses={linkingAll} onClose={() => setLinkingAll([])} onLinked={() => { setLinkingAll([]); dv.clearSelection(); invalidate(); }} />

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete address">
        <p className="text-sm text-muted mb-2">
          Permanently delete <span className="font-medium text-ink">{deleting?.formatted ?? deleting?.label}</span>?
        </p>
        {deleting?.linked_profiles && deleting.linked_profiles.length > 0 ? (
          <p className="text-sm text-red-600 mb-4">
            This address is linked to {deleting.linked_profiles.length} profile{deleting.linked_profiles.length > 1 ? 's' : ''}. Deleting it removes it from all of them.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleting && deleteMutation.mutate(deleting.id)}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}

function AddressEditor({
  open,
  address,
  onClose,
  onSaved,
}: {
  open: boolean;
  address: DirectoryAddress | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState<AddressValue>(emptyAddress);
  const [error, setError] = useState('');

  useEffect(() => {
    setLabel(address?.label ?? '');
    setValue(address ? addressFrom(address) : emptyAddress);
    setError('');
  }, [address, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = { label: label.trim() || null, ...addressPayload(value) };
      return address ? api.patch(`/directory/addresses/${address.id}`, body) : api.post('/directory/addresses', body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save address'),
  });

  if (!open) return null;
  const anyPart = Object.values(value).some((s) => s.trim());
  return (
    <Modal open onClose={onClose} title={address ? 'Edit address' : 'Add address'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (anyPart) mutation.mutate(); }}>
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} hint="Optional, e.g. Mum's house" />
        <AddressFields value={value} onChange={setValue} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!anyPart}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Pick profiles to link one address to. */
function LinkDialog({ address, onClose, onLinked }: { address: DirectoryAddress | null; onClose: () => void; onLinked: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: { id: string; full_name: string }[] }>('/care-profiles/summary'),
    enabled: address !== null,
  });
  const profiles = data?.profiles ?? [];
  const linkedIds = new Set((address?.linked_profiles ?? []).map((lp) => lp.profile_id));
  useEffect(() => { setSelected(new Set()); }, [address?.id]);

  const linkMutation = useMutation({
    mutationFn: (ids: string[]) => api.post(`/directory/addresses/${address!.id}/bulk-link`, { profile_ids: ids }),
    onSuccess: onLinked,
  });
  if (!address) return null;
  const unlinked = profiles.filter((p) => !linkedIds.has(p.id));
  const toggleAll = () => setSelected(selected.size === unlinked.length ? new Set() : new Set(unlinked.map((p) => p.id)));

  return (
    <Modal open onClose={onClose} title={`Link ${address.formatted ?? 'address'} to profiles`}>
      <p className="text-sm text-muted mb-3">Select which profiles this address belongs to.</p>
      {unlinked.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">Already linked to all profiles.</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm text-ink mb-2 pb-2 border-b border-border">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={selected.size === unlinked.length} onChange={toggleAll} />
            <span className="font-medium">Select all ({unlinked.length})</span>
          </label>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {unlinked.map((p) => (
              <label key={p.id} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-surface-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={selected.has(p.id)}
                  onChange={() => { const n = new Set(selected); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); setSelected(n); }} />
                {p.full_name}
              </label>
            ))}
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={selected.size === 0} loading={linkMutation.isPending} onClick={() => linkMutation.mutate([...selected])}>
          Link to {selected.size} profile{selected.size !== 1 ? 's' : ''}
        </Button>
      </div>
    </Modal>
  );
}

/** Link several selected addresses to a set of profiles at once. */
function LinkAllDialog({ addresses, onClose, onLinked }: { addresses: DirectoryAddress[]; onClose: () => void; onLinked: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: { id: string; full_name: string }[] }>('/care-profiles/summary'),
    enabled: addresses.length > 0,
  });
  const profiles = data?.profiles ?? [];
  useEffect(() => { setSelected(new Set()); }, [addresses.length]);

  const linkMutation = useMutation({
    mutationFn: async (ids: string[]) => { for (const a of addresses) await api.post(`/directory/addresses/${a.id}/bulk-link`, { profile_ids: ids }); },
    onSuccess: onLinked,
  });
  if (addresses.length === 0) return null;
  const toggleAll = () => setSelected(selected.size === profiles.length ? new Set() : new Set(profiles.map((p) => p.id)));

  return (
    <Modal open onClose={onClose} title={`Link ${addresses.length} addresses to profiles`}>
      <p className="text-sm text-muted mb-3">Select profiles to link all {addresses.length} selected addresses to.</p>
      {profiles.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">No profiles found.</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm text-ink mb-2 pb-2 border-b border-border">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={selected.size === profiles.length} onChange={toggleAll} />
            <span className="font-medium">Select all ({profiles.length})</span>
          </label>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {profiles.map((p) => (
              <label key={p.id} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-surface-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={selected.has(p.id)}
                  onChange={() => { const n = new Set(selected); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); setSelected(n); }} />
                {p.full_name}
              </label>
            ))}
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={selected.size === 0} loading={linkMutation.isPending} onClick={() => linkMutation.mutate([...selected])}>
          Link to {selected.size} profile{selected.size !== 1 ? 's' : ''}
        </Button>
      </div>
    </Modal>
  );
}
