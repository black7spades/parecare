import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { useProfile } from './ProfileLayout';
import type { CareProfile, CircleMember, Task } from '../../../lib/care';

interface FanOutResult {
  created: { profile_id: string }[];
  skipped: { profile_id: string; reason: 'no_access' | 'view_only' }[];
}

const REPEAT_LABELS: Record<Task['reminder_type'], string> = {
  once: 'One-off',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export function TasksPage() {
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('09:00');
  const [repeat, setRepeat] = useState<Task['reminder_type']>('once');
  const [assignee, setAssignee] = useState('');
  const [alsoIds, setAlsoIds] = useState<string[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', profile.id],
    queryFn: () => api.get<{ reminders: Task[] }>(`/care-profiles/${profile.id}/reminders`),
  });
  const tasks = data?.reminders ?? [];

  const { data: circleData } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });
  const members = circleData?.members ?? [];
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.display_name;

  // Other profiles this carer holds, to add the same task to in one go.
  const { data: profilesData } = useQuery({
    queryKey: ['care-profiles'],
    queryFn: () =>
      api.get<{ profiles: (CareProfile & { access: string; relationship: string | null })[] }>(`/care-profiles`),
  });
  const otherProfiles = (profilesData?.profiles ?? []).filter((p) => p.id !== profile.id);
  const profileName = (id: string) => {
    const p = otherProfiles.find((x) => x.id === id);
    return p ? p.preferred_name ?? p.full_name : 'a profile';
  };

  const invalidate = (ids: string[] = [profile.id]) => {
    for (const id of ids) {
      void queryClient.invalidateQueries({ queryKey: ['tasks', id] });
      void queryClient.invalidateQueries({ queryKey: ['calendar-events', id] });
    }
    void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
  };

  const resetForm = () => {
    setTitle('');
    setNotes('');
    setError('');
    setNote('');
    setAlsoIds([]);
    setShareOpen(false);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        body: notes.trim() || null,
        reminder_type: repeat,
        next_due_at: new Date(`${dueDate}T${dueTime}`).toISOString(),
      };
      if (alsoIds.length > 0) {
        return api.post<FanOutResult>(`/care-profiles/${profile.id}/reminders/fan-out`, {
          ...payload,
          assigned_to: assignee || null,
          also_profile_ids: alsoIds,
        });
      }
      await api.post(`/care-profiles/${profile.id}/reminders`, { ...payload, assigned_to: assignee || null });
      return null;
    },
    onSuccess: (result) => {
      const targets = alsoIds;
      resetForm();
      invalidate([profile.id, ...targets]);
      if (result) {
        const added = result.created.length;
        const names = result.skipped.map((s) => profileName(s.profile_id));
        setNote(
          `Task added to ${added} ${added === 1 ? 'profile' : 'profiles'}.` +
            (names.length > 0 ? ` Skipped ${names.join(', ')}, which you cannot edit.` : '')
        );
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create task'),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/care-profiles/${profile.id}/reminders/${id}`, { completed: true }),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/reminders/${id}`),
    onSuccess: () => invalidate(),
  });

  const overdue = (t: Task) => new Date(t.next_due_at) < new Date();

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
      <div className="card">
        <h2 className="text-base font-semibold text-ink mb-4">Open tasks</h2>
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing outstanding. Tasks appear here and on the calendar. Assign them so nothing falls on one person.
          </p>
        ) : (
          <ul className="space-y-3">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 group border-b border-border last:border-0 pb-3 last:pb-0">
                <input
                  type="checkbox"
                  aria-label={`Complete ${t.title}`}
                  className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={false}
                  onChange={() => completeMutation.mutate(t.id)}
                />
                <div className="flex-1">
                  <p className="text-sm text-ink font-medium">{t.title}</p>
                  {t.body ? <p className="text-xs text-muted">{t.body}</p> : null}
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className={`text-xs ${overdue(t) ? 'text-red-600 font-medium' : 'text-muted'}`}>
                      {overdue(t) ? 'Overdue · ' : 'Due '}
                      {format(new Date(t.next_due_at), 'EEE d MMM, HH:mm')}
                    </span>
                    {t.reminder_type !== 'once' ? (
                      <span className="badge bg-surface-2 text-muted text-xs">{REPEAT_LABELS[t.reminder_type]}</span>
                    ) : null}
                    {t.assigned_to && memberName(t.assigned_to) ? (
                      <span className="badge bg-primary-50 text-primary text-xs">{memberName(t.assigned_to)}</span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${t.title}`}
                  className="text-muted hover:text-red-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-sm px-1"
                  onClick={() => deleteMutation.mutate(t.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && dueDate) createMutation.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-ink">New task</h2>
        <Input label="Task" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Pick up prescription" />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          <Input label="Time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </div>
        <div>
          <label htmlFor="task-repeat" className="block text-sm font-medium text-ink mb-1">
            Repeats
          </label>
          <select
            id="task-repeat"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as Task['reminder_type'])}
          >
            <option value="once">Doesn't repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div>
          <label htmlFor="task-assignee" className="block text-sm font-medium text-ink mb-1">
            Assign to
          </label>
          <select
            id="task-assignee"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>
        {otherProfiles.length > 0 ? (
          <div className="rounded-md border border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-sm text-ink"
              onClick={() => setShareOpen((v) => !v)}
            >
              <span>
                Also add to other profiles
                {alsoIds.length > 0 ? <span className="text-primary font-medium"> · {alsoIds.length}</span> : null}
              </span>
              <span className="text-muted">{shareOpen ? '▲' : '▼'}</span>
            </button>
            {shareOpen ? (
              <div className="max-h-40 overflow-y-auto border-t border-border px-3 py-2 space-y-1">
                <p className="text-xs text-muted mb-1">For a shared trip like the same vet or doctor visit. Each profile gets its own copy.</p>
                {otherProfiles.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={alsoIds.includes(p.id)}
                      onChange={() =>
                        setAlsoIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]))
                      }
                    />
                    <span className="text-ink">{p.preferred_name ?? p.full_name}</span>
                    {p.relationship ? <span className="text-xs text-muted">Your {p.relationship}</span> : null}
                  </label>
                ))}
                {alsoIds.length > 0 ? (
                  <p className="text-xs text-muted pt-1">The assignee applies to this profile only; copies are left unassigned.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {note ? <p className="text-sm text-primary">{note}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" className="w-full" loading={createMutation.isPending} disabled={!title.trim() || !dueDate}>
          {alsoIds.length > 0 ? `Add task to ${alsoIds.length + 1} profiles` : 'Add task'}
        </Button>
      </form>
    </div>
  );
}
