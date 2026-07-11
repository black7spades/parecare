import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { useProfile } from './ProfileLayout';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
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

const isOverdue = (t: Task): boolean => !t.completed && new Date(t.next_due_at) < new Date();
const dueValue = (t: Task): number => new Date(t.next_due_at).getTime();
const doneValue = (t: Task): number => (t.completed_at ? new Date(t.completed_at).getTime() : 0);
const byTitle = (a: Task, b: Task) => a.title.localeCompare(b.title);

const TASK_SORTS: DataSort<Task>[] = [
  { key: 'default', label: 'Open first, then by due', compare: (a, b) => (Number(a.completed) - Number(b.completed)) || (dueValue(a) - dueValue(b)) || byTitle(a, b) },
  { key: 'due', label: 'By due date', compare: (a, b) => (dueValue(a) - dueValue(b)) || byTitle(a, b) },
  { key: 'completed', label: 'Recently completed', compare: (a, b) => (doneValue(b) - doneValue(a)) || (dueValue(a) - dueValue(b)) },
  { key: 'title', label: 'By task (A–Z)', compare: byTitle },
];

export function TasksPage() {
  const { profile, canEdit } = useProfile();
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

  // The whole record, open and completed, so nothing disappears when ticked off.
  const { data, isLoading } = useQuery({
    queryKey: ['tasks', profile.id],
    queryFn: () => api.get<{ reminders: Task[] }>(`/care-profiles/${profile.id}/reminders?status=all`),
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
    void queryClient.invalidateQueries({ queryKey: ['pare-attention'] });
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

  const setDone = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.patch(`/care-profiles/${profile.id}/reminders/${id}`, { completed }),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/reminders/${id}`),
    onSuccess: () => invalidate(),
  });

  const bulk = useMutation({
    mutationFn: (action: 'complete' | 'reopen' | 'delete') =>
      api.post(`/care-profiles/${profile.id}/reminders/bulk`, { action, ids: dv.selectedRows.map((t) => t.id) }),
    onSuccess: () => { dv.clearSelection(); invalidate(); },
  });

  const statusFilter: DataFilter<Task> = {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'overdue', label: 'Overdue' },
      { value: 'completed', label: 'Completed' },
    ],
    match: (t, v) => (v === 'completed' ? t.completed : v === 'overdue' ? isOverdue(t) : !t.completed),
  };
  const assigneeFilter: DataFilter<Task> = {
    key: 'assignee',
    label: 'Assigned to',
    options: [{ value: '__unassigned__', label: 'Unassigned' }, ...members.map((m) => ({ value: m.id, label: m.display_name }))],
    match: (t, v) => (v === '__unassigned__' ? !t.assigned_to : t.assigned_to === v),
  };
  const repeatFilter: DataFilter<Task> = {
    key: 'repeat',
    label: 'Repeat',
    options: (['once', 'daily', 'weekly', 'monthly'] as Task['reminder_type'][]).map((r) => ({ value: r, label: REPEAT_LABELS[r] })),
    match: (t, v) => t.reminder_type === v,
  };

  const dv = useDataView<Task>({
    rows: tasks,
    getId: (t) => t.id,
    searchText: (t) => [t.title, t.body, memberName(t.assigned_to), t.completed_by_name].filter(Boolean).join(' '),
    sorts: TASK_SORTS,
    filters: [statusFilter, assigneeFilter, repeatFilter],
  });

  const bulkActions: ToolbarBulkAction[] = canEdit
    ? [
        { key: 'complete', label: 'Mark done', onRun: () => bulk.mutate('complete') },
        { key: 'reopen', label: 'Reopen', onRun: () => bulk.mutate('reopen') },
        { key: 'delete', label: 'Delete', destructive: true, onRun: () => bulk.mutate('delete') },
      ]
    : [];

  const openCount = tasks.filter((t) => !t.completed).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Tasks</h2>
          <span className="text-xs text-muted">{openCount} open · {tasks.length} in the record</span>
        </div>

        <DataToolbar
          search={dv.search}
          onSearch={dv.setSearch}
          searchPlaceholder="Search tasks, notes or people…"
          sorts={TASK_SORTS.map((s) => ({ key: s.key, label: s.label }))}
          sortKey={dv.sortKey}
          onSort={dv.setSortKey}
          filters={[statusFilter, assigneeFilter, repeatFilter].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
          filterValues={dv.filterValues}
          onFilter={dv.setFilter}
          selectedCount={dv.selectedRows.length}
          bulkActions={bulkActions}
          onClearSelection={dv.clearSelection}
        />

        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                {canEdit ? (
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" aria-label="Select all" className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={dv.allSelected} onChange={dv.toggleAll} />
                  </th>
                ) : null}
                <th className="px-2 py-3 w-8" aria-label="Done" />
                <th className="px-3 py-3 font-medium">Task</th>
                <th className="px-3 py-3 font-medium">Due</th>
                <th className="px-3 py-3 font-medium">Repeat</th>
                <th className="px-3 py-3 font-medium">Assigned to</th>
                <th className="px-3 py-3 font-medium">Status</th>
                {canEdit ? <th className="px-3 py-3 font-medium text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={canEdit ? 8 : 6} className="px-3 py-8 text-center text-muted">Loading…</td></tr>
              ) : dv.view.length === 0 ? (
                <tr><td colSpan={canEdit ? 8 : 6} className="px-3 py-8 text-center text-muted">
                  {tasks.length === 0 ? 'No tasks yet. Add one on the right; assign it so nothing falls on one person.' : 'No tasks match your search or filters.'}
                </td></tr>
              ) : dv.view.map((t) => (
                <tr key={t.id} className={`border-b border-border last:border-0 align-top group ${t.completed ? 'opacity-60' : ''}`}>
                  {canEdit ? (
                    <td className="px-3 py-3">
                      <input type="checkbox" aria-label={`Select ${t.title}`} className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={dv.selected.has(t.id)} onChange={() => dv.toggle(t.id)} />
                    </td>
                  ) : null}
                  <td className="px-2 py-3">
                    <input
                      type="checkbox"
                      aria-label={t.completed ? `Reopen ${t.title}` : `Mark ${t.title} done`}
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
                      checked={t.completed}
                      disabled={!canEdit || setDone.isPending}
                      onChange={() => setDone.mutate({ id: t.id, completed: !t.completed })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className={`text-ink font-medium ${t.completed ? 'line-through' : ''}`}>{t.title}</div>
                    {t.body ? <div className="text-xs text-muted">{t.body}</div> : null}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={isOverdue(t) ? 'text-red-600 font-medium' : 'text-muted'}>
                      {format(new Date(t.next_due_at), 'd MMM yyyy, HH:mm')}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted">{t.reminder_type === 'once' ? '—' : REPEAT_LABELS[t.reminder_type]}</td>
                  <td className="px-3 py-3 text-muted">{memberName(t.assigned_to) ?? '—'}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {t.completed ? (
                      <span className="text-muted">
                        Done{t.completed_at ? ` ${format(new Date(t.completed_at), 'd MMM yyyy')}` : ''}
                        {t.completed_by_name ? ` · ${t.completed_by_name}` : ''}
                      </span>
                    ) : isOverdue(t) ? (
                      <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">Overdue</span>
                    ) : (
                      <span className="text-muted">Open</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        aria-label={`Delete ${t.title}`}
                        className="text-xs text-muted hover:text-red-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        onClick={() => deleteMutation.mutate(t.id)}
                      >
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
