import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { CONTACT_LINK } from './ContactStrip';
import { addDays, type Roster } from '../lib/lifeEvents';
import { formatDateOnly, todayDateOnly } from '../lib/datetime';

/**
 * The roster: who does which repeating task on each day of the week.
 * Assigning a repeating task to someone puts them on it.
 */
export function RosterView({ profileId }: { profileId: string }) {
  const [week, setWeek] = useState(todayDateOnly());
  const { data, isLoading } = useQuery({
    queryKey: ['roster', profileId, week],
    queryFn: () => api.get<{ roster: Roster }>(`/care-profiles/${profileId}/reminders?view=roster&week=${week}`),
  });
  const roster = data?.roster;
  const today = todayDateOnly();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" aria-label="Previous week" onClick={() => setWeek(addDays(roster?.week_start ?? week, -7))}>←</Button>
        <Button size="sm" variant="secondary" onClick={() => setWeek(today)}>This week</Button>
        <Button size="sm" variant="secondary" aria-label="Next week" onClick={() => setWeek(addDays(roster?.week_start ?? week, 7))}>→</Button>
        {roster ? <span className="text-sm text-ink">Week of {formatDateOnly(roster.week_start, 'EEE d MMM yyyy')}</span> : null}
      </div>
      {isLoading || !roster ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !roster.anyone_assigned && roster.people.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm text-ink">No one is on the roster yet. Add a repeating task and assign it to someone.</p>
        </div>
      ) : (
        <div className="card p-0 fit-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="px-3 py-2 font-medium">Who</th>
                {roster.days.map((d) => (
                  <th key={d} className={`px-2 py-2 font-medium whitespace-nowrap ${d === today ? 'text-primary' : ''}`}>{formatDateOnly(d, 'EEE d')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.people.map((p) => (
                <tr key={p.key} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">{p.name}</td>
                  {roster.days.map((d) => (
                    <td key={d} className={`px-2 py-2 min-w-[7rem] ${d === today ? 'bg-surface-2' : ''}`}>
                      <ul className="space-y-1">
                        {p.items.filter((i) => i.date === d).map((i) => (
                          <li key={`${i.task_id}-${d}`} className="text-xs">
                            <Link to={`/app/${profileId}/tasks?record=${i.task_id}`} className={CONTACT_LINK}>{i.title}</Link>
                            {i.time ? <span className="text-muted"> {i.time}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!roster.anyone_assigned ? <p className="px-3 py-2 text-xs text-muted">No one is on the roster yet. Assign a repeating task to someone and they show here.</p> : null}
        </div>
      )}
    </div>
  );
}
