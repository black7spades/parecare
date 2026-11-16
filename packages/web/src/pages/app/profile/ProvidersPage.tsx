import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { addressFrom, addressPayload, emptyAddress, type AddressValue } from '../../../components/AddressFields';
import {
  OtherNamesField,
  PracticeAddress,
  PracticeMembers,
  ProviderTypeField,
  WorksAtField,
  isPlace,
  practicePayload,
  worksAtFrom,
  type WorksAtValue,
} from '../../../components/ProviderFields';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { PencilIcon, CrossIcon, LinkIcon } from '../../../components/ui/icons';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { PoaBadge } from '../../../components/PoaBadge';
import { PagePurpose } from '../../../components/PagePurpose';
import {
  KIND_WORDS,
  POA_TYPES,
  providerTypeFilterOptions,
  providerTypeLabel,
  type Provider,
  type ProviderKind,
} from '../../../lib/care';
import { useProfile } from './ProfileLayout';

const kindOf = (p: { kind?: ProviderKind }): ProviderKind => p.kind ?? 'person';
const basedAtLabel = (kind: ProviderKind) => (kind === 'organisation' ? 'Part of' : 'Based at');

const sortsFor = (kind: ProviderKind): DataSort<Provider>[] => [
  { key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'type', label: 'Type', compare: (a, b) => providerTypeLabel(a.provider_type).localeCompare(providerTypeLabel(b.provider_type)) },
  { key: 'works_at', label: basedAtLabel(kind), compare: (a, b) => (a.organisation ?? '').localeCompare(b.organisation ?? '') },
];


/**
 * The professionals and organisations involved with someone: their doctors
 * and caseworkers on one tab, the clinics and departments on the other.
 */
export function ProvidersPage() {
  const { profile, careName, canEdit } = useProfile();
  const [kind, setKind] = useState<ProviderKind>('person');
  const words = KIND_WORDS[kind];
  const SORTS = sortsFor(kind);
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [removing, setRemoving] = useState<Provider | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkEditQueue, setBulkEditQueue] = useState<Provider[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['providers', profile.id],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profile.id}/providers`),
  });
  const everything = data?.providers ?? [];
  const providers = everything.filter((p) => kindOf(p) === kind);
  const counts = {
    person: everything.filter((p) => kindOf(p) === 'person').length,
    organisation: everything.filter((p) => kindOf(p) === 'organisation').length,
  };
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['providers', profile.id] });

  // The type filter offers custom types actually in use, not just built-ins.
  const filters: DataFilter<Provider>[] = [
    {
      key: 'type',
      label: 'Type',
      options: providerTypeFilterOptions(providers, kind),
      match: (row, value) => row.provider_type === value,
    },
  ];

  const dv = useDataView<Provider>({
    rows: providers,
    getId: (p) => p.id,
    searchText: (p) => [p.name, p.organisation, p.phone, p.email, p.address, providerTypeLabel(p.provider_type)].filter(Boolean).join(' '),
    sorts: SORTS,
    filters,
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
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Contacts</h2>
            <PagePurpose kind="entry" />
          </div>
          <EditableSubheader copyKey="profile.providers.subheader" vars={{ name: careName }} />
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
              Add {words.one}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2 mb-4" role="tablist" aria-label="Professionals and organisations">
        {(['person', 'organisation'] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={kind === k ? 'secondary' : 'ghost'}
            role="tab"
            aria-selected={kind === k}
            onClick={() => {
              setKind(k);
              dv.clearSelection();
            }}
          >
            {KIND_WORDS[k].many} {counts[k] > 0 ? `(${counts[k]})` : ''}
          </Button>
        ))}
      </div>

      {providers.length > 0 ? (
        <div className="mb-4">
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder={`Search ${words.many.toLowerCase()}…`}
            sorts={SORTS}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            filters={filters}
            filterValues={dv.filterValues}
            onFilter={dv.setFilter}
            selectedCount={dv.selectedRows.length}
            bulkActions={
              canEdit
                ? [
                    { key: 'edit', label: 'Edit selected', onRun: () => { const q = [...dv.selectedRows]; setBulkEditQueue(q); setEditing(q[0] ?? null); setEditorOpen(true); } },
                    { key: 'delete', label: 'Remove selected', destructive: true, onRun: () => bulkDeleteMutation.mutate(dv.selectedRows.map((p) => p.id)) },
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
        <div className="card text-center py-10 space-y-3">
          <p className="text-sm text-ink">
            {kind === 'organisation'
              ? `No organisations recorded for ${careName} yet: their clinic, hospital, pharmacy or any government department they deal with.`
              : `No professionals recorded for ${careName} yet: their GP, specialists, lawyer or caseworker.`}
          </p>
          {canEdit ? (
            <div>
              <Button variant="secondary" onClick={() => { setEditing(null); setEditorOpen(true); }}>Add {words.one}</Button>
            </div>
          ) : null}
        </div>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No {words.many.toLowerCase()} match your search.</p>
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
                      {p.organisation ? <p className="text-xs text-muted">{basedAtLabel(kind)} {p.organisation}</p> : null}
                      {p.member_count ? (
                        <p className="text-xs text-muted">
                          {p.member_count} based here
                        </p>
                      ) : null}
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
                        size="xs"
                        variant="ghost"
                        aria-label={`Edit ${p.name}`}
                        title="Edit"
                        onClick={() => {
                          setEditing(p);
                          setEditorOpen(true);
                        }}
                      >
                        <PencilIcon />
                      </Button>
                      <Button size="xs" variant="ghost-danger" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => setRemoving(p)}>
                        <CrossIcon />
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
        kind={kind}
        profileId={profile.id}
        open={editorOpen}
        provider={editing}
        canEdit={canEdit}
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

      <ProviderPicker
        kind={kind}
        profileId={profile.id}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onLinked={() => {
          setPickerOpen(false);
          invalidate();
        }}
      />

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title={`Remove ${words.one}`}>
        <p className="text-sm text-muted mb-4">
          Remove <span className="font-medium text-ink">{removing?.name}</span> from this profile? It stays in your directory for other profiles.
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
  kind,
  profileId,
  open,
  onClose,
  onLinked,
}: {
  kind: ProviderKind;
  profileId: string;
  open: boolean;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['provider-search', profileId, kind],
    queryFn: () => api.get<{ providers: (Provider & { linked: boolean })[] }>(`/providers/search?kind=${kind}&profile_id=${profileId}`),
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
    <Modal open onClose={onClose} title={`Link an existing ${KIND_WORDS[kind].one}`}>
      <p className="text-sm text-muted mb-3">Pick one already in your directory to link to this profile.</p>
      <Input
        placeholder={`Filter ${KIND_WORDS[kind].many.toLowerCase()}…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
        {isLoading ? (
          <p className="text-sm text-muted py-4 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">
            {allProviders.length === 0 ? `No ${KIND_WORDS[kind].many.toLowerCase()} in your directory yet.` : 'Nothing matches your filter.'}
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
                <Button size="xs" variant="ghost" aria-label={`Link ${p.name}`} title="Link" loading={linkMutation.isPending} onClick={() => linkMutation.mutate(p.id)}>
                  <LinkIcon />
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
  kind: listKind,
  profileId,
  open,
  provider,
  canEdit,
  onClose,
  onSaved,
}: {
  kind: ProviderKind;
  profileId: string;
  open: boolean;
  provider: Provider | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const kind = provider ? kindOf(provider) : listKind;
  const defaultType = kind === 'organisation' ? '' : 'gp';
  const [type, setType] = useState(defaultType);
  const [name, setName] = useState('');
  const [worksAt, setWorksAt] = useState<WorksAtValue>(worksAtFrom(null));
  const [sharesAddress, setSharesAddress] = useState(true);
  const [otherNames, setOtherNames] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [bookingLink, setBookingLink] = useState('');
  const [directionsLink, setDirectionsLink] = useState('');
  const [poaType, setPoaType] = useState('');
  const [poaActivated, setPoaActivated] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setType(provider?.provider_type ?? defaultType);
    setName(provider?.name ?? '');
    setWorksAt(worksAtFrom(provider));
    setOtherNames(provider?.also_known_as ?? []);
    setSharesAddress(provider ? !!provider.uses_practice_address || !provider.organisation : true);
    setPhone(provider?.phone ?? '');
    setEmail(provider?.email ?? '');
    setAddress(provider ? addressFrom(provider) : emptyAddress);
    setBookingLink(provider?.booking_link ?? '');
    setDirectionsLink(provider?.directions_link ?? '');
    setPoaType(provider?.poa_type ?? '');
    setPoaActivated(provider?.poa_activated ?? false);
    setError('');
  }, [provider, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        kind,
        provider_type: type || 'other',
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        ...addressPayload(address),
        ...practicePayload(worksAt, sharesAddress),
        also_known_as: otherNames,
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
    onError: (err) => setError(err instanceof Error ? err.message : 'That could not be saved. Try again.'),
  });

  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={provider ? `Edit ${provider.name}` : `Add ${KIND_WORDS[kind].one}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) mutation.mutate();
        }}
      >
        <ProviderTypeField key={`type-${provider?.id ?? 'new'}`} id="provider-type" value={type} onChange={setType} kind={kind} />
        <Input
          label="Name"
          placeholder={kind === 'organisation' ? 'e.g. Health Hub Morayfield' : 'e.g. Dr Carly Examplename'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <OtherNamesField value={otherNames} onChange={setOtherNames} />
        <WorksAtField id="provider-works-at" value={worksAt} onChange={setWorksAt} excludeId={provider?.id} kind={kind} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <PracticeAddress
          worksAt={worksAt}
          sharesAddress={sharesAddress}
          onSharesAddress={setSharesAddress}
          address={address}
          onAddress={setAddress}
        />
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
      {provider && isPlace({ kind, member_count: provider.member_count }) ? (
        <div className="mt-4">
          <PracticeMembers
            basePath={`/care-profiles/${profileId}/providers/${provider.id}`}
            practiceName={provider.name}
            canEdit={canEdit}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: ['providers', profileId] })}
          />
        </div>
      ) : null}
      {!provider && kind === 'organisation' ? (
        <p className="mt-3 text-xs text-muted">Once this is saved, open it again to add who is based here.</p>
      ) : null}
    </Modal>
  );
}
