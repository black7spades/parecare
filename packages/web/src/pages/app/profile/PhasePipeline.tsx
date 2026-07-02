import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { CARE_PHASES, phaseLabel } from '../../../lib/care';

/**
 * The life-phase pipeline: every phase of the care journey in order, with
 * the current one highlighted. Moving phases re-seeds the phase checklist.
 */
export function PhasePipeline({ profileId, currentPhase }: { profileId: string; currentPhase: string }) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);
  const currentIndex = CARE_PHASES.findIndex((p) => p.value === currentPhase);

  const mutation = useMutation({
    mutationFn: (current_phase: string) => api.patch(`/care-profiles/${profileId}/phase`, { current_phase }),
    onSuccess: () => {
      setTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['care-profile', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['checklist', profileId] });
    },
  });

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-ink">Care journey</h2>
        <span className="text-xs text-muted">Currently: {phaseLabel(currentPhase)}</span>
      </div>
      <ol className="flex flex-wrap items-center gap-y-3">
        {CARE_PHASES.map((phase, i) => {
          const state = i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'future';
          return (
            <li key={phase.value} className="flex items-center">
              <button
                type="button"
                onClick={() => phase.value !== currentPhase && setTarget(phase.value)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-colors ${
                  state === 'current'
                    ? 'bg-primary text-white font-medium'
                    : state === 'past'
                      ? 'bg-primary-50 text-primary hover:bg-primary-100'
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
                  {state === 'past' ? '✓' : i + 1}
                </span>
                {phase.label}
              </button>
              {i < CARE_PHASES.length - 1 ? <span className="mx-1 text-border select-none">›</span> : null}
            </li>
          );
        })}
      </ol>

      <Modal open={target !== null} onClose={() => setTarget(null)} title="Change care phase">
        <p className="text-sm text-muted mb-4">
          Move to <span className="font-medium text-ink">{target ? phaseLabel(target) : ''}</span>? A checklist for
          the new phase is added automatically (existing checklists are kept).
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setTarget(null)}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} onClick={() => target && mutation.mutate(target)}>
            Change phase
          </Button>
        </div>
      </Modal>
    </div>
  );
}
