import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../api/client';
import { browserTimeZone } from '../lib/datetime';
import { DETAIL_HINTS, QUICK_STEP_KEYS, useNextStepTypes, type NextStep } from '../lib/nextSteps';
import { CatalogueCombo } from './CatalogueCombo';
import { EditNextStepsModal } from './EditNextStepsModal';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { Modal } from './ui/Modal';

export interface OutcomeAppointment {
  id: string;
  title: string;
  starts_at: string;
  provider_name: string | null;
  outcome?: string | null;
  next_steps?: NextStep[];
}

interface DraftStep {
  key: number;
  type: string;
  systemKey: string | null;
  details: string;
  dueOn: string;
}

const inDays = (n: number) => format(new Date(Date.now() + n * 24 * 3600 * 1000), 'yyyy-MM-dd');

/**
 * How an appointment went: what happened, and what came out of it. Each next
 * step is its own kind, details and date, and becomes a task when saved, so
 * it is tracked and nudged until it is done. Steps already recorded show with
 * where they stand, and one that needs booking can be booked from here.
 */
export function OutcomeModal({
  profileId,
  appointment,
  canEdit,
  isOwner,
  onClose,
  onBook,
}: {
  profileId: string;
  appointment: OutcomeAppointment;
  canEdit: boolean;
  isOwner: boolean;
  onClose: () => void;
  /** Book the appointment a next step calls for. */
  onBook: (step: NextStep) => void;
}) {
  const queryClient = useQueryClient();
  const { data } = useNextStepTypes(profileId);
  const types = data?.types ?? [];
  const quick = QUICK_STEP_KEYS.map((k) => types.find((t) => t.system_key === k)).filter((t): t is NonNullable<typeof t> => !!t);

  const [outcome, setOutcome] = useState(appointment.outcome ?? '');
  const [drafts, setDrafts] = useState<DraftStep[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [comboKey, setComboKey] = useState(0);
  const [editingList, setEditingList] = useState(false);
  const [error, setError] = useState('');
  const existing = appointment.next_steps ?? [];

  const addDraft = (name: string) => {
    const t = types.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    setDrafts((d) => [...d, { key: nextKey, type: t?.name ?? name.trim(), systemKey: t?.system_key ?? null, details: '', dueOn: inDays(7) }]);
    setNextKey((k) => k + 1);
  };
  const updateDraft = (key: number, patch: Partial<DraftStep>) =>
    setDrafts((d) => d.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['appointments', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['next-step-types', profileId] });
  };

  const save = useMutation({
    mutationFn: () =>
      api.put(`/care-profiles/${profileId}/appointments/${appointment.id}/outcome`, {
        outcome: outcome.trim() || null,
        next_steps: drafts.map((d) => ({ type: d.type, details: d.details.trim() || null, due_on: d.dueOn || null })),
        tz: browserTimeZone() ?? null,
      }),
    onSuccess: () => { refresh(); onClose(); },
    onError: (err) => setError(err instanceof Error ? err.message : 'The outcome did not save. Check your connection and try again.'),
  });

  const markDone = useMutation({
    mutationFn: (step: NextStep) => api.patch(`/care-profiles/${profileId}/reminders/${step.id}`, { completed: true }),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not mark it done.'),
  });

  const heading = appointment.provider_name ? `${appointment.title} with ${appointment.provider_name}` : appointment.title;

  return (
    <Modal open onClose={onClose} title="How did it go?" wide>
      <div className="space-y-5">
        <p className="text-sm text-muted">
          {heading}, {format(new Date(appointment.starts_at), 'EEE d MMM yyyy, HH:mm')}
        </p>

        <Textarea
          label="What happened"
          placeholder="e.g. Ankle is sprained, not broken. Rest for two weeks."
          rows={3}
          value={outcome}
          disabled={!canEdit}
          onChange={(e) => setOutcome(e.target.value)}
        />

        {existing.length > 0 ? (
          <div>
            <p className="text-sm font-medium text-ink mb-2">Next steps so far</p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {existing.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm text-ink break-words ${s.completed ? 'line-through' : ''}`}>{s.title}</p>
                    <p className="text-xs text-muted">{s.type_name}</p>
                  </div>
                  <span className="text-xs text-muted whitespace-nowrap">
                    {s.led_to
                      ? `Booked for ${format(new Date(s.led_to.starts_at), 'd MMM')}`
                      : s.completed
                        ? `Done${s.completed_at ? ` ${format(new Date(s.completed_at), 'd MMM')}` : ''}`
                        : `Due ${format(new Date(s.next_due_at), 'd MMM')}`}
                  </span>
                  {canEdit && !s.completed ? (
                    <span className="flex gap-1">
                      {s.books ? (
                        <Button size="xs" variant="secondary" onClick={() => onBook(s)}>Book it</Button>
                      ) : null}
                      <Button size="xs" variant="ghost" loading={markDone.isPending && markDone.variables?.id === s.id} onClick={() => markDone.mutate(s)}>
                        Done
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {canEdit ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-ink">{existing.length > 0 ? 'Add more next steps' : 'What came out of it'}</p>
              {isOwner ? (
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditingList(true)}>Edit the list</Button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {quick.map((t) => (
                <Button key={t.id} size="xs" variant="secondary" onClick={() => addDraft(t.name)}>
                  + {t.name}
                </Button>
              ))}
            </div>
            <div className="max-w-sm">
              <CatalogueCombo
                key={comboKey}
                id="outcome-other-step"
                ariaLabel="Something else"
                placeholder="Something else, e.g. semen sample"
                extraItems={types.map((t) => t.name)}
                widthClass="w-full"
                newLabel={(name) => `+ Add "${name}" as a new kind of next step`}
                onPick={(name) => { if (name.trim()) addDraft(name); setComboKey((k) => k + 1); }}
              />
            </div>

            {drafts.length > 0 ? (
              <ul className="space-y-3">
                {drafts.map((d) => (
                  <li key={d.key} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-sm font-medium text-ink flex-1 break-words">{d.type}</p>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label={`Remove ${d.type}`}
                        title="Remove"
                        onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}
                      >
                        ✕
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                      <Input
                        label="Details"
                        placeholder={(d.systemKey && DETAIL_HINTS[d.systemKey]) || 'Anything to remember about it'}
                        maxLength={255}
                        value={d.details}
                        onChange={(e) => updateDraft(d.key, { details: e.target.value })}
                      />
                      <Input
                        label="Do by"
                        type="date"
                        value={d.dueOn}
                        onChange={(e) => updateDraft(d.key, { dueOn: e.target.value })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</Button>
          {canEdit ? (
            <Button
              loading={save.isPending}
              disabled={!outcome.trim() && drafts.length === 0 && !(appointment.outcome ?? '')}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          ) : null}
        </div>
      </div>
      {editingList ? <EditNextStepsModal profileId={profileId} onClose={() => setEditingList(false)} /> : null}
    </Modal>
  );
}
