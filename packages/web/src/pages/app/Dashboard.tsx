import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';

interface CareProfile {
  id: string;
  full_name: string;
  current_phase: string;
  preferred_name: string | null;
}

export function Dashboard() {
  const { account } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ['care-profiles'],
    queryFn: () => api.get<{ profiles: CareProfile[] }>('/care-profiles'),
  });

  const profiles = data?.profiles ?? [];

  const phaseLabel = (phase: string) =>
    phase.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Welcome, {account?.display_name}</h1>
        <Link to="/app/profiles/new">
          <Button size="sm">Add care profile</Button>
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : profiles.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted mb-4">No care profiles yet.</p>
          <Link to="/app/profiles/new">
            <Button>Create your first profile</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {profiles.map((p) => (
            <Link key={p.id} to={`/app/${p.id}/dashboard`} className="card hover:border-primary transition-colors">
              <h3 className="mb-1">{p.full_name}</h3>
              {p.preferred_name ? (
                <p className="text-xs text-muted mb-3">Known as {p.preferred_name}</p>
              ) : null}
              <span className="badge bg-surface-2 text-muted text-xs">
                {phaseLabel(p.current_phase)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
