import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { CatalogueCombo } from './CatalogueCombo';
import { ALLERGY_SEVERITIES, type Allergy, type AllergySeverity } from '../lib/care';

/**
 * The one way an allergy is recorded or corrected, wherever the need
 * arises. The Allergies page uses it for its table, and any other page
 * (the care plan's first-run wizard, the emergency sheet) can deploy it
 * inline instead of sending the user away mid-task. Substance and
 * reaction each come from a shared catalogue and stay separate fields.
 */
export function AllergyModal({
  profileId,
  allergy,
  open,
  onClose,
  onSaved,
}: {
  profileId: string;
  /** Null adds a new allergy; a record edits it. */
  allergy?: Allergy | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (saved: Allergy) => void;
}) {
  const isNew = !allergy;
  const queryClient = useQueryClient();
  const [substance, setSubstance] = useState(allergy?.substance ?? '');
  const [reaction, setReaction] = useState(allergy?.reaction ?? '');
  const [severity, setSeverity] = useState<AllergySeverity | ''>(allergy?.severity ?? '');
  const [error, setError] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { substance: substance.trim(), reaction: reaction.trim() || null, severity: severity || null };
      if (isNew) {
        return api.post<{ allergy: Allergy }>(`/care-profiles/${profileId}/allergies`, body);
      }
      return api.patch<{ allergy: Allergy }>(`/care-profiles/${profileId}/allergies/${allergy.id}`, body);
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['allergies', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['emergency-sheet', profileId] });
      onSaved?.(res.allergy);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the allergy.'),
  });

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add allergy' : `Edit allergy to ${allergy.substance}`}>
      <div className="space-y-4">
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Allergic to</span>
          <CatalogueCombo
            endpoint="/option-catalogue?category=allergen"
            ariaLabel="Allergic to"
            placeholder="e.g. Penicillin"
            initial={substance}
            keepValue
            onPick={setSubstance}
            widthClass="w-full"
          />
        </div>
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Reaction</span>
          <CatalogueCombo
            endpoint="/option-catalogue?category=allergy_reaction"
            ariaLabel="Reaction"
            placeholder="e.g. Rash"
            initial={reaction}
            keepValue
            onPick={setReaction}
            widthClass="w-full"
          />
          <p className="mt-1 text-xs text-muted">What happens if they are given it.</p>
        </div>
        <div>
          <label htmlFor={`allergy-severity-${allergy?.id ?? 'new'}`} className="block text-sm font-medium text-ink mb-1">
            How bad is the reaction
          </label>
          <select
            id={`allergy-severity-${allergy?.id ?? 'new'}`}
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as AllergySeverity | '')}
          >
            <option value="">Not known</option>
            {ALLERGY_SEVERITIES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={saveMutation.isPending}
            onClick={() => {
              // Save always answers: say what is missing.
              if (!substance.trim()) {
                setError('Say what they are allergic to, then save.');
                return;
              }
              setError('');
              saveMutation.mutate();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
