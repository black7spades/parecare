import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import type { AccessLevel, CareProfile } from '../../../lib/care';

export interface ProfileContext {
  profile: CareProfile;
  access: AccessLevel;
  isOwner: boolean;
  canEdit: boolean;
  /** What THIS viewer calls the person: "Mum", "Oma", else preferred/first name */
  relationship: string | null;
  careName: string;
}

export function useProfile(): ProfileContext {
  return useOutletContext<ProfileContext>();
}

const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'circle', label: 'Care circle' },
  { to: 'plan', label: 'Care plan' },
  { to: 'tasks', label: 'Tasks' },
  { to: 'calendar', label: 'Calendar' },
  { to: 'messages', label: 'Messages' },
  { to: 'memory-book', label: 'Memory book' },
  { to: 'documents', label: 'Documents' },
  { to: 'questions', label: 'Questions' },
  { to: 'providers', label: 'Providers' },
  { to: 'activity', label: 'Activity' },
  { to: 'ai', label: 'Ask PareCare' },
];

export function ProfileLayout() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['care-profile', profileId],
    queryFn: () =>
      api.get<{ profile: CareProfile; access?: AccessLevel; relationship?: string | null }>(
        `/care-profiles/${profileId}`
      ),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (error || !data?.profile) {
    return (
      <div className="card text-center py-12">
        <p className="text-muted mb-4">This care profile could not be found.</p>
        <Button onClick={() => navigate('/app')}>Back to dashboard</Button>
      </div>
    );
  }
  const profile = data.profile;
  const access: AccessLevel = data.access ?? 'owner';
  const relationship = data.relationship?.trim() || null;
  const careName = relationship ?? profile.preferred_name ?? profile.full_name.split(' ')[0];
  const context: ProfileContext = {
    profile,
    access,
    isOwner: access === 'owner',
    canEdit: access !== 'viewer',
    relationship,
    careName,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink">{profile.full_name}</h1>
          <p className="text-sm text-muted">
            {[relationship ? `Your ${relationship}` : null, profile.preferred_name ? `Known as ${profile.preferred_name}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {access === 'viewer' ? (
          <span className="badge bg-surface-2 text-muted" title="You can read everything and join the conversation, but not change records.">
            View-only access
          </span>
        ) : null}
      </div>

      <nav className="flex gap-1 border-b border-border overflow-x-auto -mb-2 pb-0">
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted hover:text-ink'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={context} />
    </div>
  );
}
