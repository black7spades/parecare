import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ImportExport } from '../../components/ImportExport';
import { DataToolbar } from '../../components/data/DataToolbar';
import { SortableTh } from '../../components/data/SortableTh';
import { useDataView, type DataSort } from '../../components/data/useDataView';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useHealthConfig } from '../../lib/appConfig';
import type { Asset } from '../../lib/care';

interface LinkedProfile {
  profile_id: string;
  profile_name: string;
}

interface DirectoryAsset extends Asset {
  linked_profiles: LinkedProfile[] | null;
}

const CONDITIONS = ['new', 'good', 'fair', 'poor', 'retired'] as const;
const CONDITION_LABEL: Record<string, string> = {
  new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor', retired: 'Retired',
};
const CATEGORY_SUGGESTIONS = ['Mobility', 'Bathroom', 'Bed', 'Monitoring', 'Respiratory', 'Daily living', 'Seating', 'Other'];

const numAsc = (n: number | null): number => (n == null ? Number.POSITIVE_INFINITY : n);

const SORTS: DataSort<DirectoryAsset>[] = [
  { key: 'name', label: 'Unit name', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'category', label: 'Category', compare: (a, b) => (a.category ?? '').localeCompare(b.category ?? '') },
  { key: 'serial', label: 'Serial or unit number', compare: (a, b) => (a.serial_number ?? '').localeCompare(b.serial_number ?? '') },
  { key: 'price', label: 'Price', compare: (a, b) => numAsc(a.price) - numAsc(b.price) },
  { key: 'purchase', label: 'Purchase date', compare: (a, b) => (a.purchase_date ?? '').localeCompare(b.purchase_date ?? '') },
  { key: 'condition', label: 'Condition', compare: (a, b) => (a.condition ?? '').localeCompare(b.condition ?? '') },
  { key: 'profiles', label: 'Used by', compare: (a, b) => (b.linked_profiles?.length ?? 0) - (a.linked_profiles?.length ?? 0) },
];

export function DirectoryAssetsPage() {
  const queryClient = useQueryClient();
  const health = useHealthConfig();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DirectoryAsset | null>(null);
  const [deleting, setDeleting] = useState<DirectoryAsset | null>(null);
  const [bulkLinking, setBulkLinking] = useState<DirectoryAsset | null>(null);
  const [bulkLinkingIds, setBulkLinkingIds] = useState<DirectoryAsset[]>([]);
  const [bulkEditQueue, setBulkEditQueue] = useState<DirectoryAsset[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['directory-assets'],
    queryFn: () => api.get<{ assets: DirectoryAsset[]; can_edit: boolean }>('/directory/assets'),
  });
  const assets = data?.assets ?? [];
  const canEdit = data?.can_edit ?? false;
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['directory-assets'] }); };

  const money = (n: number | null): string =>
    n == null ? '-' : `${health.currency_symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const dv = useDataView<DirectoryAsset>({
    rows: assets,
    getId: (a) => a.id,
    searchText: (a) => [a.name, a.category, a.serial_number, a.make_model, a.supplier, a.location, a.notes].filter(Boolean).join(' '),
    sorts: SORTS,
    filters: [],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/directory/assets/${id}`),
    onSuccess: () => { setDeleting(null); invalidate(); },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.delete(`/directory/assets/${id}`); },
    onSuccess: () => { dv.clearSelection(); invalidate(); },
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Asset directory</h2>
          <p className="text-sm text-muted">The equipment kept for the people and pets in your care: a wheelchair, a hoist, a bed, a monitor. Link each to whoever it belongs to.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ImportExport
            basePath="/directory/assets"
            resource="assets"
            canImport={canEdit}
            onImported={invalidate}
            templateHeaders={['Unit name', 'Category', 'Serial or unit number', 'Make or model', 'Price', 'Purchase date', 'Bought from', 'Warranty expiry', 'Condition', 'Location', 'Notes']}
            templateSample={['Electric hospital bed', 'Bed', 'SN-42815', 'Invacare Medley', '1450.00', '2025-03-11', 'Independence Australia', '2028-03-11', 'good', 'Main bedroom', 'Adjustable head and legs']}
          />
          {canEdit ? (
            <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
              Add asset
            </Button>
          ) : null}
        </div>
      </div>

      {assets.length > 0 ? (
        <div className="mb-4">
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search assets…"
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
      ) : assets.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No equipment in the directory yet.</p>
        </div>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No assets match your search.</p>
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
                <SortableTh label="Unit name" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Category" sortKey="category" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Serial or unit number" sortKey="serial" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Price" sortKey="price" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Purchase date" sortKey="purchase" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Condition" sortKey="condition" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Used by" sortKey="profiles" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                {canEdit ? <th className="px-3 py-2 w-36" /> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 align-top hover:bg-surface-2/50">
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={dv.selected.has(a.id)}
                        onChange={() => dv.toggle(a.id)}
                        aria-label={`Select ${a.name}`}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2"><span className="font-medium text-ink">{a.name}</span></td>
                  <td className="px-3 py-2 text-muted">{a.category || '-'}</td>
                  <td className="px-3 py-2 text-muted">{a.serial_number || '-'}</td>
                  <td className="px-3 py-2 text-muted">{money(a.price)}</td>
                  <td className="px-3 py-2 text-muted">{a.purchase_date || '-'}</td>
                  <td className="px-3 py-2 text-muted">{a.condition ? (CONDITION_LABEL[a.condition] ?? a.condition) : '-'}</td>
                  <td className="px-3 py-2">
                    {a.linked_profiles && a.linked_profiles.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {a.linked_profiles.map((lp) => (
                          <span key={lp.profile_id} className="badge bg-surface-2 text-muted text-xs">{lp.profile_name}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">Not linked yet</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setBulkLinking(a)}>Link</Button>
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

      <DirectoryAssetEditor
        open={editorOpen}
        asset={editing}
        currencySymbol={health.currency_symbol}
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
        asset={bulkLinking}
        onClose={() => setBulkLinking(null)}
        onLinked={() => { setBulkLinking(null); invalidate(); }}
      />

      <BulkLinkAllDialog
        assets={bulkLinkingIds}
        onClose={() => setBulkLinkingIds([])}
        onLinked={() => { setBulkLinkingIds([]); dv.clearSelection(); invalidate(); }}
      />

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete asset">
        <p className="text-sm text-muted mb-4">
          Permanently delete <span className="font-medium text-ink">{deleting?.name}</span>? This also removes it from anyone it is linked to.
        </p>
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
  asset,
  onClose,
  onLinked,
}: {
  asset: DirectoryAsset | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: { id: string; full_name: string }[] }>('/care-profiles/summary'),
    enabled: asset !== null,
  });
  const profiles = data?.profiles ?? [];
  const linkedIds = new Set((asset?.linked_profiles ?? []).map((lp) => lp.profile_id));

  useEffect(() => { setSelected(new Set()); }, [asset?.id]);

  const linkMutation = useMutation({
    mutationFn: (profileIds: string[]) =>
      api.post(`/directory/assets/${asset!.id}/bulk-link`, { profile_ids: profileIds }),
    onSuccess: onLinked,
  });

  if (!asset) return null;

  const unlinked = profiles.filter((p) => !linkedIds.has(p.id));
  const toggleAll = () => {
    if (selected.size === unlinked.length) setSelected(new Set());
    else setSelected(new Set(unlinked.map((p) => p.id)));
  };

  return (
    <Modal open onClose={onClose} title={`Link ${asset.name} to profiles`}>
      <p className="text-sm text-muted mb-3">
        Select which profiles should have <span className="font-medium text-ink">{asset.name}</span> linked.
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
        <p className="text-xs text-muted mt-2">Already linked to: {(asset.linked_profiles ?? []).map((lp) => lp.profile_name).join(', ')}</p>
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

function DirectoryAssetEditor({
  open,
  asset,
  currencySymbol,
  onClose,
  onSaved,
}: {
  open: boolean;
  asset: DirectoryAsset | null;
  currencySymbol: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [price, setPrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [warrantyExpiry, setWarrantyExpiry] = useState('');
  const [condition, setCondition] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(asset?.name ?? '');
    setCategory(asset?.category ?? '');
    setSerialNumber(asset?.serial_number ?? '');
    setMakeModel(asset?.make_model ?? '');
    setPrice(asset?.price != null ? String(asset.price) : '');
    setPurchaseDate(asset?.purchase_date ?? '');
    setSupplier(asset?.supplier ?? '');
    setWarrantyExpiry(asset?.warranty_expiry ?? '');
    setCondition(asset?.condition ?? '');
    setLocation(asset?.location ?? '');
    setNotes(asset?.notes ?? '');
    setError('');
  }, [asset, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        category: category.trim() || null,
        serial_number: serialNumber.trim() || null,
        make_model: makeModel.trim() || null,
        price: price.trim() === '' ? null : Number(price),
        purchase_date: purchaseDate || null,
        supplier: supplier.trim() || null,
        warranty_expiry: warrantyExpiry || null,
        condition: condition || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
      };
      return asset
        ? api.patch(`/directory/assets/${asset.id}`, body)
        : api.post('/directory/assets', body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save asset'),
  });

  if (!open) return null;
  const selectClass = 'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
  return (
    <Modal open onClose={onClose} title={asset ? `Edit ${asset.name}` : 'Add asset'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }}
      >
        <Input label="Unit name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Electric hospital bed" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} list="asset-category-options" placeholder="e.g. Mobility" />
            <datalist id="asset-category-options">
              {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <Input label="Serial or unit number" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="e.g. SN-42815" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Make or model" value={makeModel} onChange={(e) => setMakeModel(e.target.value)} placeholder="e.g. Invacare Medley" />
          <Input label={`Price (${currencySymbol})`} type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Purchase date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          <Input label="Bought from" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Independence Australia" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Warranty expiry" type="date" value={warrantyExpiry} onChange={(e) => setWarrantyExpiry(e.target.value)} />
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Condition</span>
            <select className={selectClass} value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">Not set</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
            </select>
          </label>
        </div>
        <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where it is kept, e.g. Main bedroom" />
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
  assets,
  onClose,
  onLinked,
}: {
  assets: DirectoryAsset[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: { id: string; full_name: string }[] }>('/care-profiles/summary'),
    enabled: assets.length > 0,
  });
  const profiles = data?.profiles ?? [];

  useEffect(() => { setSelected(new Set()); }, [assets.length]);

  const linkMutation = useMutation({
    mutationFn: async (profileIds: string[]) => {
      for (const a of assets) {
        await api.post(`/directory/assets/${a.id}/bulk-link`, { profile_ids: profileIds });
      }
    },
    onSuccess: onLinked,
  });

  if (assets.length === 0) return null;

  const toggleAll = () => {
    if (selected.size === profiles.length) setSelected(new Set());
    else setSelected(new Set(profiles.map((p) => p.id)));
  };

  return (
    <Modal open onClose={onClose} title={`Link ${assets.length} assets to profiles`}>
      <p className="text-sm text-muted mb-3">
        Select profiles to link all {assets.length} selected assets to.
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
