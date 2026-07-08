import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { CARE_PHASES, phaseLabel, POA_TYPES } from '../../lib/care';

interface ProfileSummary {
  id: string;
  full_name: string;
  preferred_name: string | null;
  relationship: string | null;
  access: 'owner' | 'member';
  current_phase: string;
  photo_url: string | null;
  photo_color: string | null;
  date_of_birth: string | null;
  pinned: boolean;
  primary_phone: string | null;
  poa_holders: { display_name: string; poa_type: string | null; poa_activated: boolean }[];
  last_activity: { action: string; entity_type: string; summary: string | null; created_at: string; actor_name: string | null } | null;
  next_event: { title: string; next_due_at: string } | null;
}

type SortKey = 'name' | 'activity' | 'phase';

const poaLabel = (type: string | null) => POA_TYPES.find((t) => t.value === type)?.label ?? 'POA';

export function Dashboard() {
  const { account } = useAuthStore();
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<SortKey>('name');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [poaOnly, setPoaOnly] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: ProfileSummary[] }>('/care-profiles/summary'),
  });
  const profiles = data?.profiles ?? [];

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? api.delete(`/care-profiles/${id}/pin`) : api.post(`/care-profiles/${id}/pin`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['pinned-profiles'] });
    },
  });

  const shown = useMemo(() => {
    let list = profiles.slice();
    if (phaseFilter) list = list.filter((p) => p.current_phase === phaseFilter);
    if (poaOnly) list = list.filter((p) => p.poa_holders.length > 0);
    list.sort((a, b) => {
      if (sort === 'name') return a.full_name.localeCompare(b.full_name);
      if (sort === 'phase') return CARE_PHASES.findIndex((x) => x.value === a.current_phase) - CARE_PHASES.findIndex((x) => x.value === b.current_phase);
      // activity: most recent first
      const ta = a.last_activity ? new Date(a.last_activity.created_at).getTime() : 0;
      const tb = b.last_activity ? new Date(b.last_activity.created_at).getTime() : 0;
      return tb - ta;
    });
    // pinned first, keeping the chosen order within each group
    return list.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [profiles, sort, phaseFilter, poaOnly]);

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
        <div className="card text-center py-12">
          {account?.can_create_care_profiles !== false ? (
            <>
              <p className="text-muted mb-4">No care profiles yet.</p>
              <Link to="/app/profiles/new">
                <Button>Create your first profile</Button>
              </Link>
            </>
          ) : (
            <p className="text-muted">
              No one has shared a care profile with you yet. When someone invites you to a care circle, the person
              will appear here.
            </p>
          )}
        </div>
      ) : (
        <>
          {profiles.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="text-muted">Sort</label>
              <select
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="name">Name</option>
                <option value="activity">Recent activity</option>
                <option value="phase">Care phase</option>
              </select>
              <select
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={phaseFilter}
                onChange={(e) => setPhaseFilter(e.target.value)}
              >
                <option value="">All phases</option>
                {CARE_PHASES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-muted">
                <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={poaOnly} onChange={(e) => setPoaOnly(e.target.checked)} />
                Has POA
              </label>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {shown.map((p) => (
              <ProfileCard key={p.id} profile={p} onTogglePin={() => pinMutation.mutate({ id: p.id, pinned: p.pinned })} />
            ))}
          </div>
        </>
      )}
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
            <span className="badge bg-surface-2 text-muted text-xs mt-1 inline-block">{phaseLabel(p.current_phase)}</span>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{children}</dd>
    </div>
  );
}
