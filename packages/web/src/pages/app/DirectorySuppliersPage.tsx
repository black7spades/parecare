import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { DataToolbar } from '../../components/data/DataToolbar';
import { SortableTh } from '../../components/data/SortableTh';
import { useDataView, type DataSort } from '../../components/data/useDataView';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import type { Supplier } from '../../lib/care';

interface UsedByProfile {
  profile_id: string;
  profile_name: string;
}

interface DirectorySupplier extends Supplier {
  medication_count: number;
  linked_profiles: UsedByProfile[] | null;
}

const SORTS: DataSort<DirectorySupplier>[] = [
  { key: 'name', label: 'Vendor', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'suburb', label: 'Suburb', compare: (a, b) => (a.suburb ?? '').localeCompare(b.suburb ?? '') },
  { key: 'phone', label: 'Phone', compare: (a, b) => (a.phone ?? '').localeCompare(b.phone ?? '') },
  { key: 'medications', label: 'Medications', compare: (a, b) => b.medication_count - a.medication_count },
];

export function DirectorySuppliersPage() {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DirectorySupplier | null>(null);
  const [deleting, setDeleting] = useState<DirectorySupplier | null>(null);
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
    searchText: (s) => [s.name, s.suburb, s.phone, s.order_url].filter(Boolean).join(' '),
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Supplier directory</h2>
          <p className="text-sm text-muted">The pharmacies and shops your medications are reordered from. Edit details here and they update on every medication that names them.</p>
        </div>
        {canEdit ? (
          <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
            Add supplier
          </Button>
        ) : null}
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
                <th className="px-3 py-2">Reorder link</th>
                <SortableTh label="Medications" sortKey="medications" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <th className="px-3 py-2">Used by</th>
                {canEdit ? <th className="px-3 py-2 w-24" /> : null}
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
                  <td className="px-3 py-2 text-muted">{s.suburb || '-'}</td>
                  <td className="px-3 py-2">
                    {s.phone ? (
                      <a href={`tel:${s.phone}`} className="text-primary hover:underline">{s.phone}</a>
                    ) : <span className="text-muted">-</span>}
                  </td>
                  <td className="px-3 py-2">
                    {s.order_url ? (
                      <a href={s.order_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Reorder</a>
                    ) : <span className="text-muted">-</span>}
                  </td>
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
  const [suburb, setSuburb] = useState('');
  const [phone, setPhone] = useState('');
  const [orderUrl, setOrderUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(supplier?.name ?? '');
    setSuburb(supplier?.suburb ?? '');
    setPhone(supplier?.phone ?? '');
    setOrderUrl(supplier?.order_url ?? '');
    setError('');
  }, [supplier, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        suburb: suburb.trim() || null,
        phone: phone.trim() || null,
        order_url: orderUrl.trim() || null,
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
        <Input label="Suburb" value={suburb} onChange={(e) => setSuburb(e.target.value)} placeholder="e.g. Morayfield" hint="Tells apart two branches of the same vendor." />
        <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 07 5555 5555" />
        <Input label="Reorder link" type="url" inputMode="url" placeholder="https://…" value={orderUrl} onChange={(e) => setOrderUrl(e.target.value)} hint="Where the Order button goes to restock." />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
