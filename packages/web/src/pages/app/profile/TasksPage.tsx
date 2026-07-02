import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { useProfile } from './ProfileLayout';
import type { CircleMember, Task } from '../../../lib/care';

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

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-events', profile.id] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profile.id}/reminders`, {
        title: title.trim(),
        body: notes.trim() || null,
        reminder_type: repeat,
        next_due_at: new Date(`${dueDate}T${dueTime}`).toISOString(),
        assigned_to: assignee || null,
      }),
    onSuccess: () => {
      setTitle('');
      setNotes('');
      setError('');
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create task'),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/care-profiles/${profile.id}/reminders/${id}`, { completed: true }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/reminders/${id}`),
    onSuccess: invalidate,
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
            Nothing outstanding. Tasks appear here and on the calendar — assign them so nothing falls on one person.
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
                  className="text-muted hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity text-sm"
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
            className="block w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
            className="block w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" className="w-full" loading={createMutation.isPending} disabled={!title.trim() || !dueDate}>
          Add task
        </Button>
      </form>
    </div>
  );
}
