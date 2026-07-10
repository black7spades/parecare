import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { useAssistantStore } from '../../stores/assistant';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { POA_TYPES } from '../../lib/care';

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

  const { data, isLoading } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: ProfileSummary[] }>('/care-profiles/summary'),
  });
  const profiles = data?.profiles ?? [];

  // What Pare would flag today: overdue tasks, unrecorded doses, stale
  // questions. Drives the prompt line above the profile cards.
  const { data: attentionData } = useQuery({
    queryKey: ['pare-attention'],
    queryFn: () => api.get<{ count: number }>('/ai/dashboard/attention'),
    enabled: profiles.length > 0,
  });
  const attentionCount = attentionData?.count ?? 0;

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
          {attentionCount > 0 ? <PareAttentionLine count={attentionCount} /> : null}
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
            <div className="ml-auto">{viewToggle}</div>
          </div>

          {(() => {
            const people = shown.filter((p) => p.kind !== 'pet');
            const pets = shown.filter((p) => p.kind === 'pet');
            const mixed = people.length > 0 && pets.length > 0;
            const groups = [
              { key: 'people', heading: 'People', list: people },
              { key: 'pets', heading: 'Pets', list: pets },
            ].filter((g) => g.list.length > 0);
            const togglePin = (p: ProfileSummary) => pinMutation.mutate({ id: p.id, pinned: p.pinned });

            return groups.map((g) => (
              <div key={g.key} className="space-y-3">
                {mixed ? <h2 className="text-sm font-semibold text-muted">{g.heading}</h2> : null}
                {view === 'cards' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {g.list.map((p) => (
                      <ProfileCard key={p.id} profile={p} onTogglePin={() => togglePin(p)} />
                    ))}
                  </div>
                ) : (
                  <ProfileTable profiles={g.list} onTogglePin={togglePin} />
                )}
              </div>
            ));
          })()}
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

/** The returning-user prompt line: only shown when something needs attention. */
function PareAttentionLine({ count }: { count: number }) {
  const openWithMessage = useAssistantStore((s) => s.openWithMessage);
  return (
    <div className="card py-3 px-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="font-semibold text-ink">Pare:</span>
      <span className="text-ink">
        {count === 1 ? '1 thing needs attention today.' : `${count} things need attention today.`}
      </span>
      <button
        type="button"
        onClick={() => openWithMessage('What needs my attention today?')}
        className="text-primary hover:underline font-medium"
      >
        Ask me about them
      </button>
    </div>
  );
}

function ProfileCard({ profile: p, onTogglePin }: { profile: ProfileSummary; onTogglePin: () => void }) {
  const activePoa = p.poa_holders.filter((h) => h.poa_activated);
  const showPoa = activePoa.length > 0 ? activePoa : p.poa_holders;

  return (
    <div className="card relative hover:border-primary transition-colors">
      <button
        type="button"
        aria-label={p.pinned ? 'Unpin' : 'Pin to quick access'}
        onClick={onTogglePin}
        className={`absolute top-3 right-3 text-lg leading-none ${p.pinned ? 'text-primary' : 'text-muted hover:text-primary'}`}
        title={p.pinned ? 'Pinned' : 'Pin to quick access'}
      >
        {p.pinned ? '★' : '☆'}
      </button>

      <Link to={`/app/${p.id}`} className="block">
        <div className="flex items-start gap-3 pr-6">
          <Avatar accountId={p.id} name={p.full_name} avatarUrl={p.photo_url} color={p.photo_color} fetchPath={`/care-profiles/${p.id}/photo`} size={44} />
          <div className="min-w-0 flex-1">
            <h3 className="mb-0.5 truncate">{p.full_name}</h3>
            {p.relationship || p.preferred_name ? (
              <p className="text-xs text-muted truncate">
                {[p.relationship ? `Your ${p.relationship}` : null, p.preferred_name ? `Known as ${p.preferred_name}` : null].filter(Boolean).join(' · ')}
              </p>
            ) : null}
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
          </div>
        </div>
      </Link>

      <dl className="mt-3 space-y-1.5 text-xs">
        {p.primary_phone ? (
          <Row label="Contact">
            <a href={`tel:${p.primary_phone}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {p.primary_phone}
            </a>
          </Row>
        ) : null}
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
    </div>
  );
}

/** The same people as a spreadsheet: one row each, one fact per column. */
function ProfileTable({ profiles, onTogglePin }: { profiles: ProfileSummary[]; onTogglePin: (p: ProfileSummary) => void }) {
  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr className="text-left text-xs text-muted">
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
              <tr key={p.id} className="border-b border-border last:border-0 align-top">
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{children}</dd>
    </div>
  );
}
