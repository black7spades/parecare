import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { TrashIcon } from './ui/icons';
import { PhoneLink } from './cards/profile/links';
import { usePickablePeople } from './PersonPicker';
import { useDataView, type DataSort } from './data/useDataView';
import { DataToolbar } from './data/DataToolbar';
import { SortableTh } from './data/SortableTh';
import {
  EMERGENCY_RELATIONSHIPS,
  inverseRelationship,
  personKey,
  providerTypeLabel,
  type EmergencyContact,
  type PickablePerson,
  type Provider,
} from '../lib/care';

const SELECT =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export const emergencyKey = (profileId: string) => ['emergency-contacts', profileId] as const;

/** Who to call in an emergency for one person, from the server. */
export function useEmergencyContacts(profileId: string) {
  return useQuery({
    queryKey: emergencyKey(profileId),
    queryFn: () => api.get<{ contacts: EmergencyContact[] }>(`/care-profiles/${profileId}/emergency-contacts`),
  });
}

type Choice =
  | { kind: 'person'; person: PickablePerson }
  | { kind: 'contact'; provider: Provider }
  | { kind: 'typed' };

/**
 * Add someone to call: "You" first, then people in the care circle, then
 * their contacts, then someone not in PareCare. Their phone is read from
 * their own record; when they have none, the "Their phone" box saves it
 * there, so it changes everywhere.
 */
export function EmergencyContactAdd({
  profileId,
  ownerRelationship,
  onAdded,
  onCancel,
  first = false,
}: {
  profileId: string;
  /** What the person is to the account holder, e.g. Mother, to work out what the holder is to them. */
  ownerRelationship?: string | null;
  onAdded?: () => void;
  onCancel?: () => void;
  first?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: peopleData } = usePickablePeople(profileId);
  const { data: providerData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
  });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ id: string; gender: string | null }>('/auth/me') });
  const people = peopleData?.people ?? [];
  const you = people.filter((p) => p.label === 'You');
  const circle = people.filter((p) => p.label !== 'You');
  const contacts = (providerData?.providers ?? []).filter((p) => !p.ended_on);

  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [missing, setMissing] = useState('');
  const [error, setError] = useState('');

  const choice: Choice | null = useMemo(() => {
    if (pick === 'typed') return { kind: 'typed' };
    if (pick.startsWith('p:')) {
      const person = people.find((p) => personKey(p.ref) === pick.slice(2));
      return person ? { kind: 'person', person } : null;
    }
    if (pick.startsWith('c:')) {
      const provider = contacts.find((p) => p.id === pick.slice(2));
      return provider ? { kind: 'contact', provider } : null;
    }
    return null;
  }, [pick, people, contacts]);
  const onFilePhone = choice?.kind === 'person' ? choice.person.phone : choice?.kind === 'contact' ? choice.provider.phone : null;

  const choose = (value: string) => {
    setPick(value);
    setMissing('');
    setPhone('');
    // What they are to the person, where it is clear.
    if (value.startsWith('p:')) {
      const person = people.find((p) => personKey(p.ref) === value.slice(2));
      if (person?.label === 'You') setRelationship(inverseRelationship(ownerRelationship, me?.gender) ?? '');
      else setRelationship(inverseRelationship(person?.label ?? null) ?? '');
    } else if (value.startsWith('c:')) {
      const provider = contacts.find((p) => p.id === value.slice(2));
      setRelationship(provider ? providerTypeLabel(provider.provider_type) : '');
    } else setRelationship('');
  };

  const add = useMutation({
    mutationFn: () => {
      const ref =
        choice?.kind === 'person'
          ? choice.person.ref
          : choice?.kind === 'contact'
            ? { provider_id: choice.provider.id }
            : { name: name.trim(), phone: phone.trim() };
      return api.post(`/care-profiles/${profileId}/emergency-contacts`, {
        ref,
        relationship: relationship.trim() || null,
        phone: choice?.kind === 'typed' ? null : phone.trim() || null,
        first,
      });
    },
    onSuccess: () => {
      setPick('');
      setName('');
      setRelationship('');
      setPhone('');
      setError('');
      void queryClient.invalidateQueries({ queryKey: emergencyKey(profileId) });
      void queryClient.invalidateQueries({ queryKey: ['circle-people', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['care-plan', profileId] });
      onAdded?.();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'That emergency contact was not saved. Try again.'),
  });

  const submit = () => {
    // Add always answers: name the boxes still to fill and go to the first.
    const gaps: Array<[string, string]> = [];
    if (!choice) gaps.push(['who to call', 'emergency-who']);
    if (choice?.kind === 'typed' && !name.trim()) gaps.push(['their name', 'emergency-name']);
    if (choice && !onFilePhone && !phone.trim()) gaps.push(['their phone', 'emergency-phone']);
    if (gaps.length) {
      setMissing(`Add ${gaps.map((g) => g[0]).join(' and ')}, then add them.`);
      document.getElementById(gaps[0]![1])?.focus();
      return;
    }
    setMissing('');
    add.mutate();
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="emergency-who" className="block text-sm font-medium text-ink mb-1">Who to call</label>
          <select id="emergency-who" className={SELECT} value={pick} onChange={(e) => choose(e.target.value)}>
            <option value="">Choose who to call</option>
            {you.length > 0 ? (
              <optgroup label="You">
                {you.map((p) => (
                  <option key={personKey(p.ref)} value={`p:${personKey(p.ref)}`}>You, {p.name}</option>
                ))}
              </optgroup>
            ) : null}
            {circle.length > 0 ? (
              <optgroup label="People in the care circle">
                {circle.map((p) => (
                  <option key={personKey(p.ref)} value={`p:${personKey(p.ref)}`}>
                    {p.name}
                    {p.label ? `, ${p.label}` : ''}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {contacts.length > 0 ? (
              <optgroup label="Contacts">
                {contacts.map((p) => (
                  <option key={p.id} value={`c:${p.id}`}>
                    {p.name}, {providerTypeLabel(p.provider_type)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="Someone not in PareCare">
              <option value="typed">Someone not in PareCare</option>
            </optgroup>
          </select>
        </div>
        {choice?.kind === 'typed' ? (
          <Input id="emergency-name" label="Their name" value={name} onChange={(e) => setName(e.target.value)} />
        ) : null}
        <div>
          <Input
            id="emergency-relationship"
            label="Relationship"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            list="emergency-relationships"
            placeholder="e.g. Daughter"
            hint="What they are to this person."
          />
          <datalist id="emergency-relationships">
            {EMERGENCY_RELATIONSHIPS.map((r) => <option key={r} value={r} />)}
          </datalist>
        </div>
        {choice && onFilePhone ? (
          <p className="text-sm text-ink self-end pb-2">
            <span className="text-muted">Phone </span>
            <PhoneLink phone={onFilePhone} />
          </p>
        ) : choice ? (
          <Input
            id="emergency-phone"
            label="Their phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            hint={choice.kind === 'typed' ? undefined : 'Saved on their own record, so it changes everywhere.'}
          />
        ) : null}
      </div>
      {missing ? <p className="text-sm text-red-600" role="alert">{missing}</p> : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button> : null}
        <Button type="button" variant="secondary" loading={add.isPending} onClick={submit}>Add</Button>
      </div>
    </div>
  );
}

const SORTS: DataSort<EmergencyContact>[] = [
  { key: 'order', label: 'Who to call first', compare: (a, b) => a.sort_order - b.sort_order },
  { key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'relationship', label: 'Relationship', compare: (a, b) => (a.relationship ?? '').localeCompare(b.relationship ?? '') },
  { key: 'phone', label: 'Phone', compare: (a, b) => (a.phone ?? '').localeCompare(b.phone ?? '') },
];

/**
 * Who to call in an emergency: a sortable list of people picked by
 * reference, with arrows to set who to call first. With nobody chosen it
 * shows the worked-out default, with Change.
 */
export function EmergencyContactsEditor({
  profileId,
  canEdit,
  ownerRelationship,
}: {
  profileId: string;
  canEdit: boolean;
  ownerRelationship?: string | null;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useEmergencyContacts(profileId);
  const contacts = data?.contacts ?? [];
  const chosen = contacts.filter((c) => !c.inferred);
  const inferred = contacts.find((c) => c.inferred) ?? null;
  const [adding, setAdding] = useState(false);
  const [phoneFor, setPhoneFor] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [error, setError] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: emergencyKey(profileId) });
    void queryClient.invalidateQueries({ queryKey: ['circle-people', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['care-plan', profileId] });
  };
  const failed = (err: unknown) => setError(err instanceof Error ? err.message : 'That change was not saved. Try again.');

  const remove = useMutation({
    mutationFn: (rowId: string) => api.delete(`/care-profiles/${profileId}/emergency-contacts/${rowId}`),
    onSuccess: () => { setError(''); refresh(); },
    onError: failed,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.patch(`/care-profiles/${profileId}/emergency-contacts/order`, { ids }),
    onSuccess: () => { setError(''); refresh(); },
    onError: failed,
  });
  const savePhone = useMutation({
    mutationFn: ({ rowId, phone }: { rowId: string; phone: string }) =>
      api.patch(`/care-profiles/${profileId}/emergency-contacts/${rowId}`, { phone }),
    onSuccess: () => { setError(''); setPhoneFor(null); setPhoneDraft(''); refresh(); },
    onError: failed,
  });
  // Keeping the worked-out contact makes it a chosen one, as it is.
  const keep = useMutation({
    mutationFn: (c: EmergencyContact) => {
      const ref =
        c.source === 'account' ? { account_id: c.id } : c.source === 'circle' ? { circle_member_id: c.id } : c.source === 'contact' ? { provider_id: c.id } : { name: c.name, phone: c.phone };
      return api.post(`/care-profiles/${profileId}/emergency-contacts`, { ref, relationship: c.relationship });
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: failed,
  });

  const dv = useDataView<EmergencyContact>({
    rows: chosen,
    getId: (c) => c.row_id ?? c.name,
    searchText: (c) => [c.name, c.relationship, c.phone].filter(Boolean).join(' '),
    sorts: SORTS,
    defaultPageSize: 25,
  });

  const ordered = [...chosen].sort((a, b) => a.sort_order - b.sort_order);
  const move = (rowId: string, by: -1 | 1) => {
    const ids = ordered.map((c) => c.row_id!);
    const i = ids.indexOf(rowId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {chosen.length === 0 ? (
        inferred ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm">
            <span className="text-ink">
              {inferred.name}
              {inferred.relationship ? `, ${inferred.relationship.toLowerCase()}` : ''}.{' '}
              <span className="text-muted">Worked out from the profile.</span>
            </span>
            {inferred.phone ? <PhoneLink phone={inferred.phone} /> : <span className="text-xs text-muted">No phone yet.</span>}
            {canEdit ? (
              <span className="ml-auto flex gap-1">
                <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>Change</Button>
                <Button size="xs" variant="secondary" loading={keep.isPending} onClick={() => keep.mutate(inferred)}>Keep</Button>
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted">No emergency contact chosen yet.</p>
            {canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Choose who to call</Button> : null}
          </div>
        )
      ) : (
        <>
          {chosen.length > 5 ? (
            <DataToolbar
              search={dv.search}
              onSearch={dv.setSearch}
              searchPlaceholder="Search emergency contacts…"
              sorts={SORTS.map((s) => ({ key: s.key, label: s.label }))}
              sortKey={dv.sortKey}
              onSort={dv.setSortKey}
            />
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <SortableTh label="Order" sortKey="order" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="w-16" />
                  <SortableTh label="Name" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Relationship" sortKey="relationship" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Phone" sortKey="phone" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  {canEdit ? <th className="px-3 py-2 w-28"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dv.view.map((c) => {
                  const place = ordered.findIndex((o) => o.row_id === c.row_id);
                  return (
                    <tr key={c.row_id ?? c.name}>
                      <td className="px-3 py-2 text-muted">{place + 1}</td>
                      <td className="px-3 py-2 font-medium text-ink">
                        {c.name}
                        {c.source === 'account' && c.role_label ? <span className="ml-1 text-xs font-normal text-muted">{c.role_label}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-ink">{c.relationship ?? ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {c.phone ? (
                          <PhoneLink phone={c.phone} />
                        ) : phoneFor === c.row_id ? (
                          <span className="flex items-center gap-1">
                            <Input aria-label={`Phone for ${c.name}`} type="tel" value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} className="w-36" />
                            <Button
                              size="xs"
                              variant="secondary"
                              loading={savePhone.isPending}
                              onClick={() => {
                                if (!phoneDraft.trim()) {
                                  setError(`Write ${c.name}'s phone, then save.`);
                                  return;
                                }
                                savePhone.mutate({ rowId: c.row_id!, phone: phoneDraft.trim() });
                              }}
                            >
                              Save
                            </Button>
                          </span>
                        ) : canEdit ? (
                          <Button size="xs" variant="ghost" onClick={() => { setPhoneFor(c.row_id); setPhoneDraft(''); }}>Add their phone</Button>
                        ) : (
                          <span className="text-xs text-muted">No phone yet.</span>
                        )}
                      </td>
                      {canEdit ? (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <Button size="xs" variant="ghost" aria-label={`Call ${c.name} earlier`} title="Call earlier" disabled={place <= 0} onClick={() => move(c.row_id!, -1)}>↑</Button>
                          <Button size="xs" variant="ghost" aria-label={`Call ${c.name} later`} title="Call later" disabled={place >= ordered.length - 1} onClick={() => move(c.row_id!, 1)}>↓</Button>
                          <Button size="xs" variant="ghost-danger" aria-label={`Remove ${c.name}`} title="Remove" onClick={() => remove.mutate(c.row_id!)}><TrashIcon /></Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canEdit && !adding ? (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add someone to call</Button>
          ) : null}
        </>
      )}
      {canEdit && adding ? (
        <div className="rounded-md border border-border p-3">
          <EmergencyContactAdd
            profileId={profileId}
            ownerRelationship={ownerRelationship}
            onAdded={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
