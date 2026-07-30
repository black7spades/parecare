import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import { useHealthConfig } from '../../../../lib/appConfig';
import type { MedicationRecord } from '../../../../lib/care';

/**
 * Record that an ordered repeat has arrived: the replenished step of the
 * reorder workflow. It tops up the supply and clears the "on order" mark. The
 * fields prefill to a sensible restock (one more full pack) and can be edited.
 */
export function ReplenishModal({ profileId, med, onClose, onSaved }: { profileId: string; med: MedicationRecord; onClose: () => void; onSaved: () => void }) {
  const health = useHealthConfig();
  const [packs, setPacks] = useState(String((med.packs_on_hand ?? 0) + 1));
  const [remaining, setRemaining] = useState(
    med.supply_remaining != null && med.supply_remaining > 0
      ? String(med.supply_remaining)
      : med.supply != null ? String(med.supply) : ''
  );
  const [amountPaid, setAmountPaid] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/medications/${med.id}/reorder`, {
      action: 'replenished',
      packs_on_hand: packs.trim() === '' ? undefined : Number(packs),
      supply_remaining: remaining.trim() === '' ? undefined : Number(remaining),
      amount_paid: amountPaid.trim() === '' ? null : Number(amountPaid),
    }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not record the delivery.'),
  });

  const inlineInput = 'inline-block w-24 rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <Modal open onClose={onClose} title={`Repeat arrived: ${med.name}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
        <p className="text-sm text-muted">
          Record what arrived. This tops up the supply and clears the on-order mark, so the reorder alert stops.
        </p>
        <p className="text-sm text-ink leading-8">
          Unopened, we now have{' '}
          <input className={inlineInput} aria-label="Packs on hand" type="number" min="0" step="any" value={packs} onChange={(e) => setPacks(e.target.value)} />{' '}
          pack{packs.trim() === '1' ? '' : 's'}, plus{' '}
          <input className={inlineInput} aria-label="Units in the open pack" type="number" min="0" step="any" value={remaining} onChange={(e) => setRemaining(e.target.value)} />{' '}
          loose in the open one.
        </p>
        <p className="text-sm text-ink leading-8">
          This repeat cost {health.currency_symbol}
          <input className={inlineInput} aria-label="Amount paid for this repeat" type="number" min="0" step="any" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />{' '}
          <span className="text-muted text-xs">(logged as health spend, dated today; leave blank to skip)</span>
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Mark replenished</Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Apply one change to many medications at once. Each field has a "change this"
 * toggle, and only the ticked fields are sent, each applied to every selected
 * medication. Supplier is the headline case, but route, whether it is taken
 * with food, dangerous-to-miss and active status can be set the same way.
 * Per-medication facts (name, schedule, dose, supply counts) are deliberately
 * not here, since they differ from one medication to the next.
 */
