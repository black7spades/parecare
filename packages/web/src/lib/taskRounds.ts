import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../api/client';
import { useNoticeStore } from '../stores/notice';

/** A repeating task done for this round, as the API returns it when ticked. */
export interface TaskRound {
  id: string;
  task_id: string;
  title: string;
  was_due_at: string;
  next_due_at: string;
}

/**
 * After ticking a repeating task: say it is done for this round and when it
 * comes round again, with Undo, which puts it back as it was.
 */
export function useRoundNotices() {
  const queryClient = useQueryClient();
  const show = useNoticeStore((s) => s.show);
  const refresh = (profileId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['journey-checklist'] });
    void queryClient.invalidateQueries({ queryKey: ['journeys', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['calendar', profileId] });
  };
  return (profileId: string, rounds: TaskRound | TaskRound[] | null | undefined) => {
    const list = (Array.isArray(rounds) ? rounds : rounds ? [rounds] : []).filter(Boolean);
    if (list.length === 0) return;
    const message =
      list.length === 1
        ? `Done “${list[0]!.title}” for this round. Next due ${format(new Date(list[0]!.next_due_at), 'EEE d MMM yyyy')}.`
        : `${list.length} repeating tasks are done for this round and moved on to their next dates.`;
    show({
      message,
      action: {
        label: 'Undo',
        run: async () => {
          try {
            for (const r of list) await api.post(`/care-profiles/${profileId}/reminders/${r.task_id}/rounds/${r.id}/undo`);
            show({ message: list.length === 1 ? `“${list[0]!.title}” is due again as it was.` : 'Those tasks are due again as they were.' });
          } catch {
            show({ message: 'That could not be undone. Refresh to see where the task is now.' });
          }
          refresh(profileId);
        },
      },
    });
  };
}

/** The same, for one person's tasks. */
export function useRoundNotice(profileId: string) {
  const notices = useRoundNotices();
  return (rounds: TaskRound | TaskRound[] | null | undefined) => notices(profileId, rounds);
}
