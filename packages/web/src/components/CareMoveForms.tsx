import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { FacilityPicker, emptyFacility, facilityChosen, facilityPayload, type FacilityValue } from './FacilityPicker';
import { noticeFiled, refreshContacts } from '../stores/notice';
import { PAYMENT_CHOICES, addDays, type CareMove } from '../lib/lifeEvents';

const selectClass =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * Record a move into care, or change one. Only the care home is needed.
 * Cooling-off and the day to decide how the room is paid for are worked
 * out from the dates given, and can be changed.
 */
export function MoveIntoCareModal({
  profileId,
  move,
  roomNumber,
  onClose,
}: {
  profileId: string;
  move?: CareMove | null;
  roomNumber?: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [home, setHome] = useState<FacilityValue>(move?.facility_provider_id ? { ...emptyFacility, providerId: move.facility_provider_id } : emptyFacility);
  const [room, setRoom] = useState(roomNumber ?? '');
  const [entry, setEntry] = useState(move?.entry_on ?? '');
  const [signed, setSigned] = useState(move?.agreement_signed_on ?? '');
  const [cooling, setCooling] = useState(move && !move.cooling_off_worked_out ? move.cooling_off_ends_on ?? '' : '');
  const [payment, setPayment] = useState<string>(move?.payment_choice ?? '');
  const [decideBy, setDecideBy] = useState(move && !move.payment_due_worked_out ? move.payment_choice_due_on ?? '' : '');
  const [notice, setNotice] = useState(move?.notice_given_on ?? '');
  const [leaving, setLeaving] = useState(move?.leaving_on ?? '');
  const [missing, setMissing] = useState('');
  const [error, setError] = useState('');

  // Worked out unless typed over: 14 days after signing, 28 after moving in.
  const coolingShown = cooling || (signed ? addDays(signed, 14) : '');
  const decideShown = decideBy || (entry ? addDays(entry, 28) : '');

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...(facilityChosen(home) ? facilityPayload('facility', home) : {}),
        room_number: room.trim() || null,
        entry_on: entry || null,
        agreement_signed_on: signed || null,
        cooling_off_ends_on: cooling || null,
        payment_choice: payment || null,
        payment_choice_due_on: decideBy || null,
        notice_given_on: notice || null,
        leaving_on: leaving || null,
      };
      return move
        ? api.patch<{ move: CareMove; filed?: Array<{ id: string; name: string }> }>(`/care-profiles/${profileId}/care-moves/${move.id}`, body)
        : api.post<{ move: CareMove; filed?: Array<{ id: string; name: string }> }>(`/care-profiles/${profileId}/care-moves`, body);
    },
    onSuccess: (res) => {
      noticeFiled(profileId, res.filed);
      refreshContacts(queryClient);
      for (const key of [['care-moves', profileId], ['care-profile', profileId], ['tasks', profileId], ['journeys', profileId], ['addresses', profileId]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The move did not save. Check your connection and try again.'),
  });

  return (
    <Modal open onClose={onClose} title={move ? 'Change the move into care' : 'Move into care'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (!facilityChosen(home)) {
            setMissing(home.adding ? 'Write the name of the care home, then save.' : 'Choose the care home, or add one, then save.');
            document.getElementById(home.adding ? 'move-home-name' : 'move-home')?.focus();
            return;
          }
          setMissing('');
          save.mutate();
        }}
      >
        <p className="text-sm text-muted">The care home becomes where they live. The home they are leaving is kept as their previous home.</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <FacilityPicker id="move-home" only="care" profileId={profileId} label="Care home" addLabel="Add a care home" placeholder="e.g. Banksia Gardens Aged Care" value={home} onChange={setHome} />
          <Input id="move-room" label="Room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. 12" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="move-entry" label="Moved in on" type="date" value={entry} onChange={(e) => setEntry(e.target.value)} />
          <Input id="move-signed" label="Agreement signed on" type="date" value={signed} onChange={(e) => setSigned(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            id="move-cooling"
            label="Cooling-off ends"
            type="date"
            value={coolingShown}
            onChange={(e) => setCooling(e.target.value)}
            hint={!cooling && signed ? 'Worked out as 14 days after signing.' : undefined}
          />
          <div>
            <label htmlFor="move-payment" className="block text-sm font-medium text-ink mb-1">How the room is paid for</label>
            <select id="move-payment" className={selectClass} value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="">Not decided yet</option>
              {PAYMENT_CHOICES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            id="move-decide"
            label="Decide by"
            type="date"
            value={decideShown}
            onChange={(e) => setDecideBy(e.target.value)}
            hint={!decideBy && entry ? 'Worked out as 28 days after moving in.' : undefined}
          />
          <Input id="move-notice" label="Notice given on" type="date" value={notice} onChange={(e) => setNotice(e.target.value)} />
          <Input id="move-leaving" label="Leaving on" type="date" value={leaving} onChange={(e) => setLeaving(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save the move</Button>
        </div>
        {missing ? <p className="text-sm text-red-600 text-right" role="alert">{missing}</p> : null}
      </form>
    </Modal>
  );
}
