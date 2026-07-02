import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import type { CareProfile } from '../../../lib/care';

export interface ProfileContext {
  profile: CareProfile;
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
  { to: 'ai', label: 'Ask PareCare' },
];

export function ProfileLayout() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['care-profile', profileId],
    queryFn: () => api.get<{ profile: CareProfile }>(`/care-profiles/${profileId}`),
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">{profile.full_name}</h1>
        {profile.preferred_name ? <p className="text-sm text-muted">Known as {profile.preferred_name}</p> : null}
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

      <Outlet context={{ profile } satisfies ProfileContext} />
    </div>
  );
}
