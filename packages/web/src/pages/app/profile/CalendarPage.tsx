import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { useProfile } from './ProfileLayout';
import type { Task } from '../../../lib/care';

type CalendarEvent = Task & { kind?: string; medication_id?: string };

export function CalendarPage() {
  const { profile } = useProfile();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });

  const { data } = useQuery({
    queryKey: ['calendar-events', profile.id, month.toISOString()],
    queryFn: () =>
      api.get<{ events: CalendarEvent[] }>(
        `/care-profiles/${profile.id}/calendar?from=${gridStart.toISOString()}&to=${gridEnd.toISOString()}`
      ),
  });
  const events = data?.events ?? [];

  const { data: feed } = useQuery({
    queryKey: ['calendar-feed', profile.id],
    queryFn: () => api.get<{ url: string; webcal: string }>(`/care-profiles/${profile.id}/calendar/feed`),
  });

  const days = useMemo(() => {
    const list: Date[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) list.push(d);
    return list;
  }, [gridStart.getTime(), gridEnd.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const [copied, setCopied] = useState(false);
  const copyFeed = async () => {
    if (!feed?.url) return;
    await navigator.clipboard.writeText(feed.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold text-ink">{format(month, 'MMMM yyyy')}</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={startOfMonth(month) <= startOfMonth(addMonths(new Date(), -12))} onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">
              ←<span className="hidden sm:inline"> Previous</span>
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMonth(startOfMonth(new Date()))}>
              Today
            </Button>
            <Button size="sm" variant="secondary" disabled={startOfMonth(month) >= startOfMonth(new Date())} onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month" title={startOfMonth(month) >= startOfMonth(new Date()) ? 'You cannot view future months' : undefined}>
              <span className="hidden sm:inline">Next </span>→
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 text-xs text-muted mb-1">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="px-1 sm:px-2 py-1 font-medium text-center sm:text-left">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-t border-l border-border">
          {days.map((day) => {
            const dayEvents = events.filter((e) => isSameDay(new Date(e.next_due_at), day));
            const today = isSameDay(day, new Date());
            return (
              <div
                key={day.toISOString()}
                className={`min-h-[3.5rem] sm:min-h-[5.5rem] border-r border-b border-border p-1 sm:p-1.5 ${
                  isSameMonth(day, month) ? 'bg-card' : 'bg-surface'
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    today ? 'bg-primary text-white font-medium' : 'text-muted'
                  }`}
                >
                  {format(day, 'd')}
                </span>
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 3).map((e) => {
                    const isMed = e.kind === 'medication';
                    const past = new Date(e.next_due_at).getTime() < Date.now();
                    // Medication doses reflect the MAR: green given, red missed,
                    // amber upcoming. Other completed tasks stay muted.
                    const cls = e.completed
                      ? isMed
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                        : 'bg-surface-2 text-muted line-through'
                      : isMed && past
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
                        : isMed
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                          : 'bg-primary-50 text-primary';
                    return (
                      <div
                        key={e.id}
                        title={`${format(new Date(e.next_due_at), 'HH:mm')} ${e.title}${isMed ? (e.completed ? ' — given' : past ? ' — missed' : '') : ''}`}
                        className={`truncate rounded px-1.5 py-0.5 text-[11px] leading-tight ${cls}`}
                      >
                        {format(new Date(e.next_due_at), 'HH:mm')} {e.title}
                      </div>
                    );
                  })}
                  {dayEvents.length > 3 ? (
                    <div className="text-[11px] text-muted px-1.5">+{dayEvents.length - 3} more</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted mt-3">
          Tasks and appointments from the{' '}
          <Link to="../tasks" className="text-primary hover:underline">
            Tasks page
          </Link>{' '}
          appear here automatically.
        </p>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-ink mb-1">Sync with Google Calendar or Outlook</h3>
        <p className="text-sm text-muted mb-3">
          Subscribe your own calendar to this care calendar and new tasks and appointments will show up automatically.
          The link is read-only and unguessable; share it only with people who should see the schedule.
        </p>
        {feed ? (
          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <code className="flex-1 truncate rounded-md border border-border bg-surface px-3 py-2 text-xs" data-testid="feed-url">
                {feed.url}
              </code>
              <Button size="sm" variant="secondary" onClick={copyFeed}>
                {copied ? 'Copied ✓' : 'Copy link'}
              </Button>
            </div>
            <ul className="text-xs text-muted space-y-1 list-disc pl-4">
              <li>
                <span className="font-medium text-ink">Google Calendar:</span> Settings → Add calendar → From URL →
                paste the link.
              </li>
              <li>
                <span className="font-medium text-ink">Outlook:</span> Add calendar → Subscribe from web → paste the
                link.
              </li>
              <li>
                <span className="font-medium text-ink">Apple Calendar:</span> File → New Calendar Subscription →
                paste the link.
              </li>
            </ul>
            <p className="text-xs text-muted">
              Calendar apps refresh subscribed feeds on their own schedule (typically every few hours).
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">Loading feed link…</p>
        )}
      </div>
    </div>
  );
}
