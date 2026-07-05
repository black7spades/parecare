import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { CARE_PHASES, phaseLabel, type PhaseHistoryEntry } from '../../../lib/care';
import { useAuthStore } from '../../../stores/auth';

/**
 * The life-phase pipeline. Care journeys move forward only: past phases are
 * locked read-only with the date they were locked off. A super admin can
 * click a locked phase to reopen it and correct records.
 */
export function PhasePipeline({
  profileId,
  currentPhase,
  careName,
  phaseHistory = [],
}: {
  profileId: string;
  currentPhase: string;
  careName?: string;
  phaseHistory?: PhaseHistoryEntry[];
}) {
  const queryClient = useQueryClient();
  const isSuperAdmin = useAuthStore((s) => s.account?.role) === 'super_admin';
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  const currentIndex = CARE_PHASES.findIndex((p) => p.value === currentPhase);
  const lockedAt = (phase: string) => phaseHistory.find((h) => h.phase === phase)?.locked_at ?? null;

  const mutation = useMutation({
    mutationFn: (current_phase: string) => api.patch(`/care-profiles/${profileId}/phase`, { current_phase }),
    onSuccess: () => {
      setTarget(null);
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['care-profile', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['checklist', profileId] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not change the phase.'),
  });

  const targetIndex = target ? CARE_PHASES.findIndex((p) => p.value === target) : -1;
  const goingBack = targetIndex >= 0 && targetIndex < currentIndex;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-ink">{careName ? `${careName}'s care journey` : 'Care journey'}</h2>
        <span className="text-xs text-muted">Currently: {phaseLabel(currentPhase)}</span>
      </div>
      <ol className="flex flex-wrap items-center gap-y-3">
        {CARE_PHASES.map((phase, i) => {
          const state = i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'future';
          const locked = state === 'past';
          // Past phases are locked; only a super admin can reopen one.
          const clickable = state === 'future' || (locked && isSuperAdmin);
          const lockDate = locked ? lockedAt(phase.value) : null;
          return (
            <li key={phase.value} className="flex items-center">
              <button
                type="button"
                disabled={!clickable}
                title={
                  locked
                    ? lockDate
                      ? `Locked ${format(new Date(lockDate), 'd MMM yyyy')}${isSuperAdmin ? ' — click to reopen' : ''}`
                      : 'Locked'
                    : undefined
                }
                onClick={() => clickable && setTarget(phase.value)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-colors ${
                  state === 'current'
                    ? 'bg-primary text-white font-medium'
                    : state === 'past'
                      ? `bg-primary-50 text-primary ${isSuperAdmin ? 'hover:bg-primary-100 cursor-pointer' : 'opacity-70 cursor-default'}`
                      : 'bg-surface-2 text-muted hover:text-ink'
                }`}
              >
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                    state === 'current'
                      ? 'bg-card text-primary'
                      : state === 'past'
                        ? 'bg-primary text-white'
                        : 'bg-card text-muted border border-border'
                  }`}
                >
                  {state === 'past' ? (isSuperAdmin ? '🔓' : '🔒') : i + 1}
                </span>
                {phase.label}
              </button>
              {i < CARE_PHASES.length - 1 ? <span className="mx-1 text-border select-none">›</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted mt-3">
        The journey moves forward only. Past phases are kept as a locked record.
        {isSuperAdmin ? ' As a super admin you can reopen a past phase to correct records.' : ''}
      </p>

      <Modal open={target !== null} onClose={() => setTarget(null)} title={goingBack ? 'Reopen an earlier phase' : 'Move to the next phase'}>
        {goingBack ? (
          <p className="text-sm text-muted mb-4">
            Reopen <span className="font-medium text-ink">{target ? phaseLabel(target) : ''}</span> for editing? This
            moves the care journey back to that phase so records can be corrected.
          </p>
        ) : (
          <p className="text-sm text-muted mb-4">
            Move to <span className="font-medium text-ink">{target ? phaseLabel(target) : ''}</span>? The current phase
            will be locked as a record, and a checklist for the new phase is added automatically.
          </p>
        )}
        {error ? <p className="text-sm text-red-600 mb-3">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setTarget(null)}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} onClick={() => target && mutation.mutate(target)}>
            {goingBack ? 'Reopen phase' : 'Move forward'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
