import {  } from 'react';
import {  } from 'react-router-dom';
import {  } from '../../../../components/ui/icons';
import { OptionChips } from '../../../../components/CatalogueCombo';
import {  } from '../../../../components/ProseReport';
import { AllergyModal } from '../../../../components/AllergyModal';
import {
  type CarePlan } from '../../../../lib/care';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {  } from 'date-fns';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import { EmergencyContactAdd, useEmergencyContacts } from '../../../../components/EmergencyContactsEditor';

export function GenerateWizard({
  profileId,
  careName,
  gaps,
  generating,
  error,
  onGenerate,
  onClose }: {
  profileId: string;
  careName: string;
  gaps: { allergies: boolean; emergency_contacts: boolean; gp: boolean; needs: boolean };
  generating: boolean;
  /** Whatever went wrong last time Generate was pressed. */
  error?: string;
  onGenerate: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [allergyOpen, setAllergyOpen] = useState(false);
  const [allergiesAdded, setAllergiesAdded] = useState(0);
  const [noKnownAllergies, setNoKnownAllergies] = useState(false);

  const { data: planData } = useQuery({
    queryKey: ['care-plan', profileId],
    queryFn: () => api.get<{ plan: CarePlan | null }>(`/care-profiles/${profileId}/plan`) });
  const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const plan: CarePlan = {
    dietary_requirements: asArray<string>(planData?.plan?.dietary_requirements),
    mobility_aids: asArray<string>(planData?.plan?.mobility_aids),
    communication_needs: asArray<string>(planData?.plan?.communication_needs),
    advance_care_directive: planData?.plan?.advance_care_directive ?? false,
    advance_care_directive_location: planData?.plan?.advance_care_directive_location ?? null };
  const { data: emergencyData } = useEmergencyContacts(profileId);
  const emergencyCount = emergencyData?.contacts.length ?? 0;

  const savePlanMutation = useMutation({
    mutationFn: (next: CarePlan) => api.put(`/care-profiles/${profileId}/plan`, next),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['care-plan', profileId] }) });

  return (
    <Modal open onClose={onClose} title="Generate care plan" wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Version 1 is assembled from everything already recorded for {careName}. A few basics are still
          missing; fill them in here or skip them, they can always be added later.
        </p>

        {gaps.allergies && !noKnownAllergies && allergiesAdded === 0 ? (
          <GapRow label="Allergies" detail="No allergies are recorded.">
            <Button size="sm" variant="secondary" onClick={() => setAllergyOpen(true)}>
              Add allergy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNoKnownAllergies(true)}>
              None known
            </Button>
          </GapRow>
        ) : null}

        {gaps.emergency_contacts && emergencyCount === 0 ? (
          <GapRow label="Emergency contacts" detail="Nobody is listed to call first.">
            <div className="w-full">
              <EmergencyContactAdd profileId={profileId} />
            </div>
          </GapRow>
        ) : null}

        {gaps.gp ? <GpGapRow profileId={profileId} /> : null}

        {gaps.needs ? (
          <GapRow label="Day-to-day needs" detail="No dietary requirements, mobility aids or communication needs are recorded.">
            <div className="space-y-3 w-full">
              <OptionChips
                label="Dietary requirements"
                category="dietary_requirement"
                values={plan.dietary_requirements}
                onChange={(v) => savePlanMutation.mutate({ ...plan, dietary_requirements: v })}
                canEdit
                addLabel="Add, e.g. Low salt"
              />
              <OptionChips
                label="Mobility aids"
                category="mobility_aid"
                values={plan.mobility_aids}
                onChange={(v) => savePlanMutation.mutate({ ...plan, mobility_aids: v })}
                canEdit
                addLabel="Add, e.g. Walking frame"
              />
            </div>
          </GapRow>
        ) : null}

        {!gaps.allergies && !gaps.emergency_contacts && !gaps.gp && !gaps.needs ? (
          <p className="text-sm text-ink">Everything needed for a useful first version is already recorded.</p>
        ) : null}

        {/* Shown here rather than on the screen behind, which is where it
            used to appear while this dialog covered it. */}
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={generating} onClick={onGenerate}>
            Generate version 1
          </Button>
        </div>
      </div>

      {allergyOpen ? (
        <AllergyModal
          profileId={profileId}
          open
          onClose={() => setAllergyOpen(false)}
          onSaved={() => setAllergiesAdded((n) => n + 1)}
        />
      ) : null}
    </Modal>
  );
}

function GapRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="text-xs text-muted mb-2">{detail}</p>
      <div className="flex flex-wrap items-end gap-2">{children}</div>
    </div>
  );
}

function GpGapRow({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [practice, setPractice] = useState('');
  const [phone, setPhone] = useState('');
  const [added, setAdded] = useState(false);
  const [missing, setMissing] = useState('');

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/providers`, {
        provider_type: 'gp',
        name: name.trim(),
        organisation: practice.trim() || null,
        phone: phone.trim() || null }),
    onSuccess: () => {
      setAdded(true);
      void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });
    } });

  if (added) return null;
  return (
    <GapRow label="GP" detail="No GP is recorded.">
      <Input aria-label="GP name" placeholder="GP name" value={name} onChange={(e) => setName(e.target.value)} className="w-36" />
      <Input aria-label="GP practice" placeholder="Practice" value={practice} onChange={(e) => setPractice(e.target.value)} className="w-36" />
      <Input aria-label="GP phone" type="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-32" />
      <Button
        size="sm"
        variant="secondary"
        loading={addMutation.isPending}
        onClick={() => {
          if (!name.trim()) {
            setMissing("Write the GP's name, then add them.");
            return;
          }
          setMissing('');
          addMutation.mutate();
        }}
      >
        Add GP
      </Button>
      {missing ? <p className="basis-full text-sm text-red-600" role="alert">{missing}</p> : null}
    </GapRow>
  );
}

// ---------------------------------------------------------------------------
// Signing
