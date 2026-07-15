import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { AddressAutocomplete } from '../../components/AddressAutocomplete';
import { DataToolbar } from '../../components/data/DataToolbar';
import { useDataView, type DataSort, type DataFilter } from '../../components/data/useDataView';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { PROVIDER_TYPES, providerTypeLabel, type Provider } from '../../lib/care';

interface LinkedProfile {
  profile_id: string;
  profile_name: string;
}

interface DirectoryProvider extends Provider {
  account_id: string;
  linked_profiles: LinkedProfile[] | null;
}

const SORTS: DataSort<DirectoryProvider>[] = [
  { key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'type', label: 'Type', compare: (a, b) => providerTypeLabel(a.provider_type).localeCompare(providerTypeLabel(b.provider_type)) },
  { key: 'profiles', label: 'Linked profiles', compare: (a, b) => (b.linked_profiles?.length ?? 0) - (a.linked_profiles?.length ?? 0) },
];

const FILTERS: DataFilter<DirectoryProvider>[] = [
  {
    key: 'type',
    label: 'Type',
    options: PROVIDER_TYPES.map((t) => ({ value: t.value, label: t.label })),
    match: (row, value) => row.provider_type === value,
  },
];

export function DirectoryProvidersPage() {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DirectoryProvider | null>(null);
  const [deleting, setDeleting] = useState<DirectoryProvider | null>(null);
  const [bulkLinking, setBulkLinking] = useState<DirectoryProvider | null>(null);
  const [bulkLinkingIds, setBulkLinkingIds] = useState<DirectoryProvider[]>([]);
  const [bulkEditQueue, setBulkEditQueue] = useState<DirectoryProvider[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['directory-providers'],
    queryFn: () => api.get<{ providers: DirectoryProvider[]; can_edit: boolean }>('/directory/providers'),
  });
  const providers = data?.providers ?? [];
  const canEdit = data?.can_edit ?? false;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['directory-providers'] });

  const dv = useDataView<DirectoryProvider>({
    rows: providers,
    getId: (p) => p.id,
    searchText: (p) => [p.name, p.organisation, p.phone, p.email, p.address, providerTypeLabel(p.provider_type)].filter(Boolean).join(' '),
    sorts: SORTS,
    filters: FILTERS,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/directory/providers/${id}`),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.delete(`/directory/providers/${id}`);
    },
    onSuccess: () => {
      dv.clearSelection();
      invalidate();
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Provider directory</h2>
          <p className="text-sm text-muted">All providers across your care profiles. Edit details here and they update everywhere.</p>
        </div>
        {canEdit ? (
          <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
            Add provider
          </Button>
        ) : null}
      </div>

      {providers.length > 0 ? (
        <div className="mb-4">
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search providers…"
            sorts={SORTS}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            filters={FILTERS}
            filterValues={dv.filterValues}
            onFilter={dv.setFilter}
            selectedCount={dv.selectedRows.length}
            bulkActions={
              canEdit
                ? [
                    { key: 'link', label: 'Link selected', onRun: () => setBulkLinkingIds(dv.selectedRows) },
                    { key: 'edit', label: 'Edit selected', onRun: () => { const q = [...dv.selectedRows]; setBulkEditQueue(q); setEditing(q[0] ?? null); setEditorOpen(true); } },
                    { key: 'delete', label: 'Delete selected', destructive: true, onRun: () => bulkDeleteMutation.mutate(dv.selectedRows.map((p) => p.id)) },
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
      ) : providers.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No providers in the directory yet.</p>
        </div>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No providers match your search.</p>
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
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 font-medium">Linked to</th>
                {canEdit ? <th className="px-3 py-2 w-36" /> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 align-top hover:bg-surface-2/50">
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={dv.selected.has(p.id)}
                        onChange={() => dv.toggle(p.id)}
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <span className="font-medium text-ink">{p.name}</span>
                    {p.organisation ? <span className="block text-xs text-muted">{p.organisation}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-muted">{providerTypeLabel(p.provider_type)}</td>
                  <td className="px-3 py-2">
                    {p.phone ? (
                      <a href={`tel:${p.phone}`} className="text-primary hover:underline">{p.phone}</a>
                    ) : <span className="text-muted">-</span>}
                  </td>
                  <td className="px-3 py-2 text-muted max-w-48 truncate">{p.address || '-'}</td>
                  <td className="px-3 py-2">
                    {p.linked_profiles && p.linked_profiles.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {p.linked_profiles.map((lp) => (
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
                        <Button size="sm" variant="secondary" onClick={() => setBulkLinking(p)}>Link</Button>
                        <Button size="sm" variant="secondary" onClick={() => { setEditing(p); setEditorOpen(true); }}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>Delete</Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DirectoryProviderEditor
        open={editorOpen}
        provider={editing}
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
        provider={bulkLinking}
        onClose={() => setBulkLinking(null)}
        onLinked={() => { setBulkLinking(null); invalidate(); }}
      />

      <BulkLinkAllDialog
        providers={bulkLinkingIds}
        onClose={() => setBulkLinkingIds([])}
        onLinked={() => { setBulkLinkingIds([]); dv.clearSelection(); invalidate(); }}
      />

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete provider">
        <p className="text-sm text-muted mb-2">
          Permanently delete <span className="font-medium text-ink">{deleting?.name}</span>?
        </p>
        {deleting?.linked_profiles && deleting.linked_profiles.length > 0 ? (
          <p className="text-sm text-red-600 mb-4">
            This provider is linked to {deleting.linked_profiles.length} profile{deleting.linked_profiles.length > 1 ? 's' : ''}.
            Deleting it will remove it from all of them.
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
  provider,
  onClose,
  onLinked,
}: {
  provider: DirectoryProvider | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: { id: string; full_name: string }[] }>('/care-profiles/summary'),
    enabled: provider !== null,
  });
  const profiles = data?.profiles ?? [];
  const linkedIds = new Set((provider?.linked_profiles ?? []).map((lp) => lp.profile_id));

  useEffect(() => {
    setSelected(new Set());
  }, [provider?.id]);

  const linkMutation = useMutation({
    mutationFn: (profileIds: string[]) =>
      api.post(`/directory/providers/${provider!.id}/bulk-link`, { profile_ids: profileIds }),
    onSuccess: onLinked,
  });

  if (!provider) return null;

  const unlinked = profiles.filter((p) => !linkedIds.has(p.id));
  const toggleAll = () => {
    if (selected.size === unlinked.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(unlinked.map((p) => p.id)));
    }
  };

  return (
    <Modal open onClose={onClose} title={`Link ${provider.name} to profiles`}>
      <p className="text-sm text-muted mb-3">
        Select which profiles should have <span className="font-medium text-ink">{provider.name}</span> linked.
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
        <p className="text-xs text-muted mt-2">Already linked to: {(provider.linked_profiles ?? []).map((lp) => lp.profile_name).join(', ')}</p>
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

function DirectoryProviderEditor({
  open,
  provider,
  onClose,
  onSaved,
}: {
  open: boolean;
  provider: DirectoryProvider | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState('gp');
  const [customType, setCustomType] = useState('');
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [bookingLink, setBookingLink] = useState('');
  const [directionsLink, setDirectionsLink] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const pt = provider?.provider_type ?? 'gp';
    const isKnown = PROVIDER_TYPES.some((t) => t.value === pt);
    setType(isKnown ? pt : 'other');
    setCustomType(isKnown ? '' : pt);
    setName(provider?.name ?? '');
    setOrganisation(provider?.organisation ?? '');
    setPhone(provider?.phone ?? '');
    setEmail(provider?.email ?? '');
    setAddress(provider?.address ?? '');
    setBookingLink(provider?.booking_link ?? '');
    setDirectionsLink(provider?.directions_link ?? '');
    setError('');
  }, [provider, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        provider_type: type === 'other' && customType.trim() ? customType.trim() : type,
        name: name.trim(),
        organisation: organisation.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        booking_link: bookingLink.trim() || null,
        directions_link: directionsLink.trim() || null,
      };
      return provider
        ? api.patch(`/directory/providers/${provider.id}`, body)
        : api.post('/directory/providers', body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save provider'),
  });

  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={provider ? `Edit ${provider.name}` : 'Add provider'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) mutation.mutate();
        }}
      >
        <div>
          <label htmlFor="dir-provider-type" className="block text-sm font-medium text-ink mb-1">Type</label>
          <select
            id="dir-provider-type"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {PROVIDER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {type === 'other' ? (
            <Input
              label="Custom type"
              placeholder="e.g. Naturopath, Osteopath"
              value={customType}
              onChange={(e) => setCustomType(e.target.value)}
              className="mt-2"
            />
          ) : null}
        </div>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Organisation" value={organisation} onChange={(e) => setOrganisation(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <AddressAutocomplete label="Address" value={address} onChange={setAddress} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Booking link" type="url" placeholder="https://…" value={bookingLink} onChange={(e) => setBookingLink(e.target.value)} />
          <Input label="Directions" type="url" placeholder="https://…" value={directionsLink} onChange={(e) => setDirectionsLink(e.target.value)} />
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
  providers,
  onClose,
  onLinked,
}: {
  providers: DirectoryProvider[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: { id: string; full_name: string }[] }>('/care-profiles/summary'),
    enabled: providers.length > 0,
  });
  const profiles = data?.profiles ?? [];

  useEffect(() => {
    setSelected(new Set());
  }, [providers.length]);

  const linkMutation = useMutation({
    mutationFn: async (profileIds: string[]) => {
      for (const p of providers) {
        await api.post(`/directory/providers/${p.id}/bulk-link`, { profile_ids: profileIds });
      }
    },
    onSuccess: onLinked,
  });

  if (providers.length === 0) return null;

  const toggleAll = () => {
    if (selected.size === profiles.length) setSelected(new Set());
    else setSelected(new Set(profiles.map((p) => p.id)));
  };

  return (
    <Modal open onClose={onClose} title={`Link ${providers.length} providers to profiles`}>
      <p className="text-sm text-muted mb-3">
        Select profiles to link all {providers.length} selected providers to.
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
