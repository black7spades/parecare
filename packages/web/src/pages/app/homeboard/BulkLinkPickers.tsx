import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { providerTypeLabel, type Provider } from '../../../lib/care';

/**
 * The four pickers that link a batch of selected people to one thing: a
 * provider, an address, an owner, or a carer. Each takes the ids and gives
 * back onClose and onDone, and never reads the Homeboard's state.
 */
interface DirectoryProvider extends Provider {
  account_id: string;
  linked_profiles: { profile_id: string; profile_name: string }[] | null;
}

export function BulkLinkProviderPicker({
  open,
  profileIds,
  onClose,
  onLinked,
}: {
  open: boolean;
  profileIds: string[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['directory-providers'],
    queryFn: () => api.get<{ providers: DirectoryProvider[] }>('/directory/providers'),
    enabled: open,
  });
  const providers = data?.providers ?? [];

  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedProvider(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return providers;
    const q = search.toLowerCase();
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.organisation?.toLowerCase().includes(q) ||
        providerTypeLabel(p.provider_type).toLowerCase().includes(q)
    );
  }, [providers, search]);

  const linkMutation = useMutation({
    mutationFn: () =>
      api.post(`/directory/providers/${selectedProvider}/bulk-link`, { profile_ids: profileIds }),
    onSuccess: onLinked,
  });

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Link provider to selected profiles">
      <p className="text-sm text-muted mb-3">
        Choose a provider to link to the {profileIds.length} selected profile{profileIds.length !== 1 ? 's' : ''}.
      </p>
      <input
        type="text"
        placeholder="Search providers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary mb-3"
      />
      {isLoading ? (
        <p className="text-sm text-muted py-4 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">
          {providers.length === 0 ? 'No providers in the directory yet.' : 'No providers match your search.'}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto -mx-1">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                selectedProvider === p.id
                  ? 'bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary/30'
                  : 'hover:bg-surface-2'
              }`}
              onClick={() => setSelectedProvider(p.id)}
            >
              <span className="font-medium text-ink">{p.name}</span>
              {p.organisation ? <span className="text-muted"> · {p.organisation}</span> : null}
              <span className="block text-xs text-muted">{providerTypeLabel(p.provider_type)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          disabled={!selectedProvider}
          loading={linkMutation.isPending}
          onClick={() => selectedProvider && linkMutation.mutate()}
        >
          Link to {profileIds.length} profile{profileIds.length !== 1 ? 's' : ''}
        </Button>
      </div>
    </Modal>
  );
}

interface DirectoryAddress {
  id: string;
  label: string | null;
  formatted: string | null;
}

/** Link one address in the directory to every selected profile. */
export function BulkLinkAddressPicker({
  open,
  profileIds,
  onClose,
  onDone,
}: {
  open: boolean;
  profileIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['directory-addresses'],
    queryFn: () => api.get<{ addresses: DirectoryAddress[] }>('/directory/addresses'),
    enabled: open,
  });
  const addresses = data?.addresses ?? [];

  useEffect(() => {
    if (open) {
      setSearch('');
      setSelected(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return addresses;
    const q = search.toLowerCase();
    return addresses.filter((a) => (a.formatted ?? '').toLowerCase().includes(q) || (a.label ?? '').toLowerCase().includes(q));
  }, [addresses, search]);

  const link = useMutation({
    mutationFn: () => api.post(`/directory/addresses/${selected}/bulk-link`, { profile_ids: profileIds }),
    onSuccess: onDone,
  });

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Link address to selected profiles">
      <p className="text-sm text-muted mb-3">
        Choose an address to link to the {profileIds.length} selected profile{profileIds.length !== 1 ? 's' : ''}. It becomes where they live.
      </p>
      <input
        type="text"
        placeholder="Search addresses…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary mb-3"
      />
      {isLoading ? (
        <p className="text-sm text-muted py-4 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">
          {addresses.length === 0 ? 'No addresses in the directory yet.' : 'No addresses match your search.'}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto -mx-1">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                selected === a.id ? 'bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary/30' : 'hover:bg-surface-2'
              }`}
              onClick={() => setSelected(a.id)}
            >
              <span className="font-medium text-ink">{a.formatted ?? a.label ?? 'Address'}</span>
              {a.label && a.formatted ? <span className="block text-xs text-muted">{a.label}</span> : null}
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!selected} loading={link.isPending} onClick={() => selected && link.mutate()}>
          Link to {profileIds.length} profile{profileIds.length !== 1 ? 's' : ''}
        </Button>
      </div>
    </Modal>
  );
}

interface PersonOption {
  id: string;
  full_name: string;
  preferred_name: string | null;
  kind: string;
}

/** Set one person as the owner of every selected pet. */
export function BulkLinkOwnerPicker({
  open,
  petIds,
  onClose,
  onDone,
}: {
  open: boolean;
  petIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState('');
  const { data } = useQuery({
    queryKey: ['owner-people'],
    queryFn: () => api.get<{ profiles: PersonOption[] }>('/care-profiles/summary'),
    enabled: open,
  });
  const people = (data?.profiles ?? []).filter((p) => p.kind === 'person');

  useEffect(() => {
    if (open) setSelected('');
  }, [open]);

  const save = useMutation({
    mutationFn: () => Promise.all(petIds.map((id) => api.patch(`/care-profiles/${id}`, { owner_profile_id: selected }))),
    onSuccess: onDone,
  });

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Set owner for selected pets">
      <p className="text-sm text-muted mb-3">
        Choose the person who owns the {petIds.length} selected pet{petIds.length !== 1 ? 's' : ''}.
      </p>
      <select
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Choose a person</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.preferred_name || p.full_name}
          </option>
        ))}
      </select>
      {people.length === 0 ? <p className="text-xs text-muted mt-1">Add a person first to set them as the owner.</p> : null}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!selected} loading={save.isPending} onClick={() => save.mutate()}>
          Set for {petIds.length} pet{petIds.length !== 1 ? 's' : ''}
        </Button>
      </div>
    </Modal>
  );
}

interface ContactableUserOption {
  id: string;
  display_name: string;
  email: string;
}

/**
 * Set the primary carer for every selected person. The carer can be the
 * person themselves, another person in PareCare, a platform user, or a
 * provider such as a facility or organisation. A provider is linked to each
 * profile first, so it can stand in as the contact.
 */
export function BulkLinkCarerPicker({
  open,
  personIds,
  onClose,
  onDone,
}: {
  open: boolean;
  personIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  type CarerKind = 'self' | 'profile' | 'user' | 'provider';
  const [kind, setKind] = useState<CarerKind>('self');
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    if (open) {
      setKind('self');
      setTargetId('');
    }
  }, [open]);

  const { data: peopleData } = useQuery({
    queryKey: ['owner-people'],
    queryFn: () => api.get<{ profiles: PersonOption[] }>('/care-profiles/summary'),
    enabled: open && kind === 'profile',
  });
  const people = (peopleData?.profiles ?? []).filter((p) => p.kind === 'person' && !personIds.includes(p.id));

  const { data: usersData } = useQuery({
    queryKey: ['contactable-users'],
    queryFn: () => api.get<{ users: ContactableUserOption[] }>('/care-profiles/contactable-users'),
    enabled: open && kind === 'user',
  });
  const users = usersData?.users ?? [];

  const { data: providersData } = useQuery({
    queryKey: ['directory-providers'],
    queryFn: () => api.get<{ providers: DirectoryProvider[] }>('/directory/providers'),
    enabled: open && kind === 'provider',
  });
  const providers = providersData?.providers ?? [];

  const needsTarget = kind !== 'self';

  const save = useMutation({
    mutationFn: async () => {
      // A provider must be linked to each profile before it can stand in as
      // the contact, so link it in one call first.
      if (kind === 'provider') {
        await api.post(`/directory/providers/${targetId}/bulk-link`, { profile_ids: personIds });
      }
      const body =
        kind === 'self'
          ? { contact_kind: 'self' }
          : kind === 'profile'
            ? { contact_kind: 'profile', contact_profile_id: targetId }
            : kind === 'user'
              ? { contact_kind: 'user', contact_account_id: targetId }
              : { contact_kind: 'provider', contact_provider_id: targetId };
      await Promise.all(personIds.map((id) => api.patch(`/care-profiles/${id}`, body)));
    },
    onSuccess: onDone,
  });

  if (!open) return null;

  const inputClass =
    'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <Modal open onClose={onClose} title="Set primary carer for selected people">
      <p className="text-sm text-muted mb-3">
        Choose who the care circle should contact about the {personIds.length} selected {personIds.length !== 1 ? 'people' : 'person'}.
      </p>
      <div className="space-y-3">
        <select
          className={inputClass}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as CarerKind);
            setTargetId('');
          }}
        >
          <option value="self">Themselves</option>
          <option value="profile">Another person in PareCare</option>
          <option value="user">Someone already using PareCare</option>
          <option value="provider">A facility or organisation</option>
        </select>

        {kind === 'profile' ? (
          <select className={inputClass} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose a person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.preferred_name || p.full_name}
              </option>
            ))}
          </select>
        ) : null}

        {kind === 'user' ? (
          <select className={inputClass} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose a person</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name} ({u.email})
              </option>
            ))}
          </select>
        ) : null}

        {kind === 'provider' ? (
          <select className={inputClass} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose a facility or organisation</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.organisation ? ` · ${p.organisation}` : ''}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={needsTarget && !targetId} loading={save.isPending} onClick={() => save.mutate()}>
          Set for {personIds.length} {personIds.length !== 1 ? 'people' : 'person'}
        </Button>
      </div>
    </Modal>
  );
}
