import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { useAssistantStore } from '../../stores/assistant';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Avatar } from '../../components/ui/Avatar';
import { POA_TYPES, PET_SPECIES, conditionStatusLabel } from '../../lib/care';
import { AttentionPanel } from '../../components/AttentionPanel';
import { useAiStatus, AI_WARMING_MESSAGE } from '../../lib/aiStatus';
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
  poa_holders: { display_name: string; poa_type: string | null; poa_activated: boolean }[];
  last_activity: { action: string; entity_type: string; summary: string | null; created_at: string; actor_name: string | null } | null;
  next_event: { title: string; next_due_at: string } | null;
  journeys: SummaryJourney[];
  health_statuses: SummaryHealthStatus[];
}

type SortKey = 'name' | 'activity' | 'journey';

const poaLabel = (type: string | null) => POA_TYPES.find((t) => t.value === type)?.label ?? 'POA';

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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const selectedPersonIds = useMemo(() => selectedProfiles.filter((p) => p.kind !== 'pet').map((p) => p.id), [selectedProfiles]);

  // Bulk archive and permanent delete each fan out one request per profile
  // so per-profile permission checks still apply; the server silently skips
  // any the user may not touch.
  const bulkArchive = useMutation({
    mutationFn: () => Promise.allSettled([...selectedProfileIds].map((id) => api.delete(`/care-profiles/${id}`))),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      setConfirmArchive(false);
      setSelectedProfileIds(new Set());
    },
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

  const shown = useMemo(() => {
    let list = profiles.slice();
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
  }, [profiles, sort, journeyFilter, poaOnly]);

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
        {account?.can_create_care_profiles !== false ? (
          <Link to="/app/profiles/new">
            <Button size="sm">Add care profile</Button>
          </Link>
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
          <PareWelcomeCard />
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

          {selectedProfileIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-primary-50 dark:bg-primary-900/20 border border-primary/30 rounded-lg text-sm">
              <span className="font-medium text-ink mr-1">{selectedProfileIds.size} selected</span>
              <Button size="sm" variant="secondary" onClick={() => setBulkEditOpen(true)}>
                Edit
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
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
              Archive {selectedProfileIds.size} {selectedProfileIds.size === 1 ? 'profile' : 'profiles'}? This hides
              them and their records from the homeboard. Nothing is deleted, and they can be brought back later.
            </p>
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
function PareWelcomeCard() {
  const openWithMessage = useAssistantStore((s) => s.openWithMessage);
  const [draft, setDraft] = useState('');

  function submit() {
    const message = draft.trim();
    if (!message) return;
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
          type="text"
          aria-label="Talk to Pare"
          placeholder="Talk to Pare"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button type="submit" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
      <p className="text-xs text-muted mt-4">
        Prefer to fill in a form yourself?{' '}
        <Link to="/app/profiles/new" className="text-primary hover:underline">
          Create a care profile directly
        </Link>
      </p>
    </div>
  );
}

const ContactRows = ({ p }: { p: ProfileSummary }) => (
  <>
    {p.primary_phone ? (
      <Row label="Phone">
        <a href={`tel:${p.primary_phone}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {p.primary_phone}
        </a>
      </Row>
    ) : null}
    {p.primary_email ? (
      <Row label="Email">
        <a href={`mailto:${p.primary_email}`} className="text-primary hover:underline truncate" onClick={(e) => e.stopPropagation()}>
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
                {[p.relationship ? `Your ${p.relationship}` : null, p.preferred_name ? `Known as ${p.preferred_name}` : null].filter(Boolean).join(' · ')}
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
        (p.primary_phone || p.primary_email) ? (
          <dl className="mt-3 space-y-1.5 text-xs">
            <ContactRows p={p} />
          </dl>
        ) : null
      ) : (
      <dl className="mt-3 space-y-1.5 text-xs">
        <ContactRows p={p} />
        {showPoa.length > 0 ? (
          <Row label="POA / executor">
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
              {p.last_activity.summary || `${p.last_activity.action} ${p.last_activity.entity_type}`}
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

type TableSortCol = 'name' | 'relationship' | 'health' | 'phase' | 'next' | 'updated';

/** Rank a health state so a column sort can order by severity. */
function healthRank(p: ProfileSummary): number {
  const level = profileAlertLevel(p.health_statuses);
  return level === 'red' ? 3 : level === 'yellow' ? 2 : level === 'green' ? 1 : 0;
}

const TABLE_COMPARATORS: Record<TableSortCol, (a: ProfileSummary, b: ProfileSummary) => number> = {
  name: (a, b) => a.full_name.localeCompare(b.full_name),
  relationship: (a, b) => (a.relationship ?? '').localeCompare(b.relationship ?? '') || a.full_name.localeCompare(b.full_name),
  health: (a, b) => healthRank(a) - healthRank(b) || a.full_name.localeCompare(b.full_name),
  phase: (a, b) =>
    ((firstJourney(a)?.phase_sort_order ?? -1) - (firstJourney(b)?.phase_sort_order ?? -1)) ||
    a.full_name.localeCompare(b.full_name),
  // Missing values sort to the end regardless of direction.
  next: (a, b) => (a.next_event ? new Date(a.next_event.next_due_at).getTime() : Infinity) - (b.next_event ? new Date(b.next_event.next_due_at).getTime() : Infinity),
  updated: (a, b) => (b.last_activity ? new Date(b.last_activity.created_at).getTime() : 0) - (a.last_activity ? new Date(a.last_activity.created_at).getTime() : 0),
};

function ProfileTable({
  profiles,
  onTogglePin,
  selectable,
  selectedIds,
  onToggleSelect,
  onToggleAll,
}: {
  profiles: ProfileSummary[];
  onTogglePin: (p: ProfileSummary) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleAll?: (ids: string[]) => void;
}) {
  // A clicked column takes over ordering; clicking it again flips direction.
  // Until then, the incoming priority order (alerts, then pins) is kept.
  const [sortCol, setSortCol] = useState<TableSortCol | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (col: TableSortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(col);
      setSortDir('asc');
    }
  };
  const rows = useMemo(() => {
    if (!sortCol) return profiles;
    const sorted = [...profiles].sort(TABLE_COMPARATORS[sortCol]);
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [profiles, sortCol, sortDir]);

  const allSelected = selectable && rows.length > 0 && rows.every((p) => selectedIds?.has(p.id));

  const SortableTh = ({ col, label }: { col: TableSortCol; label: string }) => {
    const active = sortCol === col;
    return (
      <th className="px-3 py-2 font-medium" aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button
          type="button"
          className={`flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}
          onClick={() => toggleSort(col)}
          title={active ? `Sorted ${sortDir === 'asc' ? 'ascending' : 'descending'}. Click to reverse.` : `Sort by ${label.toLowerCase()}`}
        >
          {label}
          <span aria-hidden="true" className={active ? '' : 'opacity-0'}>
            {active && sortDir === 'desc' ? '▼' : '▲'}
          </span>
        </button>
      </th>
    );
  };

  return (
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
            <SortableTh col="name" label="Name" />
            <SortableTh col="relationship" label="Relationship" />
            <SortableTh col="health" label="Health" />
            <SortableTh col="phase" label="Phase" />
            <SortableTh col="next" label="Next" />
            <SortableTh col="updated" label="Last update" />
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
                    onClick={() => onTogglePin(p)}
                    className={`leading-none ${p.pinned ? 'text-primary' : 'text-muted hover:text-primary'}`}
                  >
                    {p.pinned ? '★' : '☆'}
                  </button>
                </td>
                <td data-field="name" className="px-3 py-2">
                  <Link to={`/app/${p.id}`} className="font-medium text-primary hover:underline">
                    {p.full_name}
                  </Link>
                </td>
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
      const results = await Promise.allSettled(profiles.map((p) => api.patch(`/care-profiles/${p.id}`, patch)));
      return results.filter((r) => r.status === 'rejected').length;
    },
    onSuccess: (failed) => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      for (const p of profiles) void queryClient.invalidateQueries({ queryKey: ['care-profile', p.id] });
      if (failed > 0) {
        setResult(`Saved to ${profiles.length - failed} of ${profiles.length}. The rest could not be changed, perhaps a record you cannot edit.`);
      } else {
        onDone();
      }
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
            <Button loading={save.isPending} disabled={patchSize === 0} onClick={() => save.mutate()}>
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
