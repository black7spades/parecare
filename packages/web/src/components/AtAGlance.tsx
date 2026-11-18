import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, isToday, isTomorrow, startOfDay, endOfDay, addDays } from 'date-fns';
import { api } from '../api/client';
import type { CareDocument } from '../lib/care';

interface CalendarEvent {
  id: string;
  title: string;
  next_due_at: string;
  completed: boolean;
  kind?: string;
}

interface TaskRow {
  id: string;
  completed: boolean;
  next_due_at: string;
}

function when(d: Date): string {
  if (isToday(d)) return `Today ${format(d, 'HH:mm')}`;
  if (isTomorrow(d)) return `Tomorrow ${format(d, 'HH:mm')}`;
  return format(d, 'EEE d MMM, HH:mm');
}

/** Calendar titles carry a leading emoji for the calendar view; not here. */
const plainTitle = (t: string) => t.replace(/^\p{Extended_Pictographic}️?\s*/u, '');

function Tile({ to, label, value, detail }: { to: string; label: string; value: string; detail?: string | null }) {
  return (
    <Link to={to} className="card block p-4 hover:border-primary">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink break-words">{value}</p>
      {detail ? <p className="text-xs text-muted break-words">{detail}</p> : null}
    </Link>
  );
}

/**
 * Four answers at the top of someone's overview: what is next, what is due
 * today, what is still open and what was filed last. Each opens the page
 * that deals with it.
 */
export function AtAGlance({ profileId }: { profileId: string }) {
  const base = `/app/${profileId}`;
  const from = startOfDay(new Date());
  const to = endOfDay(addDays(from, 30));

  const calendar = useQuery({
    queryKey: ['glance-calendar', profileId, from.toISOString()],
    queryFn: () =>
      api.get<{ events: CalendarEvent[] }>(
        `/care-profiles/${profileId}/calendar?from=${from.toISOString()}&to=${to.toISOString()}`
      ),
  });
  // Same request and cache as the Tasks page, so ticking one off there
  // shows here straight away.
  const tasks = useQuery({
    queryKey: ['tasks', profileId],
    queryFn: () => api.get<{ reminders: TaskRow[] }>(`/care-profiles/${profileId}/reminders?status=all`),
  });
  const documents = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
  });

  const loading = '…';
  const trouble = 'Could not load';

  // Next appointment
  const now = Date.now();
  const events = calendar.data?.events ?? [];
  const nextAppt = events.find(
    (e) => e.kind === 'appointment' && !e.completed && new Date(e.next_due_at).getTime() >= now
  );
  const apptValue = calendar.isLoading ? loading : calendar.isError ? trouble : nextAppt ? plainTitle(nextAppt.title) : 'None booked';
  const apptDetail = nextAppt ? when(new Date(nextAppt.next_due_at)) : null;

  // Medications today
  const todaysDoses = events.filter((e) => e.kind === 'medication' && isToday(new Date(e.next_due_at)));
  const toGive = todaysDoses.filter((e) => !e.completed).length;
  const medValue = calendar.isLoading
    ? loading
    : calendar.isError
      ? trouble
      : todaysDoses.length === 0
        ? 'None scheduled'
        : toGive === 0
          ? 'All given'
          : `${toGive} ${toGive === 1 ? 'dose' : 'doses'} to give`;

  // Open tasks
  const open = (tasks.data?.reminders ?? []).filter((t) => !t.completed);
  const overdue = open.filter((t) => new Date(t.next_due_at).getTime() < now).length;
  const taskValue = tasks.isLoading ? loading : tasks.isError ? trouble : open.length === 0 ? 'All done' : `${open.length} open`;
  const taskDetail = overdue > 0 ? `${overdue} overdue` : null;

  // Newest document
  const newest = [...(documents.data?.documents ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0];
  const docValue = documents.isLoading ? loading : documents.isError ? trouble : newest ? newest.label : 'None yet';
  const docDetail = newest ? format(new Date(newest.created_at), 'd MMM yyyy') : null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile to={`${base}/appointments`} label="Next appointment" value={apptValue} detail={apptDetail} />
      <Tile to={`${base}/mar`} label="Medications today" value={medValue} />
      <Tile to={`${base}/tasks`} label="Tasks" value={taskValue} detail={taskDetail} />
      <Tile
        to={newest ? `${base}/documents?doc=${newest.id}` : `${base}/documents`}
        label="Newest document"
        value={docValue}
        detail={docDetail}
      />
    </div>
  );
}
