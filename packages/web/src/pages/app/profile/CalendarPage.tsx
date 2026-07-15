import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useProfile } from './ProfileLayout';
import type { Task } from '../../../lib/care';

type CalendarEvent = Task & { kind?: string; medication_id?: string };

type MedicationStatus = 'given' | 'missed' | 'upcoming';

function medicationStatus(e: CalendarEvent): MedicationStatus {
  if (e.completed) return 'given';
  return new Date(e.next_due_at).getTime() < Date.now() ? 'missed' : 'upcoming';
}

const MED_STATUS_CLASSES: Record<MedicationStatus, string> = {
  given: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  missed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  upcoming: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
};

const EVENT_KIND_CLASSES: Record<string, string> = {
  birthday: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
  health_status: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  appointment: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
};

const EVENT_KIND_LABELS: Record<string, string> = {
  task: 'Tasks',
  medication: 'Medications',
  birthday: 'Birthdays',
  health_status: 'Health statuses',
  appointment: 'Appointments',
};

function eventKindClass(e: CalendarEvent): string {
  if (e.kind && EVENT_KIND_CLASSES[e.kind]) return EVENT_KIND_CLASSES[e.kind];
  if (e.kind === 'medication') return MED_STATUS_CLASSES[medicationStatus(e)];
  return e.completed ? 'bg-surface-2 text-muted line-through' : 'bg-primary-50 text-primary';
}

const APPOINTMENT_TYPES = [
  { value: 'consultation', label: 'Consultation' },
  { value: 'test', label: 'Test' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'therapy', label: 'Therapy session' },
  { value: 'review', label: 'Review' },
  { value: 'vaccination', label: 'Vaccination' },
  { value: 'other', label: 'Other' },
] as const;

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function CalendarPage() {
  const { profile, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });

  const { data } = useQuery({
    queryKey: ['calendar-events', profile.id, month.toISOString()],
    queryFn: () =>
      api.get<{ events: CalendarEvent[] }>(
        `/care-profiles/${profile.id}/calendar?from=${gridStart.toISOString()}&to=${gridEnd.toISOString()}`
      ),
  });
  const allEvents = data?.events ?? [];
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const toggleKind = (kind: string) =>
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  const events = allEvents.filter((e) => {
    const kind = e.kind ?? 'task';
    return !hiddenKinds.has(kind);
  });

  const availableKinds = useMemo(() => {
    const kinds = new Set(allEvents.map((e) => e.kind ?? 'task'));
    return ['task', 'medication', 'appointment', 'birthday', 'health_status'].filter((k) => kinds.has(k));
  }, [allEvents]);

  const { data: feed } = useQuery({
    queryKey: ['calendar-feed', profile.id],
    queryFn: () => api.get<{ url: string; webcal: string }>(`/care-profiles/${profile.id}/calendar/feed`),
  });

  const days = useMemo(() => {
    const list: Date[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) list.push(d);
    return list;
  }, [gridStart.getTime(), gridEnd.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const [copied, setCopied] = useState(false);
  const copyFeed = async () => {
    if (!feed?.url) return;
    await navigator.clipboard.writeText(feed.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const invalidateCalendar = () => {
    void queryClient.invalidateQueries({ queryKey: ['calendar-events', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['appointments', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['tasks', profile.id] });
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

        {availableKinds.length > 1 ? (
          <div className="flex flex-wrap gap-2 mb-3">
            {availableKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  hiddenKinds.has(kind)
                    ? 'border-border text-muted bg-surface line-through'
                    : 'border-primary text-primary bg-primary-50 font-medium'
                }`}
              >
                {EVENT_KIND_LABELS[kind] ?? kind}
              </button>
            ))}
          </div>
        ) : null}

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
            const dayEvents = events
              .filter((e) => isSameDay(new Date(e.next_due_at), day))
              .sort((a, b) => new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime());
            const today = isSameDay(day, new Date());
            const cellClasses = `min-h-[3.5rem] sm:min-h-[5.5rem] border-r border-b border-border p-1 sm:p-1.5 ${
              isSameMonth(day, month) ? 'bg-card' : 'bg-surface'
            }`;
            const dayNumber = (
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  today ? 'bg-primary text-white font-medium' : 'text-muted'
                }`}
              >
                {format(day, 'd')}
              </span>
            );
            if (dayEvents.length === 0) {
              return (
                <div key={day.toISOString()} className={cellClasses}>
                  {dayNumber}
                </div>
              );
            }

            const medEvents = dayEvents.filter((e) => e.kind === 'medication');
            const collapseMeds = medEvents.length >= 2;
            const listed = collapseMeds ? dayEvents.filter((e) => e.kind !== 'medication') : dayEvents;
            const shown = listed.slice(0, collapseMeds ? 2 : 3);
            const hiddenCount = listed.length - shown.length;
            const anyMissed = medEvents.some((e) => medicationStatus(e) === 'missed');
            const allGiven = medEvents.length > 0 && medEvents.every((e) => e.completed);
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelectedDay(day)}
                title={`View all events on ${format(day, 'd MMMM')}`}
                className={`${cellClasses} block w-full text-left cursor-pointer transition-colors hover:bg-surface-2`}
              >
                {dayNumber}
                <div className="mt-1 space-y-1">
                  {shown.map((e) => {
                    const isMed = e.kind === 'medication';
                    const cls = eventKindClass(e);
                    return (
                      <div
                        key={e.id}
                        title={`${format(new Date(e.next_due_at), 'HH:mm')} ${e.title}${isMed ? `, ${medicationStatus(e)}` : ''}`}
                        className={`truncate rounded px-1.5 py-0.5 text-[11px] leading-tight ${cls}`}
                      >
                        {format(new Date(e.next_due_at), 'HH:mm')} {e.title}
                      </div>
                    );
                  })}
                  {collapseMeds ? (
                    <div
                      title={medEvents
                        .map((e) => `${format(new Date(e.next_due_at), 'HH:mm')} ${e.title}, ${medicationStatus(e)}`)
                        .join('\n')}
                      className={`truncate rounded px-1.5 py-0.5 text-[11px] leading-tight font-medium ${
                        MED_STATUS_CLASSES[anyMissed ? 'missed' : allGiven ? 'given' : 'upcoming']
                      }`}
                    >
                      {medEvents.length} medication doses
                    </div>
                  ) : null}
                  {hiddenCount > 0 ? <div className="text-[11px] text-muted px-1.5">+{hiddenCount} more</div> : null}
                </div>
              </button>
            );
          })}
        </div>
        {selectedDay ? (
          <DayEventsModal
            day={selectedDay}
            events={events
              .filter((e) => isSameDay(new Date(e.next_due_at), selectedDay))
              .sort((a, b) => new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime())}
            onClose={() => setSelectedDay(null)}
          />
        ) : null}

        {canEdit ? (
          <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowAppointmentModal(true)}>
              Add appointment
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowTaskModal(true)}>
              Add task
            </Button>
          </div>
        ) : null}

        <p className="text-xs text-muted mt-3">
          Tasks and appointments from the{' '}
          <Link to="../tasks" className="text-primary hover:underline">
            Tasks page
          </Link>{' '}
          and{' '}
          <Link to="../appointments" className="text-primary hover:underline">
            Appointments page
          </Link>{' '}
          appear here automatically.
        </p>
      </div>

      {showAppointmentModal ? (
        <AddAppointmentModal
          profileId={profile.id}
          onClose={() => setShowAppointmentModal(false)}
          onSaved={() => {
            setShowAppointmentModal(false);
            invalidateCalendar();
          }}
        />
      ) : null}

      {showTaskModal ? (
        <AddTaskModal
          profileId={profile.id}
          onClose={() => setShowTaskModal(false)}
          onSaved={() => {
            setShowTaskModal(false);
            invalidateCalendar();
          }}
        />
      ) : null}

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
          <p className="text-sm text-muted">Loading feed link...</p>
        )}
      </div>
    </div>
  );
}

function DayEventsModal({ day, events, onClose }: { day: Date; events: CalendarEvent[]; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={format(day, 'EEEE d MMMM yyyy')}>
      {events.length === 0 ? (
        <p className="text-sm text-muted">Nothing scheduled on this day.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => {
            const isMed = e.kind === 'medication';
            const status = isMed ? medicationStatus(e) : e.completed ? 'completed' : null;
            const chipCls = isMed
              ? MED_STATUS_CLASSES[medicationStatus(e)]
              : e.kind && EVENT_KIND_CLASSES[e.kind]
                ? EVENT_KIND_CLASSES[e.kind]
                : 'bg-surface-2 text-muted';
            return (
              <li key={e.id} className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
                <span className="text-sm font-medium text-ink tabular-nums">
                  {format(new Date(e.next_due_at), 'HH:mm')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm text-ink ${!isMed && e.completed ? 'line-through text-muted' : ''}`}>
                    {e.title}
                  </p>
                  {e.body ? <p className="text-xs text-muted mt-0.5">{e.body}</p> : null}
                </div>
                {status ? (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${chipCls}`}>
                    {status}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

function AddAppointmentModal({
  profileId,
  onClose,
  onSaved,
}: {
  profileId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('consultation');
  const [providerId, setProviderId] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const { data: providersData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Array<{ id: string; name: string; address: string | null; directions_link: string | null }> }>(
      `/care-profiles/${profileId}/providers`
    ),
  });
  const providers = providersData?.providers ?? [];

  const handleProviderChange = (newId: string) => {
    setProviderId(newId);
    if (newId) {
      const p = providers.find((pr) => pr.id === newId);
      if (p) {
        if (p.directions_link) setLocation(p.directions_link);
        else if (p.address) setLocation(p.address);
      }
    }
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/appointments`, {
        title: title.trim(),
        appointment_type: type,
        provider_id: providerId || null,
        location: location.trim() || null,
        starts_at: new Date(`${startDate}T${startTime}`).toISOString(),
        notes: notes.trim() || null,
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to add appointment'),
  });

  return (
    <Modal open onClose={onClose} title="Add appointment" wide>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            label="What for"
            placeholder="e.g. Cardiology check-up"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Kind</span>
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Provider</span>
            <select className={inputClass} value={providerId} onChange={(e) => handleProviderChange(e.target.value)}>
              <option value="">No provider linked</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <Input
            label="Location"
            placeholder="e.g. Suite 4, 12 High St"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <Input
            label="Date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="Time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={mutation.isPending}
            disabled={!title.trim() || !startDate}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AddTaskModal({
  profileId,
  onClose,
  onSaved,
}: {
  profileId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/reminders`, {
        title: title.trim(),
        reminder_type: 'once',
        next_due_at: new Date(`${date}T${time}`).toISOString(),
        body: notes.trim() || null,
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to add task'),
  });

  return (
    <Modal open onClose={onClose} title="Add task">
      <div className="space-y-4">
        <Input
          label="Task"
          placeholder="e.g. Pick up prescription"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            label="Time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={mutation.isPending}
            disabled={!title.trim() || !date}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
