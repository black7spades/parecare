import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { formatDateOnly } from '../lib/datetime';
import type { RecallSuggestion } from '../lib/lifeEvents';

/**
 * Suggested reminders: the yearly and six-monthly checks worth not
 * forgetting, picked by age and conditions. Add makes the repeating task;
 * Dismiss sets one aside, with Undo straight after.
 */
export function RecallsCard({ profileId, canEdit }: { profileId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [said, setSaid] = useState<{ text: string; undoRule?: string } | null>(null);
  const [error, setError] = useState('');
  const { data } = useQuery({
    queryKey: ['recalls', profileId],
    queryFn: () => api.get<{ recalls: RecallSuggestion[] }>(`/care-profiles/${profileId}/recalls`),
  });
  const recalls = data?.recalls ?? [];
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['recalls', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
  };
  const add = useMutation({
    mutationFn: (r: RecallSuggestion) => api.post<{ task: { title: string; joined: boolean } }>(`/care-profiles/${profileId}/recalls/${r.rule}/add`, {}),
    onSuccess: (res, r) => {
      setError('');
      setSaid({
        text: res.task.joined
          ? `“${res.task.title}” now repeats, so there is one task for it.`
          : `Added “${res.task.title}”, first due ${formatDateOnly(r.due_on)}. It repeats.`,
      });
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'That was not added. Try again in a moment.'),
  });
  const dismiss = useMutation({
    mutationFn: (r: RecallSuggestion) => api.post(`/care-profiles/${profileId}/recalls/${r.rule}/dismiss`, {}),
    onSuccess: (_res, r) => {
      setError('');
      setSaid({ text: `Dismissed “${r.line}”.`, undoRule: r.rule });
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'That was not dismissed. Try again in a moment.'),
  });
  const undo = useMutation({
    mutationFn: (rule: string) => api.delete(`/care-profiles/${profileId}/recalls/${rule}/dismiss`),
    onSuccess: () => {
      setSaid(null);
      refresh();
    },
  });

  if (recalls.length === 0 && !said) return null;
  return (
    <section className="card space-y-2" aria-label="Suggested reminders">
      <h2 className="text-sm font-semibold text-ink">Suggested reminders</h2>
      {recalls.length > 0 ? (
        <ul className="divide-y divide-border">
          {recalls.map((r) => (
            <li key={r.rule} className="flex flex-wrap items-center gap-2 py-2">
              <span className="flex-1 min-w-[10rem] text-sm text-ink">{r.line}</span>
              {canEdit ? (
                <span className="flex gap-1">
                  <Button size="xs" variant="secondary" loading={add.isPending && add.variables?.rule === r.rule} onClick={() => add.mutate(r)}>Add</Button>
                  <Button size="xs" variant="ghost" loading={dismiss.isPending && dismiss.variables?.rule === r.rule} onClick={() => dismiss.mutate(r)}>Dismiss</Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {said ? (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <p className="flex-1 text-xs text-ink">{said.text}</p>
          {said.undoRule ? <Button size="xs" variant="ghost" loading={undo.isPending} onClick={() => undo.mutate(said.undoRule!)}>Undo</Button> : null}
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : null}
      <p className="text-xs text-muted">Picked by age and conditions. Each one is added as a task that repeats.</p>
    </section>
  );
}
