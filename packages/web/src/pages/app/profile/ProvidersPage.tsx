import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { AddressAutocomplete } from '../../../components/AddressAutocomplete';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { PoaBadge } from '../../../components/PoaBadge';
import { PROVIDER_TYPES, POA_TYPES, providerTypeLabel, type Provider } from '../../../lib/care';
import { useProfile } from './ProfileLayout';

const SORTS: DataSort<Provider>[] = [
  { key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'type', label: 'Type', compare: (a, b) => providerTypeLabel(a.provider_type).localeCompare(providerTypeLabel(b.provider_type)) },
];

const FILTERS: DataFilter<Provider>[] = [
  {
    key: 'type',
    label: 'Type',
    options: PROVIDER_TYPES.map((t) => ({ value: t.value, label: t.label })),
    match: (row, value) => row.provider_type === value,
  },
];

export function ProvidersPage() {
  const { profile, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [removing, setRemoving] = useState<Provider | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['providers', profile.id],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profile.id}/providers`),
  });
  const providers = data?.providers ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['providers', profile.id] });

  const dv = useDataView<Provider>({
    rows: providers,
    getId: (p) => p.id,
    searchText: (p) => [p.name, p.organisation, p.phone, p.email, p.address, providerTypeLabel(p.provider_type)].filter(Boolean).join(' '),
    sorts: SORTS,
    filters: FILTERS,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/providers/${id}`),
    onSuccess: () => {
      setRemoving(null);
      invalidate();
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.delete(`/care-profiles/${profile.id}/providers/${id}`);
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
          <h2 className="text-base font-semibold text-ink">Care providers</h2>
          <p className="text-sm text-muted">Doctors, facilities and services involved in care, with contact details in one place.</p>
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPickerOpen(true)}>
              Link existing
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              Add provider
            </Button>
          </div>
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
                ? [{ key: 'delete', label: 'Remove selected', destructive: true, onRun: () => bulkDeleteMutation.mutate(dv.selectedRows.map((p) => p.id)) }]
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
          <p className="text-sm text-muted">No providers recorded yet.</p>
        </div>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No providers match your search.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {dv.view.map((p) => (
            <div key={p.id} className="card">
              <div className="flex items-start gap-2">
                {canEdit ? (
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={dv.selected.has(p.id)}
                    onChange={() => dv.toggle(p.id)}
                    aria-label={`Select ${p.name}`}
                  />
                ) : null}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{p.name}</h3>
                      {p.organisation ? <p className="text-xs text-muted">{p.organisation}</p> : null}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="badge bg-surface-2 text-muted text-xs">{providerTypeLabel(p.provider_type)}</span>
                      {p.poa_type ? <PoaBadge type={p.poa_type} activated={p.poa_activated} /> : null}
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    {p.phone ? (
                      <p>
                        <a href={`tel:${p.phone}`} className="text-primary hover:underline">
                          {p.phone}
                        </a>
                      </p>
                    ) : null}
                    {p.email ? (
                      <p>
                        <a href={`mailto:${p.email}`} className="text-primary hover:underline">
                          {p.email}
                        </a>
                      </p>
                    ) : null}
                    {p.address ? <p className="text-muted text-xs">{p.address}</p> : null}
                    {p.booking_link || p.directions_link ? (
                      <div className="flex flex-wrap gap-3 mt-1">
                        {p.booking_link ? (
                          <a href={p.booking_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                            Book appointment
                          </a>
                        ) : null}
                        {p.directions_link ? (
                          <a href={p.directions_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                            Get directions
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditing(p);
                          setEditorOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProviderEditor
        profileId={profile.id}
        open={editorOpen}
        provider={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          invalidate();
        }}
      />

      <ProviderPicker
        profileId={profile.id}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onLinked={() => {
          setPickerOpen(false);
          invalidate();
        }}
      />

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remove provider">
        <p className="text-sm text-muted mb-4">
          Remove <span className="font-medium text-ink">{removing?.name}</span> from this profile? The provider stays in your account directory for other profiles.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={removeMutation.isPending} onClick={() => removing && removeMutation.mutate(removing.id)}>
            Remove
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ProviderPicker({
  profileId,
  open,
  onClose,
  onLinked,
}: {
  profileId: string;
  open: boolean;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['provider-search', profileId],
    queryFn: () => api.get<{ providers: (Provider & { linked: boolean })[] }>(`/providers/search?profile_id=${profileId}`),
    enabled: open,
  });
  const allProviders = data?.providers ?? [];
  const filtered = search
    ? allProviders.filter((p) => `${p.name} ${p.organisation ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    : allProviders;

  const linkMutation = useMutation({
    mutationFn: (providerId: string) => api.post(`/care-profiles/${profileId}/providers`, { provider_id: providerId }),
    onSuccess: onLinked,
  });

  if (!open) return null;
  return (
    <Modal open onClose={onClose} title="Link an existing provider">
      <p className="text-sm text-muted mb-3">Pick a provider already in your account to link to this profile.</p>
      <Input
        placeholder="Filter providers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
        {isLoading ? (
          <p className="text-sm text-muted py-4 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">
            {allProviders.length === 0 ? 'No providers in your account yet.' : 'No providers match your filter.'}
          </p>
        ) : (
          filtered.map((p) => (
            <div key={p.id} className="flex items-center justify-between p-2 rounded-md hover:bg-surface-2">
              <div>
                <span className="text-sm font-medium text-ink">{p.name}</span>
                {p.organisation ? <span className="text-xs text-muted ml-1">at {p.organisation}</span> : null}
                <span className="ml-2 text-xs text-muted">{providerTypeLabel(p.provider_type)}</span>
              </div>
              {p.linked ? (
                <span className="text-xs text-muted">Already linked</span>
              ) : (
                <Button size="sm" variant="secondary" loading={linkMutation.isPending} onClick={() => linkMutation.mutate(p.id)}>
                  Link
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      <div className="flex justify-end mt-4">
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

function ProviderEditor({
  profileId,
  open,
  provider,
  onClose,
  onSaved,
}: {
  profileId: string;
  open: boolean;
  provider: Provider | null;
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
  const [poaType, setPoaType] = useState('');
  const [poaActivated, setPoaActivated] = useState(false);
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
    setPoaType(provider?.poa_type ?? '');
    setPoaActivated(provider?.poa_activated ?? false);
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
        poa_type: poaType || null,
        poa_activated: poaType ? poaActivated : false,
      };
      return provider
        ? api.patch(`/care-profiles/${profileId}/providers/${provider.id}`, body)
        : api.post(`/care-profiles/${profileId}/providers`, body);
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
          <label htmlFor="provider-type" className="block text-sm font-medium text-ink mb-1">
            Type
          </label>
          <select
            id="provider-type"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {PROVIDER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
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
        <div className="rounded-md border border-border p-3 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={poaType !== ''}
              onChange={(e) => {
                if (e.target.checked) {
                  setPoaType('enduring');
                } else {
                  setPoaType('');
                  setPoaActivated(false);
                }
              }}
            />
            Holds power of attorney
          </label>
          {poaType !== '' ? (
            <>
              <select
                aria-label="Power of attorney type"
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={poaType}
                onChange={(e) => setPoaType(e.target.value)}
              >
                {POA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={poaActivated}
                  onChange={(e) => setPoaActivated(e.target.checked)}
                />
                Activated (in effect now)
              </label>
            </>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
