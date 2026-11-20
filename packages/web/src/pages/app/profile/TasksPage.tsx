import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, startOfDay } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useProfile } from './ProfileLayout';
import { useAuthStore } from '../../../stores/auth';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { SortableTh } from '../../../components/data/SortableTh';
import { SENTIMENTS, COMPLETION_REASONS, sentimentEmoji, type CareProfile, type Task } from '../../../lib/care';
import { RecordPanel, type RecordAction } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { ContactStrip } from '../../../components/ContactStrip';
import { LinkedText } from '../../../components/LinkedText';
import { REPEAT_CHOICES, repeatLabel, repeatRank } from '../../../lib/repeat';
import { bookingHref } from '../../../lib/booking';
import { noticeFiled, refreshContacts } from '../../../stores/notice';
import {
  JoinedNotice,
  TaskEditor,
  TaskFields,
  newTaskDraft,
  taskBody,
  taskMissing,
  type JoinedInfo,
  type SavedTask,
  type TaskDraft,
} from './TaskEditor';

/** Any time that day is overdue only once the day is over. */
const isOverdue = (t: Task): boolean => {
  if (t.completed) return false;
  const due = new Date(t.next_due_at);
  return t.all_day ? due < startOfDay(new Date()) : due < new Date();
};
/** "Fri 27 Nov, any time" or "27 Nov 2026, 14:30". */
const dueText = (t: Task, long = false): string =>
  t.all_day
    ? `${format(new Date(t.next_due_at), long ? 'EEEE d MMMM yyyy' : 'EEE d MMM')}, any time`
    : format(new Date(t.next_due_at), long ? 'EEEE d MMMM yyyy, HH:mm' : 'd MMM yyyy, HH:mm');
const repeatOf = (t: Task) => t.repeat ?? t.reminder_type ?? 'once';
/** Overdue first, then open, then done. */
const statusRank = (t: Task): number => (t.completed ? 2 : isOverdue(t) ? 0 : 1);
const dueValue = (t: Task): number => new Date(t.next_due_at).getTime();
const doneValue = (t: Task): number => (t.completed_at ? new Date(t.completed_at).getTime() : 0);
const byTitle = (a: Task, b: Task) => a.title.localeCompare(b.title);
const byText = (x: string | null | undefined, y: string | null | undefined) => (x ?? '￿').localeCompare(y ?? '￿');
/** Done by booking, and not booked yet. */
const needsBooking = (t: Task) => !t.completed && !!t.books && !t.booked_appointment;

const TASK_SORTS: DataSort<Task>[] = [
  { key: 'default', label: 'Open first, then by due', compare: (a, b) => (Number(a.completed) - Number(b.completed)) || (dueValue(a) - dueValue(b)) || byTitle(a, b) },
  { key: 'due', label: 'By due date', compare: (a, b) => (dueValue(a) - dueValue(b)) || byTitle(a, b) },
  { key: 'completed', label: 'Recently completed', compare: (a, b) => (doneValue(b) - doneValue(a)) || (dueValue(a) - dueValue(b)) },
  { key: 'title', label: 'By task', compare: byTitle },
  { key: 'with', label: 'By who with', compare: (a, b) => byText(a.provider?.name, b.provider?.name) || byTitle(a, b) },
  { key: 'phone', label: 'By their phone', compare: (a, b) => byText(a.provider?.phone, b.provider?.phone) || byTitle(a, b) },
  { key: 'repeat', label: 'By repeat', compare: (a, b) => repeatRank(repeatOf(a)) - repeatRank(repeatOf(b)) || byTitle(a, b) },
  { key: 'assigned', label: 'By assigned to', compare: (a, b) => byText(a.assigned_name, b.assigned_name) || byTitle(a, b) },
  { key: 'status', label: 'By status', compare: (a, b) => statusRank(a) - statusRank(b) || (dueValue(a) - dueValue(b)) },
];

function TaskCompletionModal({
  task,
  profileId,
  onClose,
  onCompleted,
}: {
  task: Task;
  profileId: string;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const navigate = useNavigate();
  const [sentiment, setSentiment] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [customNote, setCustomNote] = useState('');

  const completeMutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/reminders/${task.id}`, {
        completed: true,
        sentiment,
        completion_reason: reason || null,
        completion_note: reason === 'other' && customNote.trim() ? customNote.trim() : null,
      }),
    onSuccess: () => {
      onCompleted();
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title="Close out task">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-ink">{task.title}</p>
          {task.body ? <p className="text-xs text-muted mt-1">{task.body}</p> : null}
        </div>

        {needsBooking(task) ? (
          <div className="rounded-md border border-border p-3 bg-surface flex flex-wrap items-center gap-2">
            <p className="flex-1 text-sm text-ink">Did this get booked? Add the appointment so the date is kept.</p>
            <Button size="sm" variant="secondary" onClick={() => navigate(bookingHref(profileId, { fromTask: task.id }))}>
              Add the appointment
            </Button>
          </div>
        ) : null}

        {task.desired_outcome ? (
          <div className="rounded-md border border-border p-3 bg-surface">
            <p className="text-xs font-medium text-muted mb-1">What done looks like</p>
            <p className="text-sm text-ink">{task.desired_outcome}</p>
          </div>
        ) : null}

        <div>
          <p className="text-sm font-medium text-ink mb-2">How did this go?</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {SENTIMENTS.map((s) => (
              <Button
                key={s.value}
                type="button"
                size="sm"
                variant={sentiment === s.value ? 'secondary' : 'ghost'}
                aria-pressed={sentiment === s.value}
                className="flex-col gap-1"
                onClick={() => setSentiment(s.value)}
              >
                <span className="text-2xl" aria-hidden="true">{s.emoji}</span>
                <span className="text-xs">{s.label}</span>
              </Button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="completion-reason" className="block text-sm font-medium text-ink mb-1">Why, if you want to say</label>
          <select
            id="completion-reason"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">Select a reason</option>
            {COMPLETION_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {reason === 'other' ? (
            <div className="mt-2">
              <Textarea
                label="Your reason"
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value.slice(0, 240))}
                rows={2}
                placeholder="What happened?"
              />
              <p className="text-xs text-muted mt-0.5 text-right">{customNote.length}/240</p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={completeMutation.isPending} onClick={() => completeMutation.mutate()}>
            {sentiment ? 'Close task' : 'Close without rating'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface Joined {
  info: JoinedInfo;
  create: Record<string, unknown>;
}

export function TasksPage() {
  const { profile, canEdit } = useProfile();
  const account = useAuthStore((s) => s.account);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<TaskDraft>(() => newTaskDraft());
  const [tried, setTried] = useState(false);
  const [note, setNote] = useState('');
  const [joined, setJoined] = useState<Joined | null>(null);
  const [inferredNote, setInferredNote] = useState<Task | null>(null);
  const [bulkNote, setBulkNote] = useState<{ text: string; waiting: { id: string; appointment_id: string } | null } | null>(null);
  const [completingTask, setCompletingTask] = useState<Task | null>(null);
  const [editing, setEditing] = useState<{ task: Task; focus?: 'who' } | null>(null);
  const missing = taskMissing(draft);

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', profile.id],
    queryFn: () => api.get<{ reminders: Task[] }>(`/care-profiles/${profile.id}/reminders?status=all`),
    refetchInterval: 5000,
  });
  const tasks = data?.reminders ?? [];

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

  // Doing a booking task means booking it: a to-do with an appointment
  // waiting on it gives that appointment its date; any other opens the
  // booking form filled from the task.
  const bookIt = (t: Task) => {
    if (t.to_book_appointment_id) navigate(`/app/${profile.id}/appointments?book=${t.to_book_appointment_id}`);
    else navigate(bookingHref(profile.id, { fromTask: t.id }));
  };
  const startCompleting = (t: Task) => {
    if (t.to_book_appointment_id) navigate(`/app/${profile.id}/appointments?book=${t.to_book_appointment_id}`);
    else setCompletingTask(t);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = taskBody(draft);
      if (draft.alsoIds.length > 0) {
        return { body, res: await api.post<SavedTask>(`/care-profiles/${profile.id}/reminders/fan-out`, { ...body, also_profile_ids: draft.alsoIds }) };
      }
      return { body, res: await api.post<SavedTask>(`/care-profiles/${profile.id}/reminders`, body) };
    },
    onSuccess: ({ body, res }) => {
      const targets = draft.alsoIds;
      setDraft(newTaskDraft());
      setTried(false);
      setError('');
      setNote('');
      invalidate([profile.id, ...targets]);
      noticeFiled(profile.id, res.filed);
      refreshContacts(queryClient);
      if (res.joined_into) setJoined({ info: res.joined_into, create: body });
      else if ((res.reminder?.inferred_fields ?? []).includes('provider_id') && res.reminder.provider) setInferredNote(res.reminder);
      if (res.created) {
        const added = res.created.length;
        const names = (res.skipped ?? []).map((s) => profileName(s.profile_id));
        setNote(
          `Task added to ${added} ${added === 1 ? 'profile' : 'profiles'}.` +
            (names.length > 0 ? ` Skipped ${names.join(', ')}, which you cannot edit.` : '')
        );
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The task did not save. Check your connection and try again.'),
  });

  const setDone = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.patch(`/care-profiles/${profile.id}/reminders/${id}`, { completed }),
    onSuccess: () => invalidate(),
  });

  const claimMutation = useMutation({
    mutationFn: (id: string) => api.post(`/care-profiles/${profile.id}/reminders/${id}/claim`),
    onSuccess: () => invalidate(),
  });

  const releaseMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/reminders/${id}/claim`),
    onSuccess: () => invalidate(),
  });

  const joinMutation = useMutation({
    mutationFn: ({ id, into }: { id: string; into: string }) => api.post(`/care-profiles/${profile.id}/reminders/${id}/join`, { into }),
    onSuccess: () => {
      setBulkNote({ text: 'Joined. One task for this booking now.', waiting: null });
      invalidate();
    },
  });

  const linkContact = useMutation({
    mutationFn: ({ id, providerId }: { id: string; providerId: string }) =>
      api.patch(`/care-profiles/${profile.id}/reminders/${id}`, { provider_id: providerId }),
    onSuccess: () => invalidate(),
  });

  // Deleting is held back a few seconds with Undo, never a "sure?" box.
  const deferDelete = useUndoStore((st) => st.deferDelete);
  const hidden = useHiddenIds();
  const deleteTasks = (items: Task[]) => {
    if (items.length === 0) return;
    deferDelete({
      message: items.length === 1 ? `Deleted ${items[0].title}.` : `Deleted ${items.length} tasks.`,
      ids: items.map((t) => t.id),
      commit: () =>
        items.length === 1
          ? api.delete(`/care-profiles/${profile.id}/reminders/${items[0].id}`)
          : api.post(`/care-profiles/${profile.id}/reminders/bulk`, { action: 'delete', ids: items.map((t) => t.id) }),
      onCommitted: () => invalidate(),
    });
  };

  const bulk = useMutation({
    mutationFn: (action: 'complete' | 'reopen') =>
      api.post<{ updated: number; waiting?: Array<{ id: string; title: string; appointment_id: string }> }>(`/care-profiles/${profile.id}/reminders/bulk`, {
        action,
        ids: dv.selectedRows.map((t) => t.id),
      }),
    onSuccess: (res, action) => {
      dv.clearSelection();
      invalidate();
      const waiting = res.waiting ?? [];
      if (action === 'complete' && waiting.length > 0) {
        const first = waiting[0];
        setBulkNote({
          text: `Marked ${res.updated} ${res.updated === 1 ? 'task' : 'tasks'} done. “${first.title}” is waiting for its date, so it stays open.`,
          waiting: { id: first.id, appointment_id: first.appointment_id },
        });
      }
    },
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
  const assignees = [...new Map(tasks.filter((t) => t.assigned_name).map((t) => [t.assigned_name!, t.assigned_name!])).values()];
  const assigneeFilter: DataFilter<Task> = {
    key: 'assignee',
    label: 'Assigned to',
    options: [{ value: '__unassigned__', label: 'Unassigned' }, ...assignees.map((n) => ({ value: n, label: n }))],
    match: (t, v) => (v === '__unassigned__' ? !t.assigned_name : t.assigned_name === v),
  };
  const repeatFilter: DataFilter<Task> = {
    key: 'repeat',
    label: 'Repeat',
    options: REPEAT_CHOICES.map((r) => ({ value: r.value, label: r.label })),
    match: (t, v) => repeatOf(t) === v,
  };

  const visible = tasks.filter((t) => !hidden.has(t.id));
  const panel = useRecordPanel(visible, (t) => t.id);
  const dv = useDataView<Task>({
    rows: visible,
    getId: (t) => t.id,
    searchText: (t) => [t.title, t.body, t.assigned_name, t.completed_by_name, t.desired_outcome, t.provider?.name, t.kind?.name].filter(Boolean).join(' '),
    sorts: TASK_SORTS,
    filters: [statusFilter, assigneeFilter, repeatFilter],
  });

  const bulkActions: ToolbarBulkAction[] = canEdit
    ? [
        { key: 'complete', label: 'Mark done', onRun: () => bulk.mutate('complete') },
        { key: 'reopen', label: 'Reopen', onRun: () => bulk.mutate('reopen') },
        { key: 'delete', label: 'Delete', destructive: true, onRun: () => { deleteTasks(dv.selectedRows); dv.clearSelection(); } },
      ]
    : [];

  const openCount = visible.filter((t) => !t.completed).length;
  const colCount = canEdit ? 10 : 8;

  const handleComplete = (t: Task) => {
    if (t.completed) setDone.mutate({ id: t.id, completed: false });
    else startCompleting(t);
  };

  const openNotes = (t: Task) => {
    panel.open(t.id);
    window.setTimeout(() => document.getElementById('record-note')?.focus(), 150);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
      <div className="space-y-3 min-w-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Tasks</h2>
          <span className="text-xs text-muted">{openCount} open · {visible.length} in the record</span>
        </div>

        {joined ? (
          <JoinedNotice profileId={profile.id} joined={joined.info} create={joined.create} onDone={() => { setJoined(null); invalidate(); }} />
        ) : null}
        {inferredNote && inferredNote.provider ? (
          <div className="card flex flex-wrap items-center gap-3" role="status">
            <p className="flex-1 text-sm text-ink">
              Linked to {inferredNote.provider.name}{inferredNote.provider.role_label ? `, ${inferredNote.provider.role_label}` : ''}, from the title.
            </p>
            <Button size="sm" variant="ghost" onClick={() => { setEditing({ task: inferredNote, focus: 'who' }); setInferredNote(null); }}>Change</Button>
            <Button size="sm" variant="ghost" onClick={() => setInferredNote(null)}>Dismiss</Button>
          </div>
        ) : null}
        {bulkNote ? (
          <div className="card flex flex-wrap items-center gap-3" role="status">
            <p className="flex-1 text-sm text-ink">{bulkNote.text}</p>
            {bulkNote.waiting ? (
              <Button size="sm" variant="secondary" onClick={() => navigate(`/app/${profile.id}/appointments?book=${bulkNote.waiting!.appointment_id}`)}>Book it</Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setBulkNote(null)}>Dismiss</Button>
          </div>
        ) : null}

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
          page={dv.page}
          totalPages={dv.totalPages}
          pageSize={dv.pageSize}
          totalFiltered={dv.totalFiltered}
          onPageChange={dv.setPage}
          onPageSizeChange={dv.setPageSize}
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
                <SortableTh label="Task" sortKey="title" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="py-3" />
                <SortableTh label="Who with" sortKey="with" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="py-3 hidden lg:table-cell" />
                <SortableTh label="Their phone" sortKey="phone" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="py-3 hidden lg:table-cell" />
                <SortableTh label="Due" sortKey="due" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="py-3" />
                <SortableTh label="Repeats" sortKey="repeat" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="py-3 hidden md:table-cell" />
                <SortableTh label="Assigned to" sortKey="assigned" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="py-3 hidden md:table-cell" />
                <SortableTh label="Status" sortKey="status" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="py-3" />
                {canEdit ? <th className="px-3 py-3 font-medium text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={colCount} className="px-3 py-8 text-center text-muted">Loading…</td></tr>
              ) : dv.view.length === 0 ? (
                <tr><td colSpan={colCount} className="px-3 py-8 text-center text-muted">
                  {tasks.length === 0 ? 'No tasks yet. Add the first one with New task, for example Book the GP for a script.' : 'No tasks match your search or filters.'}
                </td></tr>
              ) : dv.view.map((t) => (
                <tr key={t.id} {...panel.rowProps(t.id)} className={`border-b border-border last:border-0 align-top group ${t.completed ? 'opacity-60' : ''} ${RECORD_ROW_CLASS}`}>
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
                      onChange={() => handleComplete(t)}
                    />
                  </td>
                  <td className="px-3 py-3 min-w-[12rem]">
                    <div className={`text-ink font-medium ${t.completed ? 'line-through' : ''}`}>
                      {t.title}
                      {t.sentiment ? <span className="ml-1.5" title={SENTIMENTS.find((s) => s.value === t.sentiment)?.label}>{sentimentEmoji(t.sentiment)}</span> : null}
                    </div>
                    {t.kind && t.kind.system_key !== 'other' ? <div className="text-xs text-muted">{t.kind.name}</div> : null}
                    {t.body ? (
                      <div className="text-xs text-muted line-clamp-2">
                        <LinkedText text={t.body} canEdit={false} />
                      </div>
                    ) : null}
                    {t.appointment_id ? (
                      <div className="text-xs text-muted mt-0.5">
                        From{' '}
                        <Link to={`/app/${profile.id}/appointments?record=${t.appointment_id}`} className="text-primary hover:underline">
                          {t.appointment_title ?? 'an appointment'}
                          {t.appointment_starts_at ? ` on ${format(new Date(t.appointment_starts_at), 'd MMM')}` : ''}
                        </Link>
                      </div>
                    ) : null}
                    {t.merged_into_id ? <div className="text-xs text-muted mt-0.5">Joined with “{t.merged_into_title ?? 'another task'}”</div> : null}
                    {t.possible_duplicate_of && canEdit ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted">Looks like the same booking as “{t.possible_duplicate_of.title}”.</span>
                        <Button size="xs" variant="ghost" loading={joinMutation.isPending && joinMutation.variables?.id === t.id} onClick={() => joinMutation.mutate({ id: t.id, into: t.possible_duplicate_of!.id })}>
                          Join them
                        </Button>
                      </div>
                    ) : null}
                    <Button size="xs" variant="ghost" className="mt-1 -ml-2" onClick={() => openNotes(t)}>Notes</Button>
                  </td>
                  <td className="px-3 py-3 text-ink min-w-[7rem] hidden lg:table-cell">{t.provider?.name ?? ''}</td>
                  <td className="px-3 py-3 whitespace-nowrap hidden lg:table-cell">
                    {t.provider?.phone ? (
                      <a href={`tel:${t.provider.phone.replace(/[^\d+]/g, '')}`} className="text-primary hover:underline" aria-label={`Call ${t.provider.name} on ${t.provider.phone}`}>
                        {t.provider.phone}
                      </a>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={isOverdue(t) ? 'text-red-600 font-medium' : 'text-muted'}>{dueText(t)}</span>
                  </td>
                  <td className="px-3 py-3 text-muted hidden md:table-cell">{repeatOf(t) === 'once' ? '' : repeatLabel(repeatOf(t))}</td>
                  <td className="px-3 py-3 hidden md:table-cell">
                    <span className="text-muted">{t.assigned_name ?? ''}</span>
                    {t.co_owners?.length > 0 ? (
                      <span className="text-xs text-muted ml-1">
                        +{t.co_owners.length} co-owner{t.co_owners.length !== 1 ? 's' : ''}
                      </span>
                    ) : null}
                    {t.claimed_by && !t.completed ? (
                      <div className="text-xs mt-0.5">
                        {t.claimed_by === account?.id ? (
                          <span className="text-primary font-medium">Claimed by you</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">{t.claimed_by_name} is claiming this…</span>
                        )}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {t.completed && t.stopped_by_death_at && !t.completed_by_name ? (
                      <span className="text-muted">Stopped when their death was recorded</span>
                    ) : t.merged_into_id ? (
                      <span className="text-muted">Joined</span>
                    ) : t.completed ? (
                      <span className="text-muted">
                        Done{t.completed_at ? ` ${format(new Date(t.completed_at), 'd MMM yyyy')}` : ''}
                        {t.completed_by_name ? ` · ${t.completed_by_name}` : ''}
                      </span>
                    ) : t.booked_appointment ? (
                      <span className="text-muted">Booked</span>
                    ) : isOverdue(t) ? (
                      <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">Overdue</span>
                    ) : (
                      <span className="text-muted">Open</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-3 text-right whitespace-nowrap space-x-1">
                      {needsBooking(t) ? (
                        <Button size="xs" variant="secondary" onClick={() => bookIt(t)}>Book it</Button>
                      ) : null}
                      {!t.completed && !t.claimed_by && !t.assigned_to && !t.assigned_account_id ? (
                        <Button size="xs" variant="ghost" onClick={() => claimMutation.mutate(t.id)} loading={claimMutation.isPending && claimMutation.variables === t.id}>
                          Claim
                        </Button>
                      ) : null}
                      {!t.completed && t.claimed_by === account?.id ? (
                        <Button size="xs" variant="ghost" onClick={() => releaseMutation.mutate(t.id)}>Release</Button>
                      ) : null}
                      <Button size="xs" variant="ghost-danger" aria-label={`Delete ${t.title}`} onClick={() => deleteTasks([t])}>Delete</Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canEdit ? (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            setError('');
            if (missing.title) document.getElementById('task-title')?.focus();
            else if (missing.dueDate) document.getElementById('task-date')?.focus();
            else createMutation.mutate();
          }}
        >
          <h2 className="text-sm font-semibold text-ink">New task</h2>
          <TaskFields profileId={profile.id} value={draft} onChange={setDraft} errors={tried ? missing : {}} otherProfiles={otherProfiles} />
          {note ? <p className="text-sm text-primary">{note}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {tried && missing.sentence ? <p className="text-sm text-red-600" role="alert">{missing.sentence}</p> : null}
          <Button type="submit" className="w-full" loading={createMutation.isPending}>
            {draft.alsoIds.length > 0 ? `Add task to ${draft.alsoIds.length + 1} profiles` : 'Add task'}
          </Button>
        </form>
      ) : null}

      {panel.current ? (() => {
        const t = panel.current;
        const booking = needsBooking(t);
        const extra: RecordAction[] = [
          ...(booking ? [{ label: 'Mark done', onRun: () => startCompleting(t) }] : []),
          ...(!t.completed && !t.claimed_by && !t.assigned_to && !t.assigned_account_id
            ? [{ label: 'Claim', onRun: () => claimMutation.mutate(t.id), pending: claimMutation.isPending }]
            : []),
          ...(!t.completed && t.claimed_by === account?.id
            ? [{ label: 'Release', onRun: () => releaseMutation.mutate(t.id), pending: releaseMutation.isPending }]
            : []),
        ];
        const sentiment = SENTIMENTS.find((x) => x.value === t.sentiment);
        const kindInferred = (t.inferred_fields ?? []).includes('next_step_type_id');
        return (
          <RecordPanel
            key={t.id}
            kindLabel="Task"
            title={t.title}
            subtitle={`Due ${dueText(t, true)}`}
            kind="reminders"
            recordId={t.id}
            profileId={profile.id}
            canEdit={canEdit}
            // A next step's document also belongs to the appointment it came from.
            attachAlso={t.appointment_id ? [{ kind: 'appointments', id: t.appointment_id }] : []}
            onEdit={() => setEditing({ task: t })}
            fields={[
              {
                label: 'Details',
                value: t.body ? (
                  <LinkedText
                    text={t.body}
                    profileId={profile.id}
                    contact={t.provider ?? null}
                    context={t.title}
                    canEdit={canEdit}
                    onLinkContact={(providerId) => linkContact.mutateAsync({ id: t.id, providerId })}
                  />
                ) : null,
              },
              { label: 'Due', value: dueText(t, true) },
              { label: 'Repeats', value: repeatLabel(repeatOf(t)) },
              { label: 'Assigned to', value: t.assigned_name ?? 'Anyone' },
              { label: 'Shared with', value: (t.co_owners ?? []).map((c) => c.display_name).join(', ') },
              { label: 'Claimed by', value: t.claimed_by && !t.completed ? (t.claimed_by === account?.id ? 'You' : t.claimed_by_name) : null },
              {
                label: 'What kind of task',
                value: t.kind ? (
                  <span>
                    {t.kind.name}
                    {kindInferred ? <span className="block text-xs text-muted">Worked out from the title. Change it if it is wrong.</span> : null}
                  </span>
                ) : null,
              },
              {
                label: 'What it is for',
                value: t.condition ? <Link to={`/app/${profile.id}/conditions?record=${t.condition.id}`} className="text-primary hover:underline">{t.condition.name}</Link> : null,
              },
              { label: 'Goal', value: t.desired_outcome },
              {
                label: 'Booked for',
                value: t.booked_appointment ? (
                  <Link to={`/app/${profile.id}/appointments?record=${t.booked_appointment.id}`} className="text-primary hover:underline">
                    {format(new Date(t.booked_appointment.starts_at), 'EEE d MMM yyyy, HH:mm')}
                  </Link>
                ) : null,
              },
              {
                label: 'Status',
                value: t.completed && t.stopped_by_death_at && !t.completed_by_name
                  ? 'Stopped when their death was recorded'
                  : t.merged_into_id ? 'Joined with another task' : t.completed ? 'Done' : isOverdue(t) ? 'Overdue' : 'Open',
              },
              { label: 'Done on', value: t.completed && t.completed_at ? format(new Date(t.completed_at), 'd MMM yyyy, HH:mm') : null },
              { label: 'Done by', value: t.completed ? t.completed_by_name : null },
              { label: 'How it went', value: sentiment ? `${sentiment.emoji} ${sentiment.label}` : null },
              { label: 'Reason', value: t.completion_reason ? COMPLETION_REASONS.find((r) => r.value === t.completion_reason)?.label ?? t.completion_reason : null },
              { label: 'Reason in their words', value: t.completion_note },
            ]}
            links={[
              ...(t.appointment_id
                ? [{
                    label: 'Came from',
                    value: `${t.appointment_title ?? 'An appointment'}${t.appointment_starts_at ? `, ${format(new Date(t.appointment_starts_at), 'd MMM yyyy')}` : ''}`,
                    to: `/app/${profile.id}/appointments?record=${t.appointment_id}`,
                  }]
                : []),
              ...(t.booked_appointment
                ? [{ label: 'Booked as', value: t.booked_appointment.title, to: `/app/${profile.id}/appointments?record=${t.booked_appointment.id}` }]
                : []),
              ...(t.merged_into_id
                ? [{ label: 'Joined with', value: t.merged_into_title ?? 'Another task', to: `/app/${profile.id}/tasks?record=${t.merged_into_id}` }]
                : []),
            ]}
            done={
              t.completed
                ? { label: 'Reopen', onRun: () => setDone.mutate({ id: t.id, completed: false }), pending: setDone.isPending }
                : booking || t.to_book_appointment_id
                  ? { label: 'Book it', onRun: () => bookIt(t) }
                  : { label: 'Mark done', onRun: () => startCompleting(t) }
            }
            extra={extra}
            onDelete={() => {
              deleteTasks([t]);
              panel.close();
            }}
            onClose={panel.close}
          >
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Who with</h3>
              {t.provider ? (
                <ContactStrip
                  contact={t.provider}
                  profileId={profile.id}
                  book={booking ? false : { fromTask: t.id }}
                  recordHref={t.provider.source === 'contact' && t.provider.id ? `/app/${profile.id}/providers?record=${t.provider.id}` : undefined}
                  onAddPhone={canEdit ? () => setEditing({ task: t, focus: 'who' }) : undefined}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted">No one linked yet.</p>
                  {canEdit ? <Button size="xs" variant="ghost" onClick={() => setEditing({ task: t, focus: 'who' })}>Add who it is with</Button> : null}
                </div>
              )}
            </section>
          </RecordPanel>
        );
      })() : null}

      {editing ? (
        <TaskEditor
          key={`edit-${editing.task.id}`}
          profileId={profile.id}
          task={editing.task}
          focus={editing.focus}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
            void queryClient.invalidateQueries({ queryKey: ['record-extras', profile.id] });
          }}
        />
      ) : null}

      {completingTask ? (
        <TaskCompletionModal
          task={completingTask}
          profileId={profile.id}
          onClose={() => setCompletingTask(null)}
          onCompleted={() => invalidate()}
        />
      ) : null}
    </div>
  );
}

