import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import {
  healthStatusCategoryLabel,
  healthStatusStatusLabel,
  type HealthStatus,
} from '../../../lib/care';

const STATUS_DOT: Record<string, string> = {
  active: 'bg-red-500',
  monitoring: 'bg-amber-500',
  resolving: 'bg-blue-500',
  resolved: 'bg-green-500',
};

export function HealthStatusOverview({ profileId }: { profileId: string }) {
  const { data } = useQuery({
    queryKey: ['health-statuses', profileId],
    queryFn: () => api.get<{ health_statuses: HealthStatus[] }>(`/care-profiles/${profileId}/health-statuses`),
  });
  const all = data?.health_statuses ?? [];
  const active = all.filter((hs) => hs.status !== 'resolved');

  if (all.length === 0) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-ink">Current health</h3>
        <Link to="health-status" className="text-xs text-primary hover:underline">
          Full details
        </Link>
      </div>
      {active.length === 0 ? (
        <p className="text-sm text-muted">No active health issues.</p>
      ) : (
        <div className="space-y-2">
          {active.map((hs) => {
            const symptomCount = hs.symptoms.filter((s) => !s.resolved_at).length;
            return (
              <div key={hs.id} className="flex items-start gap-2.5">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[hs.status] ?? 'bg-surface-2'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink">{hs.name}</span>
                    <span className="text-xs text-muted">{healthStatusStatusLabel(hs.status)}</span>
                    <span className="text-xs text-muted">{healthStatusCategoryLabel(hs.category)}</span>
                    {hs.is_contagious ? <span className="text-xs text-red-600 dark:text-red-400 font-medium">Contagious</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted mt-0.5">
                    <span>Since {format(new Date(hs.onset_date), 'd MMM yyyy')}</span>
                    {symptomCount > 0 ? <span>{symptomCount} active {symptomCount === 1 ? 'symptom' : 'symptoms'}</span> : null}
                    {hs.region ? <span>{hs.region}</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
