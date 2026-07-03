import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { entityLabel, type ActivityEntry } from '../../../lib/care';
import { useProfile } from './ProfileLayout';

const ACTION_STYLES: Record<ActivityEntry['action'], string> = {
  created: 'bg-primary-50 text-primary',
  updated: 'bg-amber-50 text-amber-700',
  deleted: 'bg-red-50 text-red-700',
};

export function ActivityPage() {
  const { profile, careName } = useProfile();
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['activity', profile.id, page],
    queryFn: () =>
      api.get<{ entries: ActivityEntry[]; total: number }>(
        `/care-profiles/${profile.id}/activity?page=${page}&limit=${limit}`
      ),
  });
  const entries = data?.entries ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  return (
    <div className="card max-w-3xl">
      <h2 className="text-base font-semibold text-ink mb-1">Activity</h2>
      <p className="text-sm text-muted mb-4">
        Every change made to {careName}'s records: who did what, and when.
        Nobody can edit or remove this list.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">No activity recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 border-b border-border last:border-0 pb-3 last:pb-0">
              <span className={`badge text-xs capitalize shrink-0 ${ACTION_STYLES[e.action]}`}>{e.action}</span>
              <div className="flex-1">
                <p className="text-sm text-ink">
                  <span className="font-medium">{e.actor_name ?? 'A former member'}</span> {e.action} a{' '}
                  {entityLabel(e.entity_type)}
                  {e.summary ? <span className="text-muted">: “{e.summary}”</span> : null}
                </p>
                <p className="text-xs text-muted">{format(new Date(e.created_at), 'EEE d MMM yyyy, HH:mm')}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="space-x-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
