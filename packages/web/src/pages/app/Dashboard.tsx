import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { useAssistantStore } from '../../stores/assistant';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Avatar } from '../../components/ui/Avatar';
import { browserTimeZone } from '../../lib/datetime';
import { POA_TYPES, providerTypeLabel, type Provider } from '../../lib/care';

interface AttentionItem {
  profile_id: string;
  profile_name: string;
  kind: 'overdue_task' | 'unrecorded_dose' | 'stale_question' | 'out_of_stock' | 'unresolved_outcome';
  label: string;
  detail: string | null;
  section: 'tasks' | 'medications' | 'questions';
  key: string;
  urgent: boolean;
  dismissible: boolean;
}

interface SummaryJourney {
  id: string;
  name: string;
  phase_name: string | null;
  phase_sort_order: number | null;
}

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
  const canEdit = account?.role === 'admin' || account?.role === 'super_admin';

  const { data, isLoading } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: ProfileSummary[] }>('/care-profiles/summary'),
  });
  const profiles = data?.profiles ?? [];

  // What needs attention today: overdue tasks, unrecorded doses, stale
  // questions. Listed in full above the profile cards, so the user never
  // has to open the assistant to find out what is pressing.
  const { data: attentionData } = useQuery({
    queryKey: ['pare-attention'],
    queryFn: () =>
      api.get<{ count: number; items: AttentionItem[] }>(
        `/ai/dashboard/attention${browserTimeZone() ? `?tz=${encodeURIComponent(browserTimeZone()!)}` : ''}`
      ),
    enabled: profiles.length > 0,
  });
  const attentionItems = attentionData?.items ?? [];

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? api.delete(`/care-profiles/${id}/pin`) : api.post(`/care-profiles/${id}/pin`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['pinned-profiles'] });
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
    // pinned first, keeping the chosen order within each group
    return list.sort((a, b) => Number(b.pinned) - Number(a.pinned));
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
          {attentionItems.length > 0 ? <AttentionPanel items={attentionItems} /> : null}
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
                <button
                  type="button"
                  className="text-xs text-muted hover:text-ink px-2 py-1 rounded-md hover:bg-surface-2 transition-colors"
                  onClick={() =>
                    setCollapsedIds((prev) => (prev.size >= shown.length ? new Set() : new Set(shown.map((p) => p.id))))
                  }
                >
                  {collapsedIds.size >= shown.length && shown.length > 0 ? 'Expand all' : 'Collapse all'}
                </button>
              ) : null}
              {viewToggle}
            </div>
          </div>

          {canEdit && selectedProfileIds.size > 0 ? (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-primary-50 dark:bg-primary-900/20 border border-primary/30 rounded-lg text-sm">
              <span className="font-medium text-ink">{selectedProfileIds.size} selected</span>
              <Button size="sm" onClick={() => setBulkLinkOpen(true)}>
                Link provider
              </Button>
              <button
                type="button"
                className="ml-auto text-xs text-muted hover:text-ink"
                onClick={() => setSelectedProfileIds(new Set())}
              >
                Clear selection
              </button>
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
                        selectable={canEdit}
                        selected={selectedProfileIds.has(p.id)}
                        onToggleSelect={() => toggleProfile(p.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <ProfileTable
                    profiles={g.list}
                    onTogglePin={togglePin}
                    selectable={canEdit}
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

const ATTENTION_ICON: Record<AttentionItem['kind'], string> = {
  overdue_task: '⏰',
  unrecorded_dose: '💊',
  stale_question: '❓',
  out_of_stock: '📦',
  unresolved_outcome: '⚠️',
};

/**
 * A precise brief handed to Pare when the user asks to deal with an item
 * together: what it is, who it is for, and the annoying steps to carry out,
 * so Pare drafts the message, gives a ready-to-send version and helps close
 * the item out.
 */
function itemBrief(it: AttentionItem): string {
  const who = it.profile_name;
  const useRecord = `First look through ${who}'s record you have been given — providers and their contact details, the care plan, recent notes and related tasks — and use what is there. `;
  switch (it.kind) {
    case 'overdue_task':
      return `Let's do this for ${who}: "${it.label}"${it.detail ? ` (${it.detail})` : ''}. ${useRecord}`
        + `If it needs an email or message, write the actual draft here now (a clear subject and body) addressed to the right provider or contact from the record. `
        + `Only if something essential is genuinely not on file (like a missing email address) ask me for just that. Do not say you are drafting without showing the draft. `
        + `Do not mark the task complete yourself; once it is sent, offer me a confirm button to mark it done.`;
    case 'out_of_stock':
      return `${who} has run out of ${it.detail ?? 'a medication'}. ${useRecord}`
        + `Write the actual repeat request here now (a clear subject and body) addressed to their pharmacy or prescriber from the record. `
        + `Only ask me for a detail if it is genuinely missing. Do not change anything yourself; once it is arranged, ask me whether to update the supply.`;
    case 'unrecorded_dose':
      return `Let's record the doses due for ${who}${it.detail ? `: ${it.detail}` : ''}. Check the record and walk me through logging each one.`;
    case 'stale_question':
      return `Let's follow up the open question(s) for ${who} that have had no reply. ${useRecord}Draft the actual message to chase an answer here now.`;
    case 'unresolved_outcome':
      return `A task for ${who} was completed with a poor outcome: "${it.detail ?? it.label}". ${useRecord}Help me work out what went wrong and what to do next.`;
    default:
      return `Help me deal with this for ${who}: ${it.label}. ${useRecord}`;
  }
}

/**
 * The things needing attention today, listed in full so the user can see
 * and act on each one without opening the assistant. Urgent items lead and
 * stand out; every item offers to be done together with Pare, and an
 * out-of-stock alert can be set aside behind an "are you sure?" confirm.
 * Asking Pare stays available for anyone who prefers to talk it through.
 */
function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const openWithMessage = useAssistantStore((s) => s.openWithMessage);
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState<AttentionItem | null>(null);

  const dismiss = useMutation({
    mutationFn: (key: string) => api.post('/ai/dashboard/attention/dismiss', { key }),
    onSuccess: () => {
      setConfirmDismiss(null);
      void queryClient.invalidateQueries({ queryKey: ['pare-attention'] });
    },
  });

  return (
    <div className="card py-3 px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold text-ink">Needs attention today</span>
        <span className="text-muted">
          {items.length === 1 ? '1 thing' : `${items.length} things`}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => openWithMessage('What needs my attention today?')}
            className="text-primary hover:underline font-medium"
          >
            Ask Pare
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="text-muted hover:text-ink"
            aria-expanded={!collapsed}
          >
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>
      {!collapsed ? (
        <ul className="mt-2 divide-y divide-border">
          {items.map((it) => (
            <li
              key={it.key}
              className={`flex flex-wrap items-start gap-x-3 gap-y-2 py-2 -mx-2 px-2 rounded ${
                it.urgent ? 'border-l-2 border-red-500 bg-red-50 dark:bg-red-900/10' : ''
              }`}
            >
              <Link
                to={`/app/${it.profile_id}/${it.section}`}
                className="flex items-start gap-2 min-w-0 flex-1 text-sm hover:underline"
              >
                <span aria-hidden className="mt-0.5">{ATTENTION_ICON[it.kind]}</span>
                <span className="min-w-0">
                  <span className="font-medium text-ink">{it.profile_name}</span>
                  <span className={it.urgent ? 'text-red-700 dark:text-red-300' : 'text-muted'}> · {it.label}</span>
                  {it.detail ? <span className={it.urgent ? 'text-red-700 dark:text-red-300' : 'text-muted'}> ({it.detail})</span> : null}
                  {it.urgent ? (
                    <span className="ml-2 align-middle rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">
                      Urgent
                    </span>
                  ) : null}
                </span>
              </Link>
              <div className="flex items-center gap-2 shrink-0">
                {it.dismissible ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDismiss(it)}
                    className="text-xs text-muted hover:text-ink whitespace-nowrap"
                  >
                    Dismiss
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => openWithMessage(itemBrief(it), it.profile_id)}
                  className="rounded-md border border-primary/40 text-primary px-2 py-1 text-xs font-medium hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors whitespace-nowrap"
                >
                  Let's do it
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Modal open={confirmDismiss !== null} onClose={() => setConfirmDismiss(null)} title="Dismiss this alert">
        <p className="text-sm text-muted mb-4">
          Set aside{' '}
          <span className="font-medium text-ink">
            {confirmDismiss?.detail ?? confirmDismiss?.label}
          </span>{' '}
          for <span className="font-medium text-ink">{confirmDismiss?.profile_name}</span>? This is an urgent item.
          It will stop showing here until the medication is restocked, so only dismiss it if you have the repeat in hand.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDismiss(null)}>Cancel</Button>
          <Button variant="danger" loading={dismiss.isPending} onClick={() => confirmDismiss && dismiss.mutate(confirmDismiss.key)}>
            Yes, dismiss
          </Button>
        </div>
      </Modal>
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

  return (
    <div className={`card relative hover:border-primary transition-colors ${selected ? 'ring-2 ring-primary/40' : ''}`}>
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
              <span className="mt-1 flex flex-wrap gap-1">
                {p.kind === 'pet' && (p.species || p.breed) ? (
                  <span className="badge bg-surface-2 text-muted text-xs">
                    {[p.species, p.breed].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
                {p.journeys.length > 0
                  ? p.journeys.map((j) => (
                      <span key={j.id} className="badge bg-surface-2 text-muted text-xs">
                        {j.name}
                        {j.phase_name ? ` · ${j.phase_name}` : ''}
                      </span>
                    ))
                  : p.kind !== 'pet' || (!p.species && !p.breed) ? (
                      <span className="badge bg-surface-2 text-muted text-xs">No journey underway</span>
                    ) : null}
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
  const allSelected = selectable && profiles.length > 0 && profiles.every((p) => selectedIds?.has(p.id));
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
                  onChange={() => onToggleAll?.(profiles.map((p) => p.id))}
                  aria-label="Select all"
                />
              </th>
            ) : null}
            <th className="px-3 py-2 w-8" aria-label="Pinned" />
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Relationship</th>
            <th className="px-3 py-2 font-medium">Phase</th>
            <th className="px-3 py-2 font-medium">Next</th>
            <th className="px-3 py-2 font-medium">Last update</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => {
            const j = firstJourney(p);
            return (
              <tr key={p.id} className={`border-b border-border last:border-0 align-top ${selectedIds?.has(p.id) ? 'bg-primary-50/50 dark:bg-primary-900/10' : ''}`}>
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
                <td className="px-3 py-2">
                  <Link to={`/app/${p.id}`} className="font-medium text-primary hover:underline">
                    {p.full_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted">{p.relationship ?? ''}</td>
                <td className="px-3 py-2 text-muted">{j?.phase_name ?? ''}</td>
                <td className="px-3 py-2 text-muted whitespace-nowrap">
                  {p.next_event ? `${p.next_event.title} · ${format(new Date(p.next_event.next_due_at), 'd MMM, HH:mm')}` : ''}
                </td>
                <td className="px-3 py-2 text-muted">
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

interface DirectoryProvider extends Provider {
  account_id: string;
  linked_profiles: { profile_id: string; profile_name: string }[] | null;
}

function BulkLinkProviderPicker({
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{children}</dd>
    </div>
  );
}
