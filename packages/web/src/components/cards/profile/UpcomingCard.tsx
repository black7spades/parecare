import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { CardShell } from '../CardShell';
import type { CardProps } from '../types';

/** What is coming in the next fortnight. */
export function UpcomingCard({ profileId }: CardProps) {
  return (
    <CardShell>
      <UpcomingEvents profileId={profileId} />
    </CardShell>
  );
}

function UpcomingEvents({ profileId }: { profileId: string }) {
  const from = new Date();
  const to = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const { data } = useQuery({
    queryKey: ['calendar-upcoming', profileId],
    queryFn: () =>
      api.get<{
        events: Array<{
          id: string;
          title: string;
          next_due_at: string;
          completed: boolean;
          kind?: string;
          location?: string | null;
          directions_link?: string | null;
          all_day?: boolean;
        }>;
      }>(`/care-profiles/${profileId}/calendar?from=${from.toISOString()}&to=${to.toISOString()}`),
  });
  const events = (data?.events ?? []).filter((e) => e.kind !== 'medication' && !e.completed).slice(0, 6);
  if (events.length === 0) {
    return <p className="text-sm text-muted">Nothing scheduled in the next two weeks.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <Link to="calendar" className="text-xs text-primary hover:underline">
          Open the calendar
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {events.map((e) => {
          const when = new Date(e.next_due_at);
          return (
            <li key={e.id} className="py-1.5 flex items-baseline gap-3 text-sm">
              <span className="text-muted whitespace-nowrap tabular-nums">
                {when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                {e.all_day ? null : (
                  <span className="ml-1 text-ink">
                    {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </span>
              <span className="text-ink min-w-0 truncate">{e.title}</span>
              {e.location ? <span className="text-xs text-muted truncate">{e.location}</span> : null}
              {e.directions_link ? (
                <a
                  href={e.directions_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-primary hover:bg-primary/5"
                >
                  📍 Directions
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
