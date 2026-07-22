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
import type { Supplier } from '../../lib/care';

interface LinkedProfile {
  profile_id: string;
  profile_name: string;
}

interface DirectorySupplier extends Supplier {
  medication_count: number;
  linked_profiles: LinkedProfile[] | null;
}

const SORTS: DataSort<DirectorySupplier>[] = [
  { key: 'name', label: 'Vendor', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'suburb', label: 'Suburb', compare: (a, b) => (a.address_suburb ?? '').localeCompare(b.address_suburb ?? '') },
  { key: 'phone', label: 'Phone', compare: (a, b) => (a.phone ?? '').localeCompare(b.phone ?? '') },
  { key: 'address', label: 'Address', compare: (a, b) => (a.address ?? '').localeCompare(b.address ?? '') },
  { key: 'medications', label: 'Medications', compare: (a, b) => b.medication_count - a.medication_count },
  { key: 'profiles', label: 'Used by', compare: (a, b) => (b.linked_profiles?.length ?? 0) - (a.linked_profiles?.length ?? 0) },
];

export function DirectorySuppliersPage() {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DirectorySupplier | null>(null);
  const [deleting, setDeleting] = useState<DirectorySupplier | null>(null);
  const [bulkLinking, setBulkLinking] = useState<DirectorySupplier | null>(null);
  const [bulkLinkingIds, setBulkLinkingIds] = useState<DirectorySupplier[]>([]);
  const [bulkEditQueue, setBulkEditQueue] = useState<DirectorySupplier[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['directory-suppliers'],
    queryFn: () => api.get<{ suppliers: DirectorySupplier[]; can_edit: boolean }>('/directory/suppliers'),
  });
  const suppliers = data?.suppliers ?? [];
  const canEdit = data?.can_edit ?? false;
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['directory-suppliers'] });
    // The medication editor's picker reads the same shared list.
    void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
  };

  const dv = useDataView<DirectorySupplier>({
    rows: suppliers,
    getId: (s) => s.id,
    searchText: (s) => [s.name, s.address_suburb, s.phone, s.email, s.address, s.order_url].filter(Boolean).join(' '),
    sorts: SORTS,
    filters: [],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/directory/suppliers/${id}`),
    onSuccess: () => { setDeleting(null); invalidate(); },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.delete(`/directory/suppliers/${id}`); },
    onSuccess: () => { dv.clearSelection(); invalidate(); },
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Supplier directory</h2>
          <p className="text-sm text-muted">The pharmacies and shops your medications are reordered from. Edit details here and they update on every medication that names them.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ImportExport
            basePath="/directory/suppliers"
            resource="suppliers"
            canImport={canEdit}
            onImported={invalidate}
            templateHeaders={['Vendor', 'Phone', 'Email', 'Address line 1', 'Address line 2', 'Suburb', 'State', 'Postcode', 'Country', 'Reorder link', 'Directions']}
            templateSample={['Chemist Warehouse', '07 5555 5555', '', '2 Shop St', '', 'Morayfield', 'QLD', '4506', 'Australia', 'https://chemistwarehouse.example/reorder', 'https://maps.example/chemist']}
          />
          {canEdit ? (
            <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
              Add supplier
            </Button>
          ) : null}
        </div>
      </div>

      {suppliers.length > 0 ? (
        <div className="mb-4">
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search suppliers…"
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
                    { key: 'link', label: 'Link selected', onRun: () => setBulkLinkingIds(dv.selectedRows) },
                    { key: 'edit', label: 'Edit selected', onRun: () => { const q = [...dv.selectedRows]; setBulkEditQueue(q); setEditing(q[0] ?? null); setEditorOpen(true); } },
                    { key: 'delete', label: 'Delete selected', destructive: true, onRun: () => bulkDeleteMutation.mutate(dv.selectedRows.map((s) => s.id)) },
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
      ) : suppliers.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No suppliers in the directory yet.</p>
        </div>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No suppliers match your search.</p>
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
                <SortableTh label="Vendor" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Suburb" sortKey="suburb" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Phone" sortKey="phone" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Address" sortKey="address" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Medications" sortKey="medications" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Used by" sortKey="profiles" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                {canEdit ? <th className="px-3 py-2 w-36" /> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 align-top hover:bg-surface-2/50">
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={dv.selected.has(s.id)}
                        onChange={() => dv.toggle(s.id)}
                        aria-label={`Select ${s.name}`}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2"><span className="font-medium text-ink">{s.name}</span></td>
                  <td className="px-3 py-2 text-muted">{s.address_suburb || '-'}</td>
                  <td className="px-3 py-2">
                    {s.phone ? (
                      <a href={`tel:${s.phone}`} className="text-primary hover:underline">{s.phone}</a>
                    ) : <span className="text-muted">-</span>}
                  </td>
                  <td className="px-3 py-2 text-muted max-w-48 truncate">{s.address || '-'}</td>
                  <td className="px-3 py-2 text-muted">{s.medication_count}</td>
                  <td className="px-3 py-2">
                    {s.linked_profiles && s.linked_profiles.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {s.linked_profiles.map((lp) => (
                          <span key={lp.profile_id} className="badge bg-surface-2 text-muted text-xs">{lp.profile_name}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">Not used yet</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setBulkLinking(s)}>Link</Button>
                        <Button size="sm" variant="secondary" onClick={() => { setEditing(s); setEditorOpen(true); }}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(s)}>Delete</Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DirectorySupplierEditor
        open={editorOpen}
        supplier={editing}
        onClose={() => { setEditorOpen(false); setBulkEditQueue([]); }}
        onSaved={() => {
          invalidate();
          const next = bulkEditQueue.slice(1);
          if (next.length > 0) {
            setBulkEditQueue(next);
            setEditing(next[0]);
          } else {
            setBulkEditQueue([]);
            setEditorOpen(false);
            dv.clearSelection();
          }
        }}
      />

      <BulkLinkDialog
        supplier={bulkLinking}
        onClose={() => setBulkLinking(null)}
        onLinked={() => { setBulkLinking(null); invalidate(); }}
      />

      <BulkLinkAllDialog
        suppliers={bulkLinkingIds}
        onClose={() => setBulkLinkingIds([])}
        onLinked={() => { setBulkLinkingIds([]); dv.clearSelection(); invalidate(); }}
      />

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete supplier">
        <p className="text-sm text-muted mb-2">
          Permanently delete <span className="font-medium text-ink">{deleting?.name}</span>?
        </p>
        {deleting && deleting.medication_count > 0 ? (
          <p className="text-sm text-red-600 mb-4">
            {deleting.medication_count} medication{deleting.medication_count > 1 ? 's' : ''} name{deleting.medication_count > 1 ? '' : 's'} this supplier.
            Deleting it keeps their typed-in name but removes the link and the reorder button.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleting && deleteMutation.mutate(deleting.id)}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function BulkLinkDialog({
  supplier,
  onClose,
  onLinked,
}: {
  supplier: DirectorySupplier | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: { id: string; full_name: string }[] }>('/care-profiles/summary'),
    enabled: supplier !== null,
  });
  const profiles = data?.profiles ?? [];
  const linkedIds = new Set((supplier?.linked_profiles ?? []).map((lp) => lp.profile_id));

  useEffect(() => {
    setSelected(new Set());
  }, [supplier?.id]);

  const linkMutation = useMutation({
    mutationFn: (profileIds: string[]) =>
      api.post(`/directory/suppliers/${supplier!.id}/bulk-link`, { profile_ids: profileIds }),
    onSuccess: onLinked,
  });

  if (!supplier) return null;

  const unlinked = profiles.filter((p) => !linkedIds.has(p.id));
  const toggleAll = () => {
    if (selected.size === unlinked.length) setSelected(new Set());
    else setSelected(new Set(unlinked.map((p) => p.id)));
  };

  return (
    <Modal open onClose={onClose} title={`Link ${supplier.name} to profiles`}>
      <p className="text-sm text-muted mb-3">
        Select which profiles should have <span className="font-medium text-ink">{supplier.name}</span> linked.
      </p>
      {unlinked.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">Already linked to all profiles.</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm text-ink mb-2 pb-2 border-b border-border">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={selected.size === unlinked.length}
              onChange={toggleAll}
            />
            <span className="font-medium">Select all ({unlinked.length})</span>
          </label>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {unlinked.map((p) => (
              <label key={p.id} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-surface-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={selected.has(p.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                    setSelected(next);
                  }}
                />
                {p.full_name}
              </label>
            ))}
          </div>
        </>
      )}
      {linkedIds.size > 0 ? (
        <p className="text-xs text-muted mt-2">Already linked to: {(supplier.linked_profiles ?? []).map((lp) => lp.profile_name).join(', ')}</p>
      ) : null}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          disabled={selected.size === 0}
          loading={linkMutation.isPending}
          onClick={() => linkMutation.mutate([...selected])}
        >
          Link to {selected.size} profile{selected.size !== 1 ? 's' : ''}
        </Button>
      </div>
    </Modal>
  );
}

function DirectorySupplierEditor({
  open,
  supplier,
  onClose,
  onSaved,
}: {
  open: boolean;
  supplier: DirectorySupplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [orderUrl, setOrderUrl] = useState('');
  const [directionsLink, setDirectionsLink] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(supplier?.name ?? '');
    setPhone(supplier?.phone ?? '');
    setEmail(supplier?.email ?? '');
    setAddress(supplier ? addressFrom(supplier) : emptyAddress);
    setOrderUrl(supplier?.order_url ?? '');
    setDirectionsLink(supplier?.directions_link ?? '');
    setError('');
  }, [supplier, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        ...addressPayload(address),
        order_url: orderUrl.trim() || null,
        directions_link: directionsLink.trim() || null,
      };
      return supplier
        ? api.patch(`/directory/suppliers/${supplier.id}`, body)
        : api.post('/directory/suppliers', body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save supplier'),
  });

  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={supplier ? `Edit ${supplier.name}` : 'Add supplier'}>
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }}
      >
        <Input label="Vendor name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Chemist Warehouse" />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <AddressFields value={address} onChange={setAddress} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Reorder link" type="url" placeholder="https://…" value={orderUrl} onChange={(e) => setOrderUrl(e.target.value)} hint="Where the Order button goes to restock." />
          <Input label="Directions" type="url" placeholder="https://…" value={directionsLink} onChange={(e) => setDirectionsLink(e.target.value)} hint="A map link to the shop." />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkLinkAllDialog({
  suppliers,
  onClose,
  onLinked,
}: {
  suppliers: DirectorySupplier[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: { id: string; full_name: string }[] }>('/care-profiles/summary'),
    enabled: suppliers.length > 0,
  });
  const profiles = data?.profiles ?? [];

  useEffect(() => {
    setSelected(new Set());
  }, [suppliers.length]);

  const linkMutation = useMutation({
    mutationFn: async (profileIds: string[]) => {
      for (const s of suppliers) {
        await api.post(`/directory/suppliers/${s.id}/bulk-link`, { profile_ids: profileIds });
      }
    },
    onSuccess: onLinked,
  });

  if (suppliers.length === 0) return null;

  const toggleAll = () => {
    if (selected.size === profiles.length) setSelected(new Set());
    else setSelected(new Set(profiles.map((p) => p.id)));
  };

  return (
    <Modal open onClose={onClose} title={`Link ${suppliers.length} suppliers to profiles`}>
      <p className="text-sm text-muted mb-3">
        Select profiles to link all {suppliers.length} selected suppliers to.
      </p>
      {profiles.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">No profiles found.</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm text-ink mb-2 pb-2 border-b border-border">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={selected.size === profiles.length}
              onChange={toggleAll}
            />
            <span className="font-medium">Select all ({profiles.length})</span>
          </label>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {profiles.map((p) => (
              <label key={p.id} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-surface-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={selected.has(p.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                    setSelected(next);
                  }}
                />
                {p.full_name}
              </label>
            ))}
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          disabled={selected.size === 0}
          loading={linkMutation.isPending}
          onClick={() => linkMutation.mutate([...selected])}
        >
          Link to {selected.size} profile{selected.size !== 1 ? 's' : ''}
        </Button>
      </div>
    </Modal>
  );
}
