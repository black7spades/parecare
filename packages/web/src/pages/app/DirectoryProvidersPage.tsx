import { useEffect, useState } from 'react';
import { EmailLink, PhoneLink } from '../../components/cards/profile/links';
import { hoursText } from '../../components/OpeningHoursField';
import { OpeningHoursField, badDays, hoursFrom, weekFrom, type WeekHours } from '../../components/OpeningHoursField';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { addressFrom, addressPayload, emptyAddress, type AddressValue } from '../../components/AddressFields';
import {
  OtherNamesField,
  PracticeAddress,
  PracticeMembers,
  ProviderTypeField,
  SharedContactNote,
  ownValue,
  sharedPlaceholder,
  WorksAtField,
  isPlace,
  practicePayload,
  worksAtFrom,
  type WorksAtValue,
} from '../../components/ProviderFields';
import { ImportExport } from '../../components/ImportExport';
import { EditableSubheader } from '../../components/ui/EditableSubheader';
import { DataToolbar } from '../../components/data/DataToolbar';
import { SortableTh } from '../../components/data/SortableTh';
import { useDataView, type DataSort, type DataFilter } from '../../components/data/useDataView';
import { Button } from '../../components/ui/Button';
import { LinkIcon, PencilIcon, TrashIcon } from '../../components/ui/icons';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { RecordPanel, type RecordLink } from '../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../stores/undo';
import { CONTACT_LINK } from '../../components/ContactStrip';
import { useCountry } from '../../lib/country';
import {
  KIND_WORDS,
  providerTypeFilterOptions,
  providerTypeLabel,
  type PracticeMember,
  type Provider,
  type ProviderKind,
} from '../../lib/care';

interface LinkedProfile {
  profile_id: string;
  profile_name: string;
}

interface DuplicatePair {
  first: { id: string; name: string; provider_type: string; kind: ProviderKind; address: string | null };
  second: { id: string; name: string; provider_type: string; kind: ProviderKind; address: string | null };
}

interface DirectoryProvider extends Provider {
  account_id: string;
  linked_profiles: LinkedProfile[] | null;
  members: PracticeMember[] | null;
}

/** Where a record sits: a professional is based at an organisation, an organisation is part of a bigger one. */
const basedAtLabel = (kind: ProviderKind) => (kind === 'organisation' ? 'Part of' : 'Based at');

function sortsFor(kind: ProviderKind): DataSort<DirectoryProvider>[] {
  return [
    { key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
    { key: 'type', label: 'Type', compare: (a, b) => providerTypeLabel(a.provider_type).localeCompare(providerTypeLabel(b.provider_type)) },
    { key: 'works_at', label: basedAtLabel(kind), compare: (a, b) => (a.organisation ?? '').localeCompare(b.organisation ?? '') },
    ...(kind === 'organisation'
      ? [{ key: 'members', label: 'Based here', compare: (a: DirectoryProvider, b: DirectoryProvider) => (b.members?.length ?? 0) - (a.members?.length ?? 0) }]
      : []),
    { key: 'phone', label: 'Phone', compare: (a, b) => (a.phone ?? '').localeCompare(b.phone ?? '') },
    { key: 'address', label: 'Address', compare: (a, b) => (a.address ?? '').localeCompare(b.address ?? '') },
    { key: 'profiles', label: 'Linked profiles', compare: (a, b) => (b.linked_profiles?.length ?? 0) - (a.linked_profiles?.length ?? 0) },
  ];
}

const kindOf = (p: { kind?: ProviderKind }): ProviderKind => p.kind ?? 'person';

/** Clinics, health hubs, pharmacies, government departments and other bodies. */
export function DirectoryOrganisationsPage() {
  return <DirectoryProvidersPage key="organisation" kind="organisation" />;
}

/** Doctors, specialists, lawyers, caseworkers: the people, usually based at an organisation. */
export function DirectoryProfessionalsPage() {
  return <DirectoryProvidersPage key="person" kind="person" />;
}

function DirectoryProvidersPage({ kind }: { kind: ProviderKind }) {
  // Address words and examples the way this country writes them.
  const { config: country } = useCountry();
  const aw = country.words;
  const sa = country.sample_address;
  const words = KIND_WORDS[kind];
  const SORTS = sortsFor(kind);
  const slug = kind === 'organisation' ? 'organisations' : 'professionals';
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DirectoryProvider | null>(null);
  const [bulkLinking, setBulkLinking] = useState<DirectoryProvider | null>(null);
  const [bulkLinkingIds, setBulkLinkingIds] = useState<DirectoryProvider[]>([]);
  const [bulkEditQueue, setBulkEditQueue] = useState<DirectoryProvider[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['directory-providers'],
    queryFn: () => api.get<{ providers: DirectoryProvider[]; can_edit: boolean }>('/directory/providers'),
  });
  // Both lists come from one directory: a duplicate pair or a merge can span
  // an organisation and a professional filed by mistake as the other.
  const everything = data?.providers ?? [];
  // Deleting is held back a few seconds with Undo, never a "sure?" box.
  const hidden = useHiddenIds();
  const providers = everything.filter((p) => kindOf(p) === kind && !hidden.has(p.id));
  const canEdit = data?.can_edit ?? false;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['directory-providers'] });

  // The type filter offers custom types actually in use, not just built-ins.
  const filters: DataFilter<DirectoryProvider>[] = [
    {
      key: 'type',
      label: 'Type',
      options: providerTypeFilterOptions(providers, kind),
      match: (row, value) => row.provider_type === value,
    },
    {
      key: 'works_at',
      label: basedAtLabel(kind),
      anyLabel: 'Anywhere',
      options: [...new Set(providers.map((p) => p.organisation).filter((o): o is string => !!o))]
        .sort((a, b) => a.localeCompare(b))
        .map((o) => ({ value: o, label: o })),
      match: (row, value) => row.organisation === value,
    },
  ];

  const dv = useDataView<DirectoryProvider>({
    rows: providers,
    getId: (p) => p.id,
    searchText: (p) => [p.name, ...(p.also_known_as ?? []), p.organisation, p.phone, p.email, p.address, providerTypeLabel(p.provider_type)].filter(Boolean).join(' '),
    sorts: SORTS,
    filters,
  });

  const panel = useRecordPanel(providers, (p) => p.id);
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const deleteProviders = (items: DirectoryProvider[]) => {
    if (items.length === 0) return;
    deferDelete({
      // Say who loses it, as the old warning did, so Undo is an informed choice.
      message: (() => {
        const linked = new Set(items.flatMap((p) => (p.linked_profiles ?? []).map((lp) => lp.profile_id))).size;
        const what = items.length === 1 ? `Deleted ${items[0].name}.` : `Deleted ${items.length} ${words.many.toLowerCase()}.`;
        return linked > 0 ? `${what} Removed from ${linked} ${linked === 1 ? 'profile' : 'profiles'}.` : what;
      })(),
      ids: items.map((p) => p.id),
      commit: async () => {
        for (const p of items) await api.delete(`/directory/providers/${p.id}`);
      },
      onCommitted: invalidate,
    });
  };

  // Two records for the same place: the ones spotted for the person, the pair
  // being merged, and the last merge, which can be undone for a while.
  const [merging, setMerging] = useState<[DirectoryProvider, DirectoryProvider] | null>(null);
  const [lastMerge, setLastMerge] = useState<{ id: string; message: string } | null>(null);
  const [mergeNote, setMergeNote] = useState('');
  const { data: dupData } = useQuery({
    queryKey: ['directory-provider-duplicates'],
    queryFn: () => api.get<{ pairs: DuplicatePair[] }>('/directory/providers/duplicates'),
    enabled: canEdit,
  });
  const pairs = (dupData?.pairs ?? []).filter((pair) => pair.first.kind === kind || pair.second.kind === kind);
  const refreshAll = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: ['directory-provider-duplicates'] });
  };
  const byId = (id: string) => everything.find((p) => p.id === id);
  // Filed as the wrong kind: move it to the other list, keeping everything linked to it.
  const moveMutation = useMutation({
    mutationFn: async (rows: DirectoryProvider[]) => {
      const notes: string[] = [];
      for (const p of rows) {
        const res = await api.patch<{ note?: string | null }>(`/directory/providers/${p.id}`, { kind: words.other });
        if (res?.note) notes.push(`${p.name}: ${res.note}`);
      }
      return { count: rows.length, notes };
    },
    onSuccess: ({ count, notes }) => {
      dv.clearSelection();
      setMergeNote(
        notes.length > 0
          ? notes.join(' ')
          : `Moved ${count === 1 ? 'it' : `${count} records`} to ${KIND_WORDS[words.other].many}.`
      );
      refreshAll();
    },
    onError: (err) => setMergeNote(err instanceof Error ? err.message : 'That could not be moved. Try again.'),
  });
  const dismissPair = useMutation({
    mutationFn: (pair: DuplicatePair) =>
      api.post('/directory/providers/duplicates/dismiss', { first_id: pair.first.id, second_id: pair.second.id }),
    onSuccess: refreshAll,
  });
  const undoMerge = useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/directory/providers/merges/${id}/undo`),
    onSuccess: (res) => {
      setLastMerge(null);
      setMergeNote(res.message);
      refreshAll();
    },
    onError: (err) => setMergeNote(err instanceof Error ? err.message : 'That merge could not be undone.'),
  });

  const pageFor = (p: { kind?: ProviderKind }) => `/app/directory/${kindOf(p) === 'organisation' ? 'organisations' : 'professionals'}`;
  const current = panel.current;
  const practice = current?.practice_id ? byId(current.practice_id) : undefined;
  const panelLinks: RecordLink[] = current
    ? [
        ...(practice
          ? [{ label: basedAtLabel(kind), value: practice.name, to: `${pageFor(practice)}?record=${practice.id}` }]
          : []),
        ...(current.members ?? []).map((m) => ({ label: 'Based here', value: m.name, to: `${pageFor(m)}?record=${m.id}` })),
        ...(current.linked_profiles ?? []).map((lp) => ({ label: 'Linked to', value: lp.profile_name, to: `/app/${lp.profile_id}` })),
        ...(current.booking_link ? [{ label: 'Booking', value: 'Book online', href: current.booking_link }] : []),
        ...(current.directions_link ? [{ label: 'Directions', value: 'Open map', href: current.directions_link }] : []),
      ]
    : [];

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{words.many}</h2>
          <EditableSubheader copyKey={`directory.${slug}.subheader`} />
        </div>
        <div className="flex gap-2 shrink-0">
          <ImportExport
            basePath={`/directory/${slug}`}
            resource={slug}
            canImport={canEdit}
            onImported={invalidate}
            templateHeaders={['Name', 'Type', basedAtLabel(kind), 'Phone', 'Email', 'Address line 1', 'Address line 2', aw.suburb, aw.state, aw.postcode, 'Country', 'Booking link', 'Directions']}
            templateSample={
              kind === 'organisation'
                ? ['Neuro Clinic', 'Clinic', 'City Health Hub', country.phone_example, 'clinic@example.com', sa.line1, '', sa.suburb, sa.state, sa.postcode, sa.country, '', '']
                : ['Dr Jane Smith', 'GP', 'City Medical', country.phone_example, 'jane@example.com', sa.line1, '', sa.suburb, sa.state, sa.postcode, sa.country, '', '']
            }
          />
          {canEdit ? (
            <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
              Add {words.one}
            </Button>
          ) : null}
        </div>
      </div>

      {lastMerge ? (
        <div className="card mb-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink flex-1 min-w-0">{lastMerge.message}</p>
          <Button size="sm" variant="secondary" loading={undoMerge.isPending} onClick={() => undoMerge.mutate(lastMerge.id)}>
            Undo
          </Button>
        </div>
      ) : mergeNote ? (
        <p className="text-sm text-ink mb-4">{mergeNote}</p>
      ) : null}

      {canEdit && pairs.length > 0 ? (
        <div className="card mb-4 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">These look like the same {words.one}</h3>
            <p className="text-xs text-muted">Merge them so everything is in one record, or dismiss a pair that is not the same.</p>
          </div>
          <ul className="divide-y divide-border">
            {pairs.map((pair) => (
              <li key={`${pair.first.id}-${pair.second.id}`} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink flex-1 min-w-0">
                  {pair.first.name} <span className="text-muted">and</span> {pair.second.name}
                </span>
                <Button size="xs" variant="ghost" loading={dismissPair.isPending && dismissPair.variables === pair} onClick={() => dismissPair.mutate(pair)}>
                  Dismiss
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    const a = byId(pair.first.id);
                    const b = byId(pair.second.id);
                    if (a && b) {
                      setMergeNote('');
                      setMerging([a, b]);
                    }
                  }}
                >
                  Merge
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
                    { key: 'link', label: 'Link selected', onRun: () => setBulkLinkingIds(dv.selectedRows) },
                    {
                      key: 'merge',
                      label: 'Merge selected',
                      onRun: () => {
                        if (dv.selectedRows.length === 2) {
                          setMergeNote('');
                          setMerging([dv.selectedRows[0]!, dv.selectedRows[1]!]);
                        } else {
                          setMergeNote('Tick exactly two records to merge them.');
                        }
                      },
                    },
                    {
                      key: 'move',
                      label: `Move to ${KIND_WORDS[words.other].many}`,
                      onRun: () => moveMutation.mutate(dv.selectedRows),
                    },
                    { key: 'edit', label: 'Edit selected', onRun: () => { const q = [...dv.selectedRows]; setBulkEditQueue(q); setEditing(q[0] ?? null); setEditorOpen(true); } },
                    { key: 'delete', label: 'Delete selected', destructive: true, onRun: () => { deleteProviders(dv.selectedRows); dv.clearSelection(); } },
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
          {kind === 'organisation' ? (
            <>
              <p className="text-sm text-ink">Keep every clinic, hospital, pharmacy and government department in one place.</p>
              <p className="text-xs text-muted">Add an organisation once, with its address, and everyone based there shares it.</p>
            </>
          ) : (
            <>
              <p className="text-sm text-ink">Keep every doctor, specialist, lawyer and caseworker in one place.</p>
              <p className="text-xs text-muted">Say where each one is based and they take its address, so it is never typed twice.</p>
            </>
          )}
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
                <SortableTh label="Name" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Type" sortKey="type" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label={basedAtLabel(kind)} sortKey="works_at" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                {kind === 'organisation' ? (
                  <SortableTh label="Based here" sortKey="members" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                ) : null}
                <SortableTh label="Phone" sortKey="phone" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Address" sortKey="address" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Linked to" sortKey="profiles" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                {canEdit ? <th className="px-3 py-2 w-36" /> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((p) => (
                <tr key={p.id} {...panel.rowProps(p.id)} className={`border-b border-border last:border-0 align-top ${RECORD_ROW_CLASS}`}>
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
                  </td>
                  <td className="px-3 py-2 text-muted">{providerTypeLabel(p.provider_type)}</td>
                  <td className="px-3 py-2 text-muted">{p.organisation || '-'}</td>
                  {kind === 'organisation' ? (
                    <td className="px-3 py-2 text-muted" title={(p.members ?? []).map((m) => m.name).join(', ') || undefined}>
                      {p.members && p.members.length > 0 ? p.members.length : '-'}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    {p.phone ? (
                      <a href={`tel:${p.phone}`} className={`${CONTACT_LINK}`}>{p.phone}</a>
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
                        <Button size="xs" variant="ghost" aria-label={`Link ${p.name} to profiles`} title="Link to profiles" onClick={() => setBulkLinking(p)}><LinkIcon /></Button>
                        <Button size="xs" variant="ghost" aria-label={`Edit ${p.name}`} title="Edit" onClick={() => { setEditing(p); setEditorOpen(true); }}><PencilIcon /></Button>
                        <Button size="xs" variant="ghost-danger" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => deleteProviders([p])}><TrashIcon /></Button>
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
        kind={kind}
        open={editorOpen}
        provider={editing}
        canEdit={canEdit}
        onMembersChanged={invalidate}
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

      <MergeDialog
        pair={merging}
        onClose={() => setMerging(null)}
        onMerged={(merge) => {
          setMerging(null);
          setLastMerge(merge);
          dv.clearSelection();
          refreshAll();
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

      {current ? (
        <RecordPanel
          key={current.id}
          kindLabel={words.one.charAt(0).toUpperCase() + words.one.slice(1)}
          title={current.name}
          subtitle={providerTypeLabel(current.provider_type)}
          recordId={current.id}
          canEdit={canEdit}
          fields={[
            { label: 'Type', value: providerTypeLabel(current.provider_type) },
            { label: 'Other names', value: (current.also_known_as ?? []).join(', ') },
            { label: basedAtLabel(kind), value: current.organisation },
            { label: 'Phone', value: current.phone ? <PhoneLink phone={current.phone} /> : null },
            { label: 'After-hours phone', value: current.after_hours_phone ? <PhoneLink phone={current.after_hours_phone} /> : null },
            { label: 'Fax', value: current.fax },
            { label: 'Email', value: current.email ? <EmailLink email={current.email} /> : null },
            { label: 'Opening hours', value: hoursText(current.opening_hours) },
            { label: 'Address', value: current.address },
          ]}
          links={panelLinks}
          onEdit={() => { setEditing(current); setEditorOpen(true); }}
          extra={[{ label: 'Link to profiles', onRun: () => setBulkLinking(current) }]}
          onDelete={() => {
            deleteProviders([current]);
            panel.close();
          }}
          onClose={panel.close}
        />
      ) : null}
    </div>
  );
}

/**
 * Which record to keep by default: the plainer name (the extra word in
 * "Health Hub Doctors Morayfield" is usually noise), then the one with an
 * address, then the one more is linked to. Easy to swap in the dialog.
 */
function keepScore(p: DirectoryProvider, other: DirectoryProvider): number {
  const words = (n: string) => n.trim().split(/\s+/).length;
  const plainer = words(p.name) < words(other.name) ? 6 : 0;
  const filled = [p.phone, p.email, p.booking_link, p.directions_link].filter(Boolean).length;
  return plainer + (p.address ? 4 : 0) + filled + (p.linked_profiles?.length ?? 0) + (p.members?.length ?? 0);
}

function MergeDialog({
  pair,
  onClose,
  onMerged,
}: {
  pair: [DirectoryProvider, DirectoryProvider] | null;
  onClose: () => void;
  onMerged: (merge: { id: string; message: string }) => void;
}) {
  const [keepId, setKeepId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!pair) return;
    const [a, b] = pair;
    setKeepId(keepScore(b, a) > keepScore(a, b) ? b.id : a.id);
    setError('');
  }, [pair]);

  const merge = useMutation({
    mutationFn: () => {
      const remove = pair!.find((p) => p.id !== keepId)!;
      return api.post<{ merge_id: string; message: string }>('/directory/providers/merge', { keep_id: keepId, remove_id: remove.id });
    },
    onSuccess: (res) => onMerged({ id: res.merge_id, message: res.message }),
    onError: (err) => setError(err instanceof Error ? err.message : 'They could not be merged. Try again.'),
  });

  if (!pair) return null;
  const other = pair.find((p) => p.id !== keepId);
  return (
    <Modal open onClose={onClose} title="Merge two records">
      <div className="space-y-4">
        <p className="text-sm text-ink">Choose the record to keep. Everything linked to the other one moves across to it.</p>
        <fieldset className="space-y-2">
          <legend className="sr-only">Record to keep</legend>
          {pair.map((p) => (
            <label key={p.id} className="flex items-start gap-2 rounded-md border border-border p-3 text-sm text-ink cursor-pointer">
              <input
                type="radio"
                name="merge-keep"
                className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
                checked={keepId === p.id}
                onChange={() => setKeepId(p.id)}
              />
              <span className="min-w-0">
                <span className="block font-medium">{p.name}</span>
                <span className="block text-xs text-muted">{providerTypeLabel(p.provider_type)}</span>
                <span className="block text-xs text-muted">{p.address || 'No address'}</span>
                <span className="block text-xs text-muted">
                  Linked to {p.linked_profiles?.length ?? 0}, with {p.members?.length ?? 0} based here
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {other ? (
          <p className="text-xs text-muted">
            {other.name} is kept as another name, so Pare and your assistants still find it by that name. Details it has that
            the kept record is missing, like a phone number or address, are copied across. Undo is available for 30 minutes.
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={merge.isPending} disabled={!keepId} onClick={() => merge.mutate()}>Merge</Button>
        </div>
      </div>
    </Modal>
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
  kind: listKind,
  open,
  provider,
  canEdit,
  onMembersChanged,
  onClose,
  onSaved,
}: {
  kind: ProviderKind;
  open: boolean;
  provider: DirectoryProvider | null;
  canEdit: boolean;
  onMembersChanged: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const kind = provider ? kindOf(provider) : listKind;
  const defaultType = kind === 'organisation' ? '' : 'gp';
  const [type, setType] = useState(defaultType);
  const [name, setName] = useState('');
  const [worksAt, setWorksAt] = useState<WorksAtValue>(worksAtFrom(null));
  const [sharesAddress, setSharesAddress] = useState(true);
  const [otherNames, setOtherNames] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [afterHours, setAfterHours] = useState('');
  const [fax, setFax] = useState('');
  const [week, setWeek] = useState<WeekHours>(weekFrom(null));
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [bookingLink, setBookingLink] = useState('');
  const [directionsLink, setDirectionsLink] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setType(provider?.provider_type ?? defaultType);
    setName(provider?.name ?? '');
    setWorksAt(worksAtFrom(provider));
    setOtherNames(provider?.also_known_as ?? []);
    setSharesAddress(provider ? !!provider.uses_practice_address || !provider.organisation : true);
    setPhone(ownValue(provider, 'phone'));
    setEmail(ownValue(provider, 'email'));
    setAfterHours(ownValue(provider, 'after_hours_phone'));
    setFax(ownValue(provider, 'fax'));
    // Hours taken from where they are based start empty, so they keep following it.
    setWeek(weekFrom(provider && !(provider.inherited_fields ?? []).includes('opening_hours') ? provider.opening_hours : null));
    setAddress(provider ? addressFrom(provider) : emptyAddress);
    setBookingLink(ownValue(provider, 'booking_link'));
    setDirectionsLink(ownValue(provider, 'directions_link'));
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
        after_hours_phone: afterHours.trim() || null,
        fax: fax.trim() || null,
        opening_hours: hoursFrom(week),
        ...addressPayload(address),
        ...practicePayload(worksAt, sharesAddress),
        also_known_as: otherNames,
        booking_link: bookingLink.trim() || null,
        directions_link: directionsLink.trim() || null,
      };
      return provider
        ? api.patch(`/directory/providers/${provider.id}`, body)
        : api.post('/directory/providers', body);
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
          // Save always answers: say what is missing.
          if (!name.trim()) {
            setError('Write their name first, then save.');
            return;
          }
          const bad = badDays(week);
          if (bad.length) {
            setError(`Check the opening hours on ${bad.join(', ')}: the closing time comes before the opening time.`);
            return;
          }
          setError('');
          mutation.mutate();
        }}
      >
        <ProviderTypeField key={`type-${provider?.id ?? 'new'}`} id="dir-provider-type" value={type} onChange={setType} kind={kind} />
        <Input
          label="Name"
          placeholder={kind === 'organisation' ? 'e.g. City Health Hub' : 'e.g. Dr Carly Examplename'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <OtherNamesField value={otherNames} onChange={setOtherNames} />
        <WorksAtField id="dir-provider-works-at" value={worksAt} onChange={setWorksAt} excludeId={provider?.id} kind={kind} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Phone" placeholder={sharedPlaceholder(worksAt, 'phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="Email" type="email" placeholder={sharedPlaceholder(worksAt, 'email')} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="After-hours phone" placeholder={sharedPlaceholder(worksAt, 'after_hours_phone')} value={afterHours} onChange={(e) => setAfterHours(e.target.value)} />
          <Input label="Fax" placeholder={sharedPlaceholder(worksAt, 'fax')} value={fax} onChange={(e) => setFax(e.target.value)} />
        </div>
        <OpeningHoursField value={week} onChange={setWeek} inheritedFrom={worksAt.practiceName.trim() || null} />
        <PracticeAddress
          worksAt={worksAt}
          sharesAddress={sharesAddress}
          onSharesAddress={setSharesAddress}
          address={address}
          onAddress={setAddress}
        />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Booking link" type="url" placeholder={sharedPlaceholder(worksAt, 'booking_link', 'https://…')} value={bookingLink} onChange={(e) => setBookingLink(e.target.value)} />
          <Input label="Directions" type="url" placeholder={sharedPlaceholder(worksAt, 'directions_link', 'https://…')} value={directionsLink} onChange={(e) => setDirectionsLink(e.target.value)} />
        </div>
        <SharedContactNote worksAt={worksAt} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Save</Button>
        </div>
      </form>
      {provider && isPlace({ kind, member_count: provider.members?.length ?? 0 }) ? (
        <div className="mt-4">
          <PracticeMembers
            basePath={`/directory/providers/${provider.id}`}
            practiceName={provider.name}
            canEdit={canEdit}
            onChanged={onMembersChanged}
          />
        </div>
      ) : null}
      {!provider && kind === 'organisation' ? (
        <p className="mt-3 text-xs text-muted">Once this is saved, open it again to add who is based here.</p>
      ) : null}
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
    <Modal open onClose={onClose} title={`Link ${providers.length} records to profiles`}>
      <p className="text-sm text-muted mb-3">
        Select profiles to link all {providers.length} selected records to.
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
