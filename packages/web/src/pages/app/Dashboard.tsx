import { useMemo, useState } from 'react';
import { CONTACT_LINK } from '../../components/ContactStrip';
import { Link, useNavigate } from 'react-router-dom';
import { DataToolbar } from '../../components/data/DataToolbar';
import { SortableTh } from '../../components/data/SortableTh';
import { useDataView, type DataSort } from '../../components/data/useDataView';
import { Input } from '../../components/ui/Input';
import { BulkInviteModal } from './homeboard/BulkInviteModal';
import { browserTimeZone } from '../../lib/datetime';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { useAssistantStore } from '../../stores/assistant';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Avatar } from '../../components/ui/Avatar';
import { DOSE_ENTITY, POA_TYPES, PET_SPECIES, conditionStatusLabel, doseActivityWords, isSelfRelationship, type DeathChange } from '../../lib/care';

/** One sentence for a date of death recorded or cleared on several people at once. */
function deathsSentence(deaths: DeathChange[]): string {
  const stopped = deaths.filter((d) => d.kind === 'stopped');
  const restored = deaths.filter((d) => d.kind === 'restored');
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const out: string[] = [];
  if (stopped.length > 0) {
    const tasks = stopped.reduce((s, d) => s + d.tasks, 0);
    const appts = stopped.reduce((s, d) => s + d.appointments, 0);
    out.push(
      `For ${n(stopped.length, 'person', 'people')}, task reminders, dose and supply alerts and the calendar feed have stopped` +
        (tasks ? `, ${n(tasks, 'open task is', 'open tasks are')} closed` : '') +
        (appts ? ` and ${n(appts, 'future appointment is', 'future appointments are')} cancelled but kept as history` : '') +
        '. Clearing the date of death puts everything back.'
    );
  }
  if (restored.length > 0) {
    out.push(`For ${n(restored.length, 'person', 'people')}, reminders, alerts and the calendar feed are running again.`);
  }
  return out.join(' ');
}
import { AttentionPanel } from '../../components/AttentionPanel';
import { useAiStatus, usePareOn, AI_WARMING_MESSAGE } from '../../lib/aiStatus';
import { PareOffNote } from '../../components/PareOffNote';
import { BulkLinkProviderPicker, BulkLinkAddressPicker, BulkLinkOwnerPicker, BulkLinkCarerPicker } from './homeboard/BulkLinkPickers';

interface SummaryJourney {
  id: string;
  name: string;
  phase_name: string | null;
  phase_sort_order: number | null;
}

interface SummaryHealthStatus {
  id: string;
  name: string;
  category: string;
  status: string;
  is_contagious: boolean;
  isolation_required: boolean;
  onset_date: string;
  active_symptom_count: number;
}

type AlertLevel = 'red' | 'yellow' | 'green' | null;

function profileAlertLevel(statuses: SummaryHealthStatus[]): AlertLevel {
  if (statuses.length === 0) return null;
  for (const s of statuses) {
    if (s.is_contagious || s.isolation_required) return 'red';
  }
  for (const s of statuses) {
    if (s.status === 'active') return 'yellow';
  }
  return 'green';
}

const ALERT_BORDER: Record<string, string> = {
  red: 'border-l-4 border-l-red-500',
  yellow: 'border-l-4 border-l-amber-400',
  green: 'border-l-4 border-l-green-500',
};

const ALERT_ROW_BG: Record<string, string> = {
  red: 'bg-red-50 dark:bg-red-900/10',
  yellow: 'bg-amber-50 dark:bg-amber-900/10',
  green: '',
};

interface ProfileSummary {
  id: string;
  kind: 'person' | 'pet';
  full_name: string;
  preferred_name: string | null;
  relationship: string | null;
  access: 'owner' | 'member';
  current_phase: string;
  species: string | null;
  breed: string | null;
  photo_url: string | null;
  photo_color: string | null;
  date_of_birth: string | null;
  pinned: boolean;
  contact_name: string | null;
  contact_relationship: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  /** Whose the phone is: their daughter, their care home, their own. */
  primary_phone_owner?: { name: string; label: string } | null;
  /** Their main GP, on its own row. */
  gp?: { name: string; phone: string | null; practice?: string | null } | null;
  /** Their room, where they live in a home. */
  room_number?: string | null;
  /** The person on their profile to contact about them. */
  next_of_kin?: { name: string; relationship: string | null; phone: string | null } | null;
  poa_holders: { display_name: string; poa_type: string | null; poa_activated: boolean }[];
  last_activity: { action: string; entity_type: string; summary: string | null; created_at: string; actor_name: string | null } | null;
  next_event: { title: string; next_due_at: string } | null;
  journeys: SummaryJourney[];
  health_statuses: SummaryHealthStatus[];
}

type SortKey = 'name' | 'activity' | 'journey';

/** What a search for a person matches: their name, preferred name and room. */
const findText = (p: ProfileSummary) => [p.full_name, p.preferred_name, p.room_number ? `room ${p.room_number}` : null, p.room_number].filter(Boolean).join(' ').toLowerCase();

const poaLabel = (type: string | null) => POA_TYPES.find((t) => t.value === type)?.label ?? 'Power of attorney';

/** The journey used when sorting by journey: first active, phase order breaks ties. */
const firstJourney = (p: ProfileSummary): SummaryJourney | null => p.journeys[0] ?? null;

export function Dashboard() {
  const { account } = useAuthStore();
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<SortKey>('name');
  const [journeyFilter, setJourneyFilter] = useState('');
  const [poaOnly, setPoaOnly] = useState(false);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set());
  const [bulkLinkOpen, setBulkLinkOpen] = useState(false);
  const [bulkAddressOpen, setBulkAddressOpen] = useState(false);
  const [bulkOwnerOpen, setBulkOwnerOpen] = useState(false);
  const [bulkCarerOpen, setBulkCarerOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveNote, setArchiveNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteNote, setInviteNote] = useState('');
  // Find a person by name or room, across the cards and the table.
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  // Only platform staff may permanently delete profiles; everyone can act on
  // their own records for the reversible actions.
  const isAdmin = account?.role === 'admin' || account?.role === 'super_admin';
  const canEdit = isAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: ProfileSummary[] }>('/care-profiles/summary'),
  });
  const profiles = data?.profiles ?? [];

  // A model on this machine may still be downloading on first run; say so
  // plainly here rather than leaving Pare looking broken.
  const { data: aiStatus } = useAiStatus();
  const preparing = aiStatus?.state === 'preparing';
  const pareOn = usePareOn();

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? api.delete(`/care-profiles/${id}/pin`) : api.post(`/care-profiles/${id}/pin`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['pinned-profiles'] });
    },
  });

  const selectedProfiles = useMemo(
    () => profiles.filter((p) => selectedProfileIds.has(p.id)),
    [profiles, selectedProfileIds]
  );
  const selectedPetIds = useMemo(() => selectedProfiles.filter((p) => p.kind === 'pet').map((p) => p.id), [selectedProfiles]);
  // Only the person who set up a profile, or a platform admin, may archive it.
  const archivable = useMemo(() => selectedProfiles.filter((p) => isAdmin || p.access === 'owner'), [selectedProfiles, isAdmin]);
  const notArchivable = selectedProfiles.length - archivable.length;
  const selectedPersonIds = useMemo(() => selectedProfiles.filter((p) => p.kind !== 'pet').map((p) => p.id), [selectedProfiles]);

  // Bulk archive and permanent delete each fan out one request per profile
  // so per-profile permission checks still apply; the server silently skips
  // any the user may not touch.
  const bulkArchive = useMutation({
    mutationFn: () => Promise.allSettled(archivable.map((p) => api.delete(`/care-profiles/${p.id}`))),
    onSuccess: (results) => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      setConfirmArchive(false);
      setSelectedProfileIds(new Set());
      // Say plainly what did not happen, and why, rather than nothing.
      const failed = results.filter((r) => r.status === 'rejected').length;
      const archived = results.length - failed;
      const parts: string[] = [];
      parts.push(`Archived ${archived} ${archived === 1 ? 'profile' : 'profiles'}.`);
      if (notArchivable > 0) {
        parts.push(`${notArchivable} ${notArchivable === 1 ? 'was' : 'were'} left as ${notArchivable === 1 ? 'it is' : 'they are'}: only the person who set up a profile can archive it.`);
      }
      if (failed > 0) parts.push(`${failed} could not be archived just now. Try again.`);
      setArchiveNote(notArchivable > 0 || failed > 0 ? parts.join(' ') : '');
    },
    onError: () => setArchiveNote('The profiles could not be archived just now. Try again.'),
  });

  const bulkDelete = useMutation({
    mutationFn: () => Promise.allSettled([...selectedProfileIds].map((id) => api.delete(`/care-profiles/${id}/permanent`))),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      setConfirmDelete(false);
      setSelectedProfileIds(new Set());
    },
  });

  // Every distinct journey name across the people shown, for the filter.
  const journeyNames = useMemo(
    () => [...new Set(profiles.flatMap((p) => p.journeys.map((j) => j.name)))].sort((a, b) => a.localeCompare(b)),
    [profiles]
  );

  // The medicine round, offered when two or more people have doses due now.
  const tz = browserTimeZone();
  const { data: roundData } = useQuery({
    queryKey: ['medicine-round-count'],
    queryFn: () => api.get<{ people_count: number }>(`/medicine-round${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`),
    enabled: profiles.length > 1,
  });
  const roundPeople = roundData?.people_count ?? 0;

  const shown = useMemo(() => {
    let list = profiles.slice();
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => findText(p).includes(q));
    if (journeyFilter) list = list.filter((p) => p.journeys.some((j) => j.name === journeyFilter));
    if (poaOnly) list = list.filter((p) => p.poa_holders.length > 0);
    list.sort((a, b) => {
      if (sort === 'name') return a.full_name.localeCompare(b.full_name);
      if (sort === 'journey') {
        // Group by journey name; inside a journey, order by how far
        // through its phases each person is.
        const pick = (p: ProfileSummary) =>
          journeyFilter ? p.journeys.find((j) => j.name === journeyFilter) ?? null : firstJourney(p);
        const ja = pick(a);
        const jb = pick(b);
        if (!ja && !jb) return a.full_name.localeCompare(b.full_name);
        if (!ja) return 1;
        if (!jb) return -1;
        return (
          ja.name.localeCompare(jb.name) ||
          (ja.phase_sort_order ?? 0) - (jb.phase_sort_order ?? 0) ||
          a.full_name.localeCompare(b.full_name)
        );
      }
      // activity: most recent first
      const ta = a.last_activity ? new Date(a.last_activity.created_at).getTime() : 0;
      const tb = b.last_activity ? new Date(b.last_activity.created_at).getTime() : 0;
      return tb - ta;
    });
    // Red alerts first, then pinned, keeping the chosen order within each group.
    const alertWeight = (p: ProfileSummary) => {
      const level = profileAlertLevel(p.health_statuses);
      if (level === 'red') return 2;
      if (level === 'yellow') return 1;
      return 0;
    };
    return list.sort((a, b) => alertWeight(b) - alertWeight(a) || Number(b.pinned) - Number(a.pinned));
  }, [profiles, sort, journeyFilter, poaOnly, search]);

  const viewToggle = (
    <div className="flex items-center gap-1 bg-surface-2 rounded-md p-0.5">
      {(['cards', 'table'] as const).map((v) => (
        <button
          key={v}
          type="button"
          className={`px-2.5 py-1 text-xs rounded transition-colors ${
            view === v ? 'bg-card text-ink font-medium shadow-sm' : 'text-muted hover:text-ink'
          }`}
          onClick={() => setView(v)}
        >
          {v === 'cards' ? 'Cards' : 'Table'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1>Welcome, {account?.display_name}</h1>
        {/* With nobody added yet, the welcome below holds the one first step. */}
        {account?.can_create_care_profiles !== false && profiles.length > 0 ? (
          <Button size="sm" onClick={() => navigate('/app/profiles/new')}>Add care profile</Button>
        ) : null}
      </div>

      {preparing ? (
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-muted" role="status">
          {AI_WARMING_MESSAGE}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : profiles.length === 0 ? (
        account?.can_create_care_profiles !== false ? (
          pareOn ? <PareWelcomeCard /> : <FirstStepCard />
        ) : (
          <div className="card text-center py-12">
            <p className="text-muted">
              No one has shared a care profile with you yet. When someone invites you to a care circle, the person
              will appear here.
            </p>
          </div>
        )
      ) : (
        <>
          <AttentionPanel />
          {roundPeople >= 2 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-sm text-ink">
                {roundPeople} people have doses due in the next two hours.
              </p>
              <Button size="sm" variant="secondary" onClick={() => navigate('/app/round')}>Start the medicine round</Button>
            </div>
          ) : null}
          {profiles.length > 1 && view === 'cards' ? (
            <div className="max-w-md">
              <Input aria-label="Find a person by name or room" placeholder="Find a person by name or room" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {profiles.length > 1 ? (
              <>
                <label className="text-muted">Sort</label>
                <select
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                >
                  <option value="name">Name</option>
                  <option value="activity">Recent activity</option>
                  <option value="journey">Journey, then phase</option>
                </select>
                <select
                  aria-label="Filter by journey"
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  value={journeyFilter}
                  onChange={(e) => setJourneyFilter(e.target.value)}
                >
                  <option value="">All journeys</option>
                  {journeyNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-muted">
                  <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={poaOnly} onChange={(e) => setPoaOnly(e.target.checked)} />
                  Has POA
                </label>
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {view === 'cards' ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setCollapsedIds((prev) => (prev.size >= shown.length ? new Set() : new Set(shown.map((p) => p.id))))
                  }
                >
                  {collapsedIds.size >= shown.length && shown.length > 0 ? 'Expand all' : 'Collapse all'}
                </Button>
              ) : null}
              {viewToggle}
            </div>
          </div>

          {inviteNote ? (
            <div className="flex items-start justify-between gap-3 rounded-md border-l-4 border-primary bg-primary-50 px-4 py-2.5 text-sm text-ink" role="status">
              <span>{inviteNote}</span>
              <Button size="xs" variant="ghost" onClick={() => setInviteNote('')}>Dismiss</Button>
            </div>
          ) : null}

          {archiveNote ? (
            <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm text-ink">
              <span>{archiveNote}</span>
              <Button size="xs" variant="ghost" onClick={() => setArchiveNote('')}>
                Dismiss
              </Button>
            </div>
          ) : null}

          {selectedProfileIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-primary-50 dark:bg-primary-900/20 border border-primary/30 rounded-lg text-sm">
              <span className="font-medium text-ink mr-1">{selectedProfileIds.size} selected</span>
              <Button size="sm" variant="secondary" onClick={() => setBulkEditOpen(true)}>
                Edit
              </Button>
              {selectedPersonIds.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => navigate(`/app/emergency-sheets?ids=${selectedPersonIds.join(',')}`)}>
                  Print emergency sheets
                </Button>
              ) : null}
              {archivable.some((p) => p.kind !== 'pet') ? (
                <Button size="sm" variant="secondary" onClick={() => setInviteOpen(true)}>
                  Invite someone
                </Button>
              ) : null}
              {archivable.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setConfirmArchive(true)}>
                  Archive
                </Button>
              ) : null}
              {canEdit ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setBulkLinkOpen(true)}>
                    Link provider
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setBulkAddressOpen(true)}>
                    Link address
                  </Button>
                  {selectedPersonIds.length > 0 ? (
                    <Button size="sm" variant="secondary" onClick={() => setBulkCarerOpen(true)}>
                      Link primary carer
                    </Button>
                  ) : null}
                  {selectedPetIds.length > 0 ? (
                    <Button size="sm" variant="secondary" onClick={() => setBulkOwnerOpen(true)}>
                      Link owner
                    </Button>
                  ) : null}
                </>
              ) : null}
              {isAdmin ? (
                <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setSelectedProfileIds(new Set())}
              >
                Clear selection
              </Button>
            </div>
          ) : null}

          {(() => {
            const people = shown.filter((p) => p.kind !== 'pet');
            const pets = shown.filter((p) => p.kind === 'pet');
            const mixed = people.length > 0 && pets.length > 0;
            const groups = [
              { key: 'people', heading: 'People', list: people },
              { key: 'pets', heading: 'Pets', list: pets },
            ].filter((g) => g.list.length > 0);
            const togglePin = (p: ProfileSummary) => pinMutation.mutate({ id: p.id, pinned: p.pinned });
            const toggleProfile = (id: string) =>
              setSelectedProfileIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              });

            if (groups.length === 0 && search.trim()) {
              return view === 'cards' ? (
                <div className="card text-center py-8 text-sm text-muted">No one matches "{search}". Try part of their name or their room number.</div>
              ) : (
                <ProfileTable profiles={[]} search={search} onSearch={setSearch} onTogglePin={togglePin} />
              );
            }
            return groups.map((g) => (
              <div key={g.key} className="space-y-3">
                {mixed ? <h2 className="text-sm font-semibold text-muted">{g.heading}</h2> : null}
                {view === 'cards' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {g.list.map((p) => (
                      <ProfileCard
                        key={p.id}
                        profile={p}
                        collapsed={collapsedIds.has(p.id)}
                        onToggleCollapse={() =>
                          setCollapsedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            return next;
                          })
                        }
                        onTogglePin={() => togglePin(p)}
                        selectable
                        selected={selectedProfileIds.has(p.id)}
                        onToggleSelect={() => toggleProfile(p.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <ProfileTable
                    profiles={g.list}
                    search={search}
                    onSearch={setSearch}
                    onTogglePin={togglePin}
                    selectable
                    selectedIds={selectedProfileIds}
                    onToggleSelect={toggleProfile}
                    onToggleAll={(ids) =>
                      setSelectedProfileIds((prev) => {
                        const allSelected = ids.every((id) => prev.has(id));
                        const next = new Set(prev);
                        if (allSelected) ids.forEach((id) => next.delete(id));
                        else ids.forEach((id) => next.add(id));
                        return next;
                      })
                    }
                  />
                )}
              </div>
            ));
          })()}

          <BulkLinkProviderPicker
            open={bulkLinkOpen}
            profileIds={[...selectedProfileIds]}
            onClose={() => setBulkLinkOpen(false)}
            onLinked={() => {
              setBulkLinkOpen(false);
              setSelectedProfileIds(new Set());
            }}
          />

          <BulkLinkAddressPicker
            open={bulkAddressOpen}
            profileIds={[...selectedProfileIds]}
            onClose={() => setBulkAddressOpen(false)}
            onDone={() => {
              setBulkAddressOpen(false);
              setSelectedProfileIds(new Set());
              void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
            }}
          />

          <BulkLinkOwnerPicker
            open={bulkOwnerOpen}
            petIds={selectedPetIds}
            onClose={() => setBulkOwnerOpen(false)}
            onDone={() => {
              setBulkOwnerOpen(false);
              setSelectedProfileIds(new Set());
              void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
            }}
          />

          <BulkLinkCarerPicker
            open={bulkCarerOpen}
            personIds={selectedPersonIds}
            onClose={() => setBulkCarerOpen(false)}
            onDone={() => {
              setBulkCarerOpen(false);
              setSelectedProfileIds(new Set());
              void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
            }}
          />

          {inviteOpen ? (
            <BulkInviteModal
              profileIds={archivable.filter((p) => p.kind !== 'pet').map((p) => p.id)}
              notYours={selectedPersonIds.length - archivable.filter((p) => p.kind !== 'pet').length}
              onClose={() => setInviteOpen(false)}
              onSent={(message) => {
                setInviteOpen(false);
                setSelectedProfileIds(new Set());
                setInviteNote(message);
              }}
            />
          ) : null}

          {bulkEditOpen ? (
            <BulkEditModal
              profiles={selectedProfiles}
              onClose={() => setBulkEditOpen(false)}
              onDone={() => {
                setBulkEditOpen(false);
                setSelectedProfileIds(new Set());
              }}
            />
          ) : null}

          <Modal open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archive selected profiles">
            <p className="text-sm text-muted mb-4">
              Archive {archivable.length} {archivable.length === 1 ? 'profile' : 'profiles'}? This hides
              them and their records from the homeboard. Nothing is deleted, and they can be brought back later.
            </p>
            {notArchivable > 0 ? (
              <p className="text-sm text-muted mb-4">
                {notArchivable} of those chosen {notArchivable === 1 ? 'was' : 'were'} set up by someone else, so{' '}
                {notArchivable === 1 ? 'it stays' : 'they stay'} as {notArchivable === 1 ? 'it is' : 'they are'}. Only the
                person who set up a profile can archive it.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmArchive(false)}>Cancel</Button>
              <Button variant="secondary" loading={bulkArchive.isPending} onClick={() => bulkArchive.mutate()}>
                Archive
              </Button>
            </div>
          </Modal>

          <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete selected profiles">
            <div className="rounded-md border-l-4 border-red-400 bg-red-50 dark:bg-red-900/10 px-4 py-3 text-sm text-red-700 dark:text-red-300 mb-4">
              This permanently deletes {selectedProfileIds.size} {selectedProfileIds.size === 1 ? 'profile' : 'profiles'}
              {' '}and everything recorded for them: journeys, care log, tasks, medications, documents and the care
              circle. This cannot be undone.
            </div>
            <ul className="text-sm text-ink mb-4 max-h-40 overflow-y-auto list-disc pl-5">
              {selectedProfiles.map((p) => <li key={p.id}>{p.full_name}</li>)}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" loading={bulkDelete.isPending} onClick={() => bulkDelete.mutate()}>
                Delete permanently
              </Button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

/**
 * The cold start welcome: no profiles yet, so Pare introduces itself and
 * takes the first message right here. A proper full-width welcome, not a
 * floating bubble. The form path stays available for people who prefer it.
 */
function FirstStepCard() {
  const navigate = useNavigate();
  return (
    <div className="card py-8 px-6 sm:px-10 space-y-4">
      <h2 className="text-sm font-semibold text-ink">Start with one person</h2>
      <p className="text-sm text-ink max-w-2xl">
        PareCare keeps everything about the people you look after in one place: their medicines, appointments,
        contacts and papers. Start with whoever is on your mind, or with yourself. A name is enough; the rest is
        asked one step at a time, and every step can be skipped.
      </p>
      <Button onClick={() => navigate('/app/profiles/new')}>Add the first person</Button>
      <PareOffNote />
    </div>
  );
}

function PareWelcomeCard() {
  const openWithMessage = useAssistantStore((s) => s.openWithMessage);
  const [draft, setDraft] = useState('');
  const [empty, setEmpty] = useState(false);

  function submit() {
    const message = draft.trim();
    // Send always answers: an empty box says what to do.
    if (!message) {
      setEmpty(true);
      document.getElementById('pare-welcome-input')?.focus();
      return;
    }
    setEmpty(false);
    setDraft('');
    openWithMessage(message);
  }

  return (
    <div className="card py-8 px-6 sm:px-10">
      <h2 className="text-lg font-semibold text-ink mb-2">Pare</h2>
      <p className="text-sm text-ink max-w-2xl mb-5">
        Welcome to PareCare. I am Pare, and I live here to help you keep track of everyone you look after. Tell me
        who you want to start with and I will set things up.
      </p>
      <form
        className="flex gap-2 max-w-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          id="pare-welcome-input"
          type="text"
          aria-label="Talk to Pare"
          placeholder="Talk to Pare"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button type="submit">
          Send
        </Button>
      </form>
      {empty ? <p className="text-sm text-red-600 mt-2" role="alert">Write who you want to start with, for example My mum Dorothy, then send it.</p> : null}
      <p className="text-xs text-muted mt-4">
        Prefer to fill in a form yourself?{' '}
        <Link to="/app/profiles/new" className={CONTACT_LINK}>
          Create a care profile directly
        </Link>
      </p>
    </div>
  );
}

const telOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * Each phone on a card says whose it is: the label is who they are to the
 * person (Daughter, Care home, Own phone), the name sits above the number.
 * The GP has a row of their own, never a plain "Phone".
 */
const ContactRows = ({ p }: { p: ProfileSummary }) => (
  <>
    {p.primary_phone ? (
      <Row label={p.primary_phone_owner?.label ?? 'Phone'}>
        <span className="block min-w-0">
          {p.primary_phone_owner && p.primary_phone_owner.label !== 'Own phone' ? (
            <span className="block text-ink truncate">{p.primary_phone_owner.name}</span>
          ) : null}
          <a href={telOf(p.primary_phone)} className={CONTACT_LINK} onClick={(e) => e.stopPropagation()} aria-label={`Call ${p.primary_phone_owner?.name ?? p.full_name} on ${p.primary_phone}`}>
            {p.primary_phone}
          </a>
        </span>
      </Row>
    ) : null}
    {p.gp?.phone ? (
      <Row label="GP">
        <span className="block min-w-0">
          <span className="block text-ink truncate">{p.gp.name}</span>
          <a href={telOf(p.gp.phone)} className={CONTACT_LINK} onClick={(e) => e.stopPropagation()} aria-label={`Call ${p.gp.name} on ${p.gp.phone}`}>
            {p.gp.phone}
          </a>
        </span>
      </Row>
    ) : null}
    {p.primary_email ? (
      <Row label="Email">
        <a href={`mailto:${p.primary_email}`} className={`${CONTACT_LINK} truncate`} onClick={(e) => e.stopPropagation()}>
          {p.primary_email}
        </a>
      </Row>
    ) : null}
  </>
);

function ProfileCard({
  profile: p,
  collapsed,
  onToggleCollapse,
  onTogglePin,
  selectable,
  selected,
  onToggleSelect,
}: {
  profile: ProfileSummary;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onTogglePin: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const activePoa = p.poa_holders.filter((h) => h.poa_activated);
  const showPoa = activePoa.length > 0 ? activePoa : p.poa_holders;
  const alertLevel = profileAlertLevel(p.health_statuses);
  const hasActiveHealth = p.health_statuses.length > 0;

  return (
    <div data-record={p.id} data-record-kind={p.kind} className={`card relative min-w-0 overflow-hidden hover:border-primary transition-colors ${alertLevel ? ALERT_BORDER[alertLevel] : ''} ${selected ? 'ring-2 ring-primary/40' : ''}`}>
      <div className="absolute top-3 right-3 flex items-center gap-2">
        {selectable ? (
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={!!selected}
            onChange={onToggleSelect}
            aria-label={`Select ${p.full_name}`}
          />
        ) : null}
        <button
          type="button"
          aria-label={collapsed ? 'Expand card' : 'Collapse card'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
          className="text-muted hover:text-ink leading-none"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={collapsed ? '' : 'rotate-180'}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={p.pinned ? 'Unpin' : 'Pin to quick access'}
          onClick={onTogglePin}
          className={`text-lg leading-none ${p.pinned ? 'text-primary' : 'text-muted hover:text-primary'}`}
          title={p.pinned ? 'Pinned' : 'Pin to quick access'}
        >
          {p.pinned ? '★' : '☆'}
        </button>
      </div>

      <Link to={`/app/${p.id}`} className="block">
        <div className="flex items-start gap-3 pr-14">
          <Avatar accountId={p.id} name={p.full_name} avatarUrl={p.photo_url} color={p.photo_color} fetchPath={`/care-profiles/${p.id}/photo`} size={44} />
          <div className="min-w-0 flex-1">
            <h3 className="mb-0.5 truncate">{p.full_name}</h3>
            {p.relationship || p.preferred_name ? (
              <p className="text-xs text-muted truncate">
                {[p.relationship ? (isSelfRelationship(p.relationship) ? 'Your own profile' : /^resident$/i.test(p.relationship.trim()) ? 'Resident' : `Your ${p.relationship.toLowerCase()}`) : null, p.preferred_name ? `Known as ${p.preferred_name}` : null].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {!collapsed ? (
              <span className="mt-1 flex flex-wrap gap-1 min-w-0">
                {p.kind === 'pet' && (p.species || p.breed) ? (
                  <span className="badge max-w-full break-words bg-surface-2 text-muted text-xs">
                    {[p.species, p.breed].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
                {hasActiveHealth
                  ? p.health_statuses.map((hs) => (
                      <span
                        key={hs.id}
                        className={`badge max-w-full break-words text-xs ${
                          hs.is_contagious || hs.isolation_required
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                            : hs.status === 'active'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                              : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        }`}
                      >
                        {hs.name}
                        {hs.is_contagious ? ' · Contagious' : ''}
                        {hs.isolation_required ? ' · Isolating' : ''}
                        {!hs.is_contagious && !hs.isolation_required ? ` · ${conditionStatusLabel(hs.status)}` : ''}
                      </span>
                    ))
                  : p.journeys.length > 0
                    ? p.journeys.map((j) => (
                        <span key={j.id} className="badge max-w-full break-words bg-surface-2 text-muted text-xs">
                          {j.name}
                          {j.phase_name ? ` · ${j.phase_name}` : ''}
                        </span>
                      ))
                    : p.kind !== 'pet' || (!p.species && !p.breed) ? (
                        <span className="badge max-w-full break-words bg-surface-2 text-muted text-xs">No journey underway</span>
                      ) : null}
              </span>
            ) : hasActiveHealth ? (
              <span className="mt-1 flex flex-wrap gap-1 min-w-0">
                {p.health_statuses.map((hs) => (
                  <span
                    key={hs.id}
                    className={`badge max-w-full break-words text-xs ${
                      hs.is_contagious || hs.isolation_required
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    }`}
                  >
                    {hs.name}
                    {hs.is_contagious ? ' · Contagious' : ''}
                    {hs.isolation_required ? ' · Isolating' : ''}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        </div>
      </Link>

      {collapsed ? (
        (p.primary_phone || p.primary_email || p.gp?.phone) ? (
          <dl className="mt-3 space-y-1.5 text-xs">
            <ContactRows p={p} />
          </dl>
        ) : null
      ) : (
      <dl className="mt-3 space-y-1.5 text-xs">
        {p.room_number ? (
          <Row label="Room">
            <span className="text-ink">{p.room_number}</span>
          </Row>
        ) : null}
        <ContactRows p={p} />
        {showPoa.length > 0 ? (
          <Row label="Power of attorney">
            <span className="text-ink">
              {showPoa.map((h) => `${h.display_name} (${poaLabel(h.poa_type)}${h.poa_activated ? ', active' : ''})`).join(', ')}
            </span>
          </Row>
        ) : null}
        {p.next_event ? (
          <Row label="Next">
            <span className="text-ink">
              {p.next_event.title} · {format(new Date(p.next_event.next_due_at), 'd MMM, HH:mm')}
            </span>
          </Row>
        ) : null}
        {p.last_activity ? (
          <Row label="Last update">
            <span className="text-muted">
              {p.last_activity.entity_type === DOSE_ENTITY
                ? `${p.last_activity.actor_name ?? 'Someone'} ${doseActivityWords(p.last_activity.action, p.last_activity.summary)}`
                : p.last_activity.summary || `${p.last_activity.action} ${p.last_activity.entity_type}`}
              {' · '}
              {formatDistanceToNow(new Date(p.last_activity.created_at), { addSuffix: true })}
            </span>
          </Row>
        ) : null}
      </dl>
      )}
    </div>
  );
}

/** Rank a health state so a column sort can order by severity. */
function healthRank(p: ProfileSummary): number {
  const level = profileAlertLevel(p.health_statuses);
  return level === 'red' ? 3 : level === 'yellow' ? 2 : level === 'green' ? 1 : 0;
}

const byName = (a: ProfileSummary, b: ProfileSummary) => a.full_name.localeCompare(b.full_name);
// Missing values sort to the end, whichever way round.
const textLast = (x: string | null | undefined) => (x && x.trim() ? x : '\uffff');
/** Rooms in number order: 9 before 10, 101 before 201. */
const roomCompare = (a: ProfileSummary, b: ProfileSummary) =>
  textLast(a.room_number).localeCompare(textLast(b.room_number), undefined, { numeric: true }) || byName(a, b);

const TABLE_SORTS: DataSort<ProfileSummary>[] = [
  // The priority order the list arrives in: alerts, then pins.
  { key: 'priority', label: 'Needs attention first', compare: () => 0 },
  { key: 'name', label: 'Name', compare: byName },
  { key: 'room', label: 'Room', compare: roomCompare },
  { key: 'relationship', label: 'Relationship to you', compare: (a, b) => textLast(a.relationship).localeCompare(textLast(b.relationship)) || byName(a, b) },
  { key: 'health', label: 'Health', compare: (a, b) => healthRank(a) - healthRank(b) || byName(a, b), defaultDir: 'desc' },
  {
    key: 'phase',
    label: 'Phase',
    compare: (a, b) => ((firstJourney(a)?.phase_sort_order ?? -1) - (firstJourney(b)?.phase_sort_order ?? -1)) || byName(a, b),
  },
  {
    key: 'next',
    label: 'Next',
    compare: (a, b) => (a.next_event ? new Date(a.next_event.next_due_at).getTime() : Infinity) - (b.next_event ? new Date(b.next_event.next_due_at).getTime() : Infinity),
  },
  { key: 'gp', label: 'GP', compare: (a, b) => textLast(a.gp?.name).localeCompare(textLast(b.gp?.name)) || byName(a, b) },
  { key: 'gp_phone', label: 'GP phone', compare: (a, b) => textLast(a.gp?.phone).localeCompare(textLast(b.gp?.phone)) || byName(a, b) },
  { key: 'kin', label: 'Next of kin', compare: (a, b) => textLast(a.next_of_kin?.name).localeCompare(textLast(b.next_of_kin?.name)) || byName(a, b) },
  { key: 'kin_relationship', label: 'Relationship', compare: (a, b) => textLast(a.next_of_kin?.relationship).localeCompare(textLast(b.next_of_kin?.relationship)) || byName(a, b) },
  { key: 'kin_phone', label: 'Next of kin phone', compare: (a, b) => textLast(a.next_of_kin?.phone).localeCompare(textLast(b.next_of_kin?.phone)) || byName(a, b) },
  {
    key: 'updated',
    label: 'Last update',
    compare: (a, b) => (a.last_activity ? new Date(a.last_activity.created_at).getTime() : 0) - (b.last_activity ? new Date(b.last_activity.created_at).getTime() : 0),
    defaultDir: 'desc',
  },
];

function ProfileTable({
  profiles,
  search,
  onSearch,
  onTogglePin,
  selectable,
  selectedIds,
  onToggleSelect,
  onToggleAll,
}: {
  profiles: ProfileSummary[];
  search: string;
  onSearch: (v: string) => void;
  onTogglePin: (p: ProfileSummary) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleAll?: (ids: string[]) => void;
}) {
  // The list arrives already found by name or room; the table sorts and pages it.
  const dv = useDataView<ProfileSummary>({ rows: profiles, getId: (p) => p.id, sorts: TABLE_SORTS, defaultPageSize: 25 });
  const rows = dv.view;
  const allSelected = selectable && rows.length > 0 && rows.every((p) => selectedIds?.has(p.id));
  const th = (key: string, label: string) => <SortableTh label={label} sortKey={key} activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="whitespace-nowrap" />;
  const tel = (phone: string, who: string) => (
    <a href={telOf(phone)} className={CONTACT_LINK} aria-label={`Call ${who} on ${phone}`}>{phone}</a>
  );

  return (
    <div className="space-y-2">
      <DataToolbar
        search={search}
        onSearch={onSearch}
        searchPlaceholder="Find a person by name or room"
        sorts={TABLE_SORTS.map((s) => ({ key: s.key, label: s.label }))}
        sortKey={dv.sortKey}
        onSort={dv.setSortKey}
        page={dv.page}
        totalPages={dv.totalPages}
        pageSize={dv.pageSize}
        totalFiltered={dv.totalFiltered}
        onPageChange={dv.setPage}
        onPageSizeChange={dv.setPageSize}
      />
      {rows.length === 0 ? (
        <div className="card text-center py-8 text-sm text-muted">No one matches {search ? `"${search}"` : 'that'}. Try part of their name or their room number.</div>
      ) : (
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr className="text-left text-xs text-muted">
              {selectable ? (
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={!!allSelected}
                    onChange={() => onToggleAll?.(rows.map((p) => p.id))}
                    aria-label="Select all"
                  />
                </th>
              ) : null}
              <th className="px-3 py-2 w-8" aria-label="Pinned" />
              {th('name', 'Name')}
              {th('room', 'Room')}
              {th('relationship', 'Relationship to you')}
              {th('health', 'Health')}
              {th('phase', 'Phase')}
              {th('next', 'Next')}
              {th('gp', 'GP')}
              {th('gp_phone', 'GP phone')}
              {th('kin', 'Next of kin')}
              {th('kin_relationship', 'Relationship')}
              {th('kin_phone', 'Next of kin phone')}
              {th('updated', 'Last update')}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const j = firstJourney(p);
              const alertLevel = profileAlertLevel(p.health_statuses);
              const rowBg = alertLevel ? ALERT_ROW_BG[alertLevel] : '';
              return (
                <tr key={p.id} data-record={p.id} data-record-kind={p.kind} className={`border-b border-border last:border-0 align-top ${rowBg} ${selectedIds?.has(p.id) ? 'bg-primary-50/50 dark:bg-primary-900/10' : ''}`}>
                  {selectable ? (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={!!selectedIds?.has(p.id)}
                        onChange={() => onToggleSelect?.(p.id)}
                        aria-label={`Select ${p.full_name}`}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      aria-label={p.pinned ? 'Unpin' : 'Pin to quick access'}
                      title={p.pinned ? 'Unpin' : 'Pin to quick access'}
                      onClick={() => onTogglePin(p)}
                      className={`leading-none ${p.pinned ? 'text-primary' : 'text-muted hover:text-primary'}`}
                    >
                      {p.pinned ? '★' : '☆'}
                    </button>
                  </td>
                  <td data-field="name" className="px-3 py-2">
                    <Link to={`/app/${p.id}`} className={`${CONTACT_LINK} font-medium`}>
                      {p.full_name}
                    </Link>
                  </td>
                  <td data-field="room" className="px-3 py-2 text-ink whitespace-nowrap">{p.room_number ?? ''}</td>
                  <td data-field="relationship" className="px-3 py-2 text-muted">{p.relationship ?? ''}</td>
                  <td data-field="health" className="px-3 py-2">
                    {p.health_statuses.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {p.health_statuses.map((hs) => (
                          <span
                            key={hs.id}
                            className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                              hs.is_contagious || hs.isolation_required
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                : hs.status === 'active'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            }`}
                          >
                            {hs.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">OK</span>
                    )}
                  </td>
                  <td data-field="phase" className="px-3 py-2 text-muted">{j?.phase_name ?? ''}</td>
                  <td data-field="next" className="px-3 py-2 text-muted whitespace-nowrap">
                    {p.next_event ? `${p.next_event.title} · ${format(new Date(p.next_event.next_due_at), 'd MMM, HH:mm')}` : ''}
                  </td>
                  <td data-field="gp" className="px-3 py-2 text-ink">{p.gp?.name ?? ''}</td>
                  <td data-field="gp_phone" className="px-3 py-2 whitespace-nowrap">{p.gp?.phone ? tel(p.gp.phone, p.gp.name) : ''}</td>
                  <td data-field="kin" className="px-3 py-2 text-ink">{p.next_of_kin?.name ?? ''}</td>
                  <td data-field="kin_relationship" className="px-3 py-2 text-muted">{p.next_of_kin?.relationship ?? ''}</td>
                  <td data-field="kin_phone" className="px-3 py-2 whitespace-nowrap">{p.next_of_kin?.phone ? tel(p.next_of_kin.phone, p.next_of_kin.name) : ''}</td>
                  <td data-field="updated" className="px-3 py-2 text-muted">
                    {p.last_activity
                      ? `${p.last_activity.summary || `${p.last_activity.action} ${p.last_activity.entity_type}`} · ${formatDistanceToNow(new Date(p.last_activity.created_at), { addSuffix: true })}`
                      : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/** One bulk-edit field: a checkbox that turns the change on, and its input. */
function BulkFieldRow({
  on,
  onToggle,
  label,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          checked={on}
          onChange={onToggle}
        />
        Change {label.toLowerCase()}
      </label>
      {on ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

/**
 * Bulk edit: set the information the selected records share once, and apply it
 * to all of them at once. Only the fields ticked are changed; everything left
 * unticked is kept as it is, so a bulk edit never quietly wipes what it did not
 * touch. Names and dates of birth are personal, so they are edited on each
 * profile, not here. Pet-only facts appear when every record chosen is a pet.
 */
function BulkEditModal({
  profiles,
  onClose,
  onDone,
}: {
  profiles: ProfileSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const allPets = profiles.length > 0 && profiles.every((p) => p.kind === 'pet');
  const somePets = profiles.some((p) => p.kind === 'pet');
  const [apply, setApply] = useState<Set<string>>(new Set());
  const [vals, setVals] = useState<Record<string, string>>({
    owner_relationship: '', pronouns: '', primary_language: '', died_on: '',
    species: '', breed: '', desexed: 'no', notes: '',
  });
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const toggle = (key: string) =>
    setApply((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const set = (key: string, v: string) => setVals((prev) => ({ ...prev, [key]: v }));

  const buildPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    if (apply.has('owner_relationship')) patch['owner_relationship'] = vals['owner_relationship']!.trim() || null;
    if (apply.has('pronouns')) patch['pronouns'] = vals['pronouns']!.trim() || null;
    if (apply.has('primary_language')) patch['primary_language'] = vals['primary_language']!.trim() || null;
    if (apply.has('died_on')) patch['died_on'] = vals['died_on'] || null;
    if (allPets) {
      if (apply.has('species')) patch['species'] = vals['species'] || null;
      if (apply.has('breed')) patch['breed'] = vals['breed']!.trim() || null;
      if (apply.has('desexed')) patch['desexed'] = vals['desexed'] === 'yes';
      if (apply.has('notes')) patch['notes'] = vals['notes']!.trim() || null;
    }
    return patch;
  };

  const save = useMutation({
    mutationFn: async () => {
      const patch = buildPatch();
      const results = await Promise.allSettled(
        profiles.map((p) => api.patch<{ death_change: DeathChange | null }>(`/care-profiles/${p.id}`, patch))
      );
      const deaths = results
        .map((r) => (r.status === 'fulfilled' ? r.value?.death_change ?? null : null))
        .filter((d): d is DeathChange => !!d);
      return { failed: results.filter((r) => r.status === 'rejected').length, deaths };
    },
    onSuccess: ({ failed, deaths }) => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      for (const p of profiles) void queryClient.invalidateQueries({ queryKey: ['care-profile', p.id] });
      for (const key of ['tasks', 'appointments', 'notifications', 'pare-attention']) void queryClient.invalidateQueries({ queryKey: [key] });
      const parts: string[] = [];
      if (failed > 0) parts.push(`Saved to ${profiles.length - failed} of ${profiles.length}. The rest could not be changed, perhaps a record you cannot edit.`);
      // A recorded or cleared death changes a lot at once, so say what.
      if (deaths.length === 1) parts.push(deaths[0].message);
      else if (deaths.length > 1) parts.push(deathsSentence(deaths));
      if (parts.length > 0) setResult(parts.join(' '));
      else onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save.'),
  });

  const patchSize = Object.keys(buildPatch()).length;
  const inputCls = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
  const count = `${profiles.length} ${profiles.length === 1 ? 'profile' : 'profiles'}`;

  return (
    <Modal open onClose={onClose} title={`Edit ${count}`}>
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-ink">{result}</p>
          <div className="flex justify-end"><Button onClick={onDone}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Set what these records share once and it applies to all of them. Only the fields ticked are changed; the rest
            are left as they are. Names and dates of birth are personal, so they stay on each profile.
          </p>

          <BulkFieldRow on={apply.has('owner_relationship')} onToggle={() => toggle('owner_relationship')} label="Relationship to you">
            <input className={inputCls} value={vals['owner_relationship']} onChange={(e) => set('owner_relationship', e.target.value)} placeholder="e.g. Mother, Resident" />
          </BulkFieldRow>
          <BulkFieldRow on={apply.has('pronouns')} onToggle={() => toggle('pronouns')} label="Pronouns">
            <input className={inputCls} value={vals['pronouns']} onChange={(e) => set('pronouns', e.target.value)} placeholder="e.g. she/her" />
          </BulkFieldRow>
          <BulkFieldRow on={apply.has('primary_language')} onToggle={() => toggle('primary_language')} label="Main language">
            <input className={inputCls} value={vals['primary_language']} onChange={(e) => set('primary_language', e.target.value)} placeholder="e.g. English" />
          </BulkFieldRow>
          <BulkFieldRow on={apply.has('died_on')} onToggle={() => toggle('died_on')} label="Date of death">
            <input type="date" className={inputCls} value={vals['died_on']} onChange={(e) => set('died_on', e.target.value)} />
            <p className="mt-1 text-xs text-muted">Leave the date empty to clear it. Recording it gives a power of attorney in the care circle access to the secrets kept for them.</p>
          </BulkFieldRow>

          {allPets ? (
            <>
              <BulkFieldRow on={apply.has('species')} onToggle={() => toggle('species')} label="Species">
                <select className={inputCls} value={vals['species']} onChange={(e) => set('species', e.target.value)}>
                  <option value="">Choose one…</option>
                  {PET_SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </BulkFieldRow>
              <BulkFieldRow on={apply.has('breed')} onToggle={() => toggle('breed')} label="Breed">
                <input className={inputCls} value={vals['breed']} onChange={(e) => set('breed', e.target.value)} placeholder="e.g. Ragdoll" />
              </BulkFieldRow>
              <BulkFieldRow on={apply.has('desexed')} onToggle={() => toggle('desexed')} label="Desexed">
                <select className={inputCls} value={vals['desexed']} onChange={(e) => set('desexed', e.target.value)}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </BulkFieldRow>
              <BulkFieldRow on={apply.has('notes')} onToggle={() => toggle('notes')} label="Notes">
                <textarea rows={3} className={inputCls} value={vals['notes']} onChange={(e) => set('notes', e.target.value)} />
              </BulkFieldRow>
            </>
          ) : somePets ? (
            <p className="text-xs text-muted">Species, breed and other pet details appear here when every record chosen is a pet.</p>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              loading={save.isPending}
              onClick={() => {
                if (patchSize === 0) {
                  setError('Tick at least one box to choose what to change.');
                  return;
                }
                setError('');
                save.mutate();
              }}
            >
              Apply to {count}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{children}</dd>
    </div>
  );
}
