import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { Modal } from './ui/Modal';
import { FacilityPicker, emptyFacility, facilityChosen, facilityPayload, type FacilityValue } from './FacilityPicker';
import { UploadDocumentModal } from '../pages/app/profile/DocumentsPage';
import { IngestModal } from './IngestModal';
import { usePareOn } from '../lib/aiStatus';
import { noticeFiled, refreshContacts } from '../stores/notice';
import { formatDateOnly, todayDateOnly } from '../lib/datetime';
import type { CareDocument, CircleMember } from '../lib/care';
import type { HospitalStay } from '../lib/lifeEvents';

/** Everything that shows a stay or what pauses while one is open. */
export function invalidateStays(queryClient: ReturnType<typeof useQueryClient>, profileId: string) {
  for (const key of [
    ['hospital-stays', profileId],
    ['care-profile', profileId],
    ['tasks', profileId],
    ['med-chart', profileId],
    ['pare-attention'],
    ['notifications'],
    ['documents', profileId],
  ]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

/**
 * Record a hospital stay, or change one. Only the day they went in is
 * needed; everything else can wait.
 */
export function HospitalStayModal({
  profileId,
  stay,
  onClose,
  onSaved,
  fromJourneyItemId,
}: {
  profileId: string;
  stay?: HospitalStay | null;
  /** The journey step this is recorded from; saving ticks it off. */
  fromJourneyItemId?: string | null;
  onClose: () => void;
  onSaved?: (stay: HospitalStay) => void;
}) {
  const queryClient = useQueryClient();
  const [hospital, setHospital] = useState<FacilityValue>(stay?.hospital_provider_id ? { ...emptyFacility, providerId: stay.hospital_provider_id } : emptyFacility);
  const [admitted, setAdmitted] = useState(stay?.admitted_on ?? todayDateOnly());
  const [discharged, setDischarged] = useState(stay?.discharged_on ?? '');
  const [ward, setWard] = useState(stay?.ward ?? '');
  const [team, setTeam] = useState(stay?.treating_team ?? '');
  const [reason, setReason] = useState(stay?.reason ?? '');
  const [missing, setMissing] = useState('');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...(facilityChosen(hospital) || stay ? facilityPayload('hospital', hospital) : {}),
        admitted_on: admitted,
        ward: ward.trim() || null,
        treating_team: team.trim() || null,
        reason: reason.trim() || null,
        ...(stay ? { discharged_on: discharged || null } : {}),
      };
      return stay
        ? api.patch<{ stay: HospitalStay }>(`/care-profiles/${profileId}/hospital-stays/${stay.id}`, body)
        : api.post<{ stay: HospitalStay; filed?: Array<{ id: string; name: string }> }>(`/care-profiles/${profileId}/hospital-stays`, { ...body, ...(fromJourneyItemId ? { from_journey_item_id: fromJourneyItemId } : {}) });
    },
    onSuccess: (res) => {
      invalidateStays(queryClient, profileId);
      const filed = (res as { filed?: Array<{ id: string; name: string }> }).filed;
      if (filed?.length) {
        noticeFiled(profileId, filed);
        refreshContacts(queryClient);
      }
      onSaved?.(res.stay);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The stay did not save. Check your connection and try again.'),
  });

  return (
    <Modal open onClose={onClose} title={stay ? 'Change the hospital stay' : 'Record a hospital stay'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          // Save always answers: say what is missing.
          if (!admitted) {
            setMissing('Say which day they went in, then save.');
            document.getElementById('stay-admitted')?.focus();
            return;
          }
          if (hospital.adding && !hospital.name.trim()) {
            setMissing('Write the name of the hospital, or choose one from the list.');
            document.getElementById('stay-hospital-name')?.focus();
            return;
          }
          setMissing('');
          save.mutate();
        }}
      >
        <p className="text-sm text-muted">While the stay is open, medicine reminders pause. The hospital gives the medicines.</p>
        <FacilityPicker id="stay-hospital" only="hospital" profileId={profileId} label="Hospital" addLabel="Add a hospital" placeholder="e.g. Box Hill Hospital" value={hospital} onChange={setHospital} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="stay-admitted" label="Went in on" type="date" value={admitted} onChange={(e) => setAdmitted(e.target.value)} />
          {stay ? <Input id="stay-discharged" label="Left hospital on" type="date" value={discharged} onChange={(e) => setDischarged(e.target.value)} hint="Leave empty while they are still there." /> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="stay-ward" label="Ward" value={ward} onChange={(e) => setWard(e.target.value)} placeholder="e.g. Ward 5 West" />
          <Input id="stay-team" label="Treating team" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="e.g. General medicine" />
        </div>
        <Textarea id="stay-reason" label="Why they went in" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. A fall at home" />
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{stay ? 'Save' : 'Record the stay'}</Button>
        </div>
        {missing ? <p className="text-sm text-red-600 text-right" role="alert">{missing}</p> : null}
      </form>
    </Modal>
  );
}

/**
 * Record the discharge: the day they left, the letter, and how soon to see
 * the GP. Saving starts the medicine reminders again and adds the GP
 * follow-up and a look over the care plan.
 */
export function DischargeModal({
  profileId,
  stayId,
  hospitalName,
  onClose,
}: {
  profileId: string;
  stayId: string;
  hospitalName?: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const pareOn = usePareOn();
  const [left, setLeft] = useState(todayDateOnly());
  const [days, setDays] = useState('7');
  const [letter, setLetter] = useState<{ id: string; label: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [missing, setMissing] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<HospitalStay | null>(null);

  const { data: docData } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
  });
  const { data: circleData } = useQuery({
    queryKey: ['circle', profileId],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profileId}/circle`),
  });
  // Letters from the last month, newest first, to pick the discharge letter from.
  const recent = (docData?.documents ?? []).slice(0, 30);

  const save = useMutation({
    mutationFn: () =>
      api.post<{ stay: HospitalStay }>(`/care-profiles/${profileId}/hospital-stays/${stayId}/discharge`, {
        discharged_on: left,
        follow_up_days: days.trim() === '' ? null : Number(days),
        document_id: letter?.id ?? null,
      }),
    onSuccess: (res) => {
      invalidateStays(queryClient, profileId);
      setDone(res.stay);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The discharge did not save. Check your connection and try again.'),
  });

  if (done) {
    return (
      <Modal open onClose={onClose} title="Discharge recorded">
        <div className="space-y-3" role="status">
          <p className="text-sm text-ink">Left {hospitalName ?? 'hospital'} on {formatDateOnly(done.discharged_on)}. Medicine reminders are back on.</p>
          <ul className="list-disc pl-5 text-sm text-ink space-y-1">
            {done.follow_up_task ? <li>Task added: {done.follow_up_task.title}</li> : null}
            {done.plan_review_task ? <li>Task added: {done.plan_review_task.title}</li> : null}
            {done.discharge_document ? <li>The letter is filed against the stay.</li> : null}
          </ul>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Record the discharge">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (!left) {
            setMissing('Say which day they left hospital, then save.');
            document.getElementById('discharge-left')?.focus();
            return;
          }
          if (days.trim() !== '' && !(Number(days) >= 0 && Number(days) <= 365)) {
            setMissing('See the GP within needs a number of days, such as 7.');
            document.getElementById('discharge-days')?.focus();
            return;
          }
          setMissing('');
          save.mutate();
        }}
      >
        <Input id="discharge-left" label="Left hospital on" type="date" value={left} onChange={(e) => setLeft(e.target.value)} />
        <div className="space-y-2">
          <label htmlFor="discharge-letter" className="block text-sm font-medium text-ink">Discharge letter</label>
          <select
            id="discharge-letter"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={letter?.id ?? ''}
            onChange={(e) => {
              const d = recent.find((x) => x.id === e.target.value);
              setLetter(d ? { id: d.id, label: d.label } : null);
            }}
          >
            <option value="">No letter yet</option>
            {letter && !recent.some((d) => d.id === letter.id) ? <option value={letter.id}>{letter.label}</option> : null}
            {recent.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="xs" variant="secondary" onClick={() => setUploading(true)}>Upload the letter</Button>
            {pareOn && letter ? (
              <Button type="button" size="xs" variant="ghost" onClick={() => setReading(true)}>Read with Pare</Button>
            ) : null}
          </div>
          <p className="text-xs text-muted">The letter is filed against this stay.</p>
        </div>
        <div>
          <label htmlFor="discharge-days" className="block text-sm font-medium text-ink mb-1">See the GP within</label>
          <div className="flex items-center gap-2">
            <input
              id="discharge-days"
              type="number"
              min={0}
              max={365}
              className="w-24 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <span className="text-sm text-ink">days</span>
          </div>
          <p className="mt-1 text-xs text-muted">Use the days the letter gives. Most say a week.</p>
        </div>
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Record the discharge</Button>
        </div>
        {missing ? <p className="text-sm text-red-600 text-right" role="alert">{missing}</p> : null}
      </form>
      {uploading ? (
        <UploadDocumentModal
          profileId={profileId}
          members={circleData?.members ?? []}
          initialFile={null}
          initialLabel="Discharge letter"
          link={{ kind: 'hospital-stays', id: stayId }}
          onClose={() => setUploading(false)}
          onUploaded={(doc) => {
            setUploading(false);
            setLetter({ id: doc.id, label: doc.label });
            void queryClient.invalidateQueries({ queryKey: ['documents', profileId] });
          }}
        />
      ) : null}
      {reading && letter ? <IngestModal profileId={profileId} document={letter} onClose={() => setReading(false)} /> : null}
    </Modal>
  );
}
