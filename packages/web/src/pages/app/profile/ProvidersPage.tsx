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
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
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
                ? [{ key: 'delete', label: 'Remove selected', destructive: true, onRun: () => bulkDeleteMutation.mutate(dv.selectedRows.map((p) => p.id)) }]
                : []
            }
            onClearSelection={dv.clearSelection}
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

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remove provider">
        <p className="text-sm text-muted mb-4">
          Remove <span className="font-medium text-ink">{removing?.name}</span> from the provider list?
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
    setType(provider?.provider_type ?? 'gp');
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
        provider_type: type,
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
