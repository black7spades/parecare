import { useEffect, useState } from 'react';
import { OpeningHoursField, badDays, hoursFrom, weekFrom, type WeekHours } from '../../../components/OpeningHoursField';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { addressFrom, addressPayload, emptyAddress, type AddressValue } from '../../../components/AddressFields';
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
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import {
  KIND_WORDS,
  POA_TYPES,
  poaLabel,
  providerTypeFilterOptions,
  providerTypeLabel,
  type Provider,
  type ProviderKind,
} from '../../../lib/care';
import { useProfile } from './ProfileLayout';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ContactStrip } from '../../../components/ContactStrip';
import { mainTypeWords, summaryFromProvider, type Task } from '../../../lib/care';
import { CONTACT_LINK } from '../../../components/ContactStrip';
import { formatDateOnly } from '../../../lib/datetime';
import { bookingHref } from '../../../lib/booking';
import { whenText, type Appointment } from './AppointmentsPage';

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkEditQueue, setBulkEditQueue] = useState<Provider[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['providers', profile.id],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profile.id}/providers`),
  });
  // Removing is held back a few seconds with Undo, never a "sure?" box.
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const hidden = useHiddenIds();
  const everything = (data?.providers ?? []).filter((p) => !hidden.has(p.id));
  const providers = everything.filter((p) => kindOf(p) === kind);
  // Opens by the provider's own id, from either tab, so links from an
  // appointment land on the right record.
  const panel = useRecordPanel(everything, (p) => p.id);
  const openKind = panel.current ? kindOf(panel.current) : null;
  useEffect(() => {
    if (openKind && openKind !== kind) setKind(openKind);
  }, [openKind, kind]);
  const counts = {
    person: everything.filter((p) => kindOf(p) === 'person').length,
    organisation: everything.filter((p) => kindOf(p) === 'organisation').length,
  };
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['providers', profile.id] });
  const navigate = useNavigate();
  // Their appointments and open tasks come from what the other pages
  // already fetch, filtered to this contact.
  const { data: apptData } = useQuery({
    queryKey: ['appointments', profile.id],
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/care-profiles/${profile.id}/appointments`),
    enabled: !!panel.current,
  });
  const { data: taskData } = useQuery({
    queryKey: ['tasks', profile.id],
    queryFn: () => api.get<{ reminders: Task[] }>(`/care-profiles/${profile.id}/reminders?status=all`),
    enabled: !!panel.current,
  });

  // The type filter offers custom types actually in use, not just built-ins.
  const filters: DataFilter<Provider>[] = [
    {
      key: 'type',
      label: 'Type',
      options: providerTypeFilterOptions(providers, kind),
      match: (row, value) => row.provider_type === value,
    },
    {
      // Current by default; anyone no longer seen is under Past.
      key: 'status',
      label: 'Status',
      anyLabel: 'Current and past',
      options: [
        { value: 'current', label: 'Current' },
        { value: 'past', label: 'Past' },
      ],
      match: (row, value) => (value === 'past' ? !!row.ended_on : !row.ended_on),
    },
  ];

  const dv = useDataView<Provider>({
    rows: providers,
    getId: (p) => p.id,
    searchText: (p) => [p.name, p.organisation, p.phone, p.email, p.address, providerTypeLabel(p.provider_type)].filter(Boolean).join(' '),
    sorts: SORTS,
    filters,
  });
  // Opens on Current, once.
  const [statusSet, setStatusSet] = useState(false);
  useEffect(() => {
    if (!statusSet) {
      dv.setFilter('status', 'current');
      setStatusSet(true);
    }
  }, [statusSet, dv]);
  // How many of each type are current, so "Main GP" only shows where it helps.
  const sameTypeCount = (p: Provider) => everything.filter((x) => !x.ended_on && x.provider_type.toLowerCase() === p.provider_type.toLowerCase()).length;
  const showMain = (p: Provider) => !!p.is_main && (sameTypeCount(p) > 1 || ['gp', 'pharmacy'].includes(p.provider_type.toLowerCase()));
  const [endingFor, setEndingFor] = useState<Provider | null>(null);
  const [actionError, setActionError] = useState('');
  const standing = useMutation({
    mutationFn: ({ p, change }: { p: Provider; change: { is_main?: boolean; ended_on?: string | null } }) =>
      api.patch(`/care-profiles/${profile.id}/providers/${p.id}/link`, change),
    onSuccess: () => {
      setActionError('');
      setEndingFor(null);
      invalidate();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'That change was not saved. Try again.'),
  });

  // Takes them off this person only; they stay in the directory for others.
  const removeProviders = (items: Provider[]) => {
    if (items.length === 0) return;
    deferDelete({
      message: items.length === 1 ? `Removed ${items[0].name} from ${careName}.` : `Removed ${items.length} ${KIND_WORDS[kind].many.toLowerCase()} from ${careName}.`,
      ids: items.map((p) => p.id),
      commit: async () => {
        for (const p of items) await api.delete(`/care-profiles/${profile.id}/providers/${p.id}`);
      },
      onCommitted: invalidate,
    });
  };
  const practiceName = (id: string | null | undefined) =>
    id ? (data?.providers ?? []).find((p) => p.id === id)?.name ?? null : null;

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
                    { key: 'delete', label: 'Remove selected', destructive: true, onRun: () => { removeProviders([...dv.selectedRows]); dv.clearSelection(); } },
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
            <div key={p.id} {...panel.rowProps(p.id)} className={`card ${RECORD_ROW_CLASS}`}>
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
                      {showMain(p) ? <span className="badge bg-primary-50 text-primary-600 dark:bg-primary-100 dark:text-primary text-xs">Main {mainTypeWords(p.provider_type)}</span> : null}
                      {p.ended_on ? <span className="badge bg-surface-2 text-muted text-xs">No longer seeing them since {formatDateOnly(p.ended_on, 'd MMM yyyy')}</span> : null}
                      {p.poa_type ? <PoaBadge type={p.poa_type} activated={p.poa_activated} /> : null}
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    {p.phone ? (
                      <p>
                        <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} className={CONTACT_LINK} aria-label={`Call ${p.name} on ${p.phone}`}>
                          {p.phone}
                        </a>
                      </p>
                    ) : null}
                    {p.email ? (
                      <p className="break-all">
                        <a href={`mailto:${p.email}`} className={CONTACT_LINK} aria-label={`Email ${p.name} at ${p.email}`}>
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
                      <Button size="xs" variant="ghost-danger" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => removeProviders([p])}>
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

      {endingFor ? (
        <EndedModal
          provider={endingFor}
          saving={standing.isPending}
          error={actionError}
          onClose={() => { setEndingFor(null); setActionError(''); }}
          onSave={(date) => standing.mutate({ p: endingFor, change: { ended_on: date } })}
        />
      ) : null}

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

      {panel.current ? (() => {
        const p = panel.current;
        const pKind = kindOf(p);
        const practice = practiceName(p.practice_id);
        const segmented = !!(p.address_line1 || p.address_suburb || p.address_state || p.address_postcode);
        const theirAppointments = (apptData?.appointments ?? [])
          .filter((a) => a.provider_id === p.id)
          .sort((a, b) => (b.starts_at ? new Date(b.starts_at).getTime() : Number.MAX_SAFE_INTEGER) - (a.starts_at ? new Date(a.starts_at).getTime() : Number.MAX_SAFE_INTEGER));
        const theirTasks = (taskData?.reminders ?? []).filter((t) => t.provider_id === p.id && !t.completed);
        return (
          <RecordPanel
            key={p.id}
            kindLabel={pKind === 'organisation' ? 'Organisation' : 'Professional'}
            title={p.name}
            subtitle={providerTypeLabel(p.provider_type)}
            kind="providers"
            recordId={p.id}
            profileId={profile.id}
            canEdit={canEdit}
            fields={[
              { label: 'Type', value: providerTypeLabel(p.provider_type) },
              { label: 'Also known as', value: (p.also_known_as ?? []).join(', ') },
              { label: basedAtLabel(pKind), value: p.organisation },
              ...(segmented
                ? [
                    { label: 'Street', value: p.address_line1 },
                    { label: 'Street line 2', value: p.address_line2 },
                    { label: 'Suburb', value: p.address_suburb },
                    { label: 'State', value: p.address_state },
                    { label: 'Postcode', value: p.address_postcode },
                    { label: 'Country', value: p.address_country },
                  ]
                : [{ label: 'Address', value: p.address }]),
              { label: 'People based here', value: p.member_count ? String(p.member_count) : null },
              { label: 'Power of attorney', value: p.poa_type ? poaLabel(p.poa_type) : null },
              { label: 'In effect now', value: p.poa_type ? (p.poa_activated ? 'Yes' : 'No') : null },
            ]}
            links={[
              ...(p.practice_id && practice
                ? [{ label: basedAtLabel(pKind), value: practice, to: `/app/${profile.id}/providers?record=${p.practice_id}` }]
                : []),
            ]}
            onEdit={() => {
              setEditing(p);
              setEditorOpen(true);
            }}
            extra={[
              { label: 'New appointment with them', onRun: () => navigate(bookingHref(profile.id, { provider: p.id })) },
              ...(canEdit && !p.ended_on && !p.is_main
                ? [{ label: `Make main ${mainTypeWords(p.provider_type)}`, onRun: () => standing.mutate({ p, change: { is_main: true } }), pending: standing.isPending }]
                : []),
              ...(canEdit && !p.ended_on ? [{ label: 'No longer seeing them', onRun: () => setEndingFor(p) }] : []),
              ...(canEdit && p.ended_on
                ? [{ label: 'Seeing them again', onRun: () => standing.mutate({ p, change: { ended_on: null } }), pending: standing.isPending }]
                : []),
            ]}
            deleteLabel="Remove"
            onDelete={() => {
              removeProviders([p]);
              panel.close();
            }}
            onClose={panel.close}
          >
            {actionError ? <p className="text-sm text-red-600" role="alert">{actionError}</p> : null}
            {showMain(p) ? <p className="text-sm text-ink">Their main {mainTypeWords(p.provider_type)}.</p> : null}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">How to reach them</h3>
              <ContactStrip contact={summaryFromProvider(p)} profileId={profile.id} book={false} />
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Appointments</h3>
              {theirAppointments.length === 0 ? (
                <p className="text-sm text-muted">No appointments with them yet.</p>
              ) : (
                <ul className="space-y-1">
                  {theirAppointments.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <Link to={`/app/${profile.id}/appointments?record=${a.id}`} className="text-primary hover:underline">{a.title}</Link>
                      <span className="text-xs text-muted">{whenText(a)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Open tasks</h3>
              {theirTasks.length === 0 ? (
                <p className="text-sm text-muted">No open tasks with them.</p>
              ) : (
                <ul className="space-y-1">
                  {theirTasks.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <Link to={`/app/${profile.id}/tasks?record=${t.id}`} className="text-primary hover:underline">{t.title}</Link>
                      <span className="text-xs text-muted">Due {format(new Date(t.next_due_at), 'd MMM yyyy')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </RecordPanel>
        );
      })() : null}
    </div>
  );
}

/** "No longer seeing them": since when, today unless changed. */
function EndedModal({
  provider,
  saving,
  error,
  onClose,
  onSave,
}: {
  provider: Provider;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (date: string) => void;
}) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [missing, setMissing] = useState('');
  return (
    <Modal open onClose={onClose} title="No longer seeing them">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {provider.name} moves to past contacts. Nothing about them is lost, and they come back with Seeing them again.
        </p>
        <Input id="ended-on" label="Since when?" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {missing ? <p className="text-sm text-red-600" role="alert">{missing}</p> : null}
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={saving}
            onClick={() => {
              if (!date) {
                setMissing('Choose the date you stopped seeing them, then save.');
                return;
              }
              setMissing('');
              onSave(date);
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
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
  const [afterHours, setAfterHours] = useState('');
  const [fax, setFax] = useState('');
  const [week, setWeek] = useState<WeekHours>(weekFrom(null));
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
    setPhone(ownValue(provider, 'phone'));
    setEmail(ownValue(provider, 'email'));
    setAfterHours(ownValue(provider, 'after_hours_phone'));
    setFax(ownValue(provider, 'fax'));
    // Hours taken from where they are based start empty, so they keep following it.
    setWeek(weekFrom(provider && !(provider.inherited_fields ?? []).includes('opening_hours') ? provider.opening_hours : null));
    setAddress(provider ? addressFrom(provider) : emptyAddress);
    setBookingLink(ownValue(provider, 'booking_link'));
    setDirectionsLink(ownValue(provider, 'directions_link'));
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
        after_hours_phone: afterHours.trim() || null,
        fax: fax.trim() || null,
        opening_hours: hoursFrom(week),
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
          <Button type="submit" loading={mutation.isPending}>
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
