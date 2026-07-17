import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { PoaBadge } from '../../../components/PoaBadge';
import { PagePurpose } from '../../../components/PagePurpose';
import { AllergyModal } from '../../../components/AllergyModal';
import { SetPoaForm } from '../../../components/SetPoaForm';
import { ConditionModal, EmergencyContactModal, GpModal, MedicationModal } from '../../../components/QuickAddModals';
import { useProfile } from './ProfileLayout';
import { poaLabel, providerTypeLabel, type Allergy, type CarePlan, type CircleMember, type MedicalCondition, type MedicationRecord, type Provider } from '../../../lib/care';

type SheetModal = 'allergy' | 'contact' | 'poa' | 'condition' | 'medication' | 'gp' | null;

export function EmergencySheetPage() {
  const { profile, canEdit } = useProfile();
  const [modal, setModal] = useState<SheetModal>(null);
  const closeModal = () => setModal(null);

  const { data: planData } = useQuery({
    queryKey: ['care-plan', profile.id],
    queryFn: () => api.get<{ plan: CarePlan | null }>(`/care-profiles/${profile.id}/plan`),
  });
  const { data: allergyData } = useQuery({
    queryKey: ['allergies', profile.id],
    queryFn: () => api.get<{ allergies: Allergy[] }>(`/care-profiles/${profile.id}/allergies`),
  });
  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profile.id],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profile.id}/conditions`),
  });
  const { data: circleData } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });
  const { data: providerData } = useQuery({
    queryKey: ['providers', profile.id],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profile.id}/providers`),
  });
  const { data: medData } = useQuery({
    queryKey: ['medications', profile.id],
    queryFn: () => api.get<{ medications: MedicationRecord[] }>(`/care-profiles/${profile.id}/medications`),
  });

  const plan = planData?.plan;
  const providers = providerData?.providers ?? [];
  const gps = providers.filter((p) => p.provider_type === 'gp');
  // A power of attorney holder can be a person in the care circle or an
  // organisation such as a law firm; paramedics need to see either.
  const poaHolders: Array<{ key: string; name: string; poa_type: string | null; poa_activated: boolean; contact: string | null }> = [
    ...(circleData?.members ?? [])
      .filter((m) => m.poa_type)
      .map((m) => ({ key: m.id, name: m.display_name, poa_type: m.poa_type, poa_activated: m.poa_activated, contact: m.invited_email })),
    ...providers
      .filter((p) => p.poa_type)
      .map((p) => ({ key: p.id, name: p.name, poa_type: p.poa_type, poa_activated: p.poa_activated, contact: p.phone ?? p.email ?? null })),
  ];
  const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const meds = (medData?.medications ?? []).filter((m) => m.active);
  const allergies = allergyData?.allergies ?? [];
  const conditions = conditionData?.conditions ?? [];
  const contacts = asArray<{ name: string; relationship?: string; phone: string }>(plan?.emergency_contacts);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted">
            A one-page summary for paramedics, hospital staff, or anyone stepping in. Keep a printed copy on the fridge.
          </p>
          <PagePurpose kind="output" />
        </div>
        <Button onClick={() => window.print()}>Print</Button>
      </div>

      <div className="print-sheet card space-y-5">
        <div className="border-b border-border pb-3">
          <h1 className="text-xl font-bold text-ink">Emergency information: {profile.full_name}</h1>
          <p className="text-sm text-muted">
            {[
              profile.preferred_name ? `Known as ${profile.preferred_name}` : null,
              profile.date_of_birth ? `DOB ${format(new Date(profile.date_of_birth), 'd MMM yyyy')}` : null,
              profile.primary_language ? `Language: ${profile.primary_language}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <Section title="Allergies, do not give">
          {allergies.length === 0 ? (
            <Empty
              text="No known allergies recorded."
              action="Add allergy"
              canEdit={canEdit}
              onAdd={() => setModal('allergy')}
            />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {allergies.map((a) => (
                  <tr key={a.id}>
                    <td className="py-0.5 font-bold text-red-700">{a.substance}</td>
                    <td className="py-0.5">{a.reaction ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Emergency contacts">
          {contacts.length === 0 ? (
            <Empty action="Add emergency contact" canEdit={canEdit} onAdd={() => setModal('contact')} />
          ) : (
            contacts.map((c, i) => (
              <p key={i} className="text-sm">
                <span className="font-medium">{c.name}</span>
                {c.relationship ? ` (${c.relationship})` : ''} · {c.phone}
              </p>
            ))
          )}
        </Section>

        <Section title="Power of attorney">
          {poaHolders.length === 0 ? (
            <Empty action="Name a holder" canEdit={canEdit} onAdd={() => setModal('poa')} />
          ) : (
            poaHolders.map((h) => (
              <p key={h.key} className="text-sm flex items-center gap-2">
                <span className="font-medium">{h.name}</span>
                <span>· {poaLabel(h.poa_type)}</span>
                <PoaBadge type={h.poa_type} activated={h.poa_activated} />
                {h.contact ? <span className="text-muted">{h.contact}</span> : null}
              </p>
            ))
          )}
        </Section>

        <Section title="Medical conditions">
          {conditions.length === 0 ? (
            <Empty action="Add condition" canEdit={canEdit} onAdd={() => setModal('condition')} />
          ) : (
            <p className="text-sm">{conditions.map((c) => c.name).join(' · ')}</p>
          )}
        </Section>

        <Section title="Current medications">
          {meds.length === 0 ? (
            <Empty action="Add medication" canEdit={canEdit} onAdd={() => setModal('medication')} />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {meds.map((m) => (
                  <tr key={m.id}>
                    <td className="py-0.5 font-medium">{m.name}</td>
                    <td className="py-0.5">{m.dose ?? ''}</td>
                    <td className="py-0.5">
                      {m.as_needed ? 'As needed' : m.schedule_times?.length ? m.schedule_times.join(', ') : m.frequency ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {plan?.advance_care_directive ? (
          <Section title="Advance care directive">
            <p className="text-sm">
              In place.{plan.advance_care_directive_location ? ` Location: ${plan.advance_care_directive_location}` : ''}
            </p>
          </Section>
        ) : null}

        <Section title="GP">
          {gps.length > 0 ? (
            gps.map((gp) => (
              <p key={gp.id} className="text-sm">
                <span className="font-medium">{gp.name}</span>
                {gp.organisation ? ` · ${gp.organisation}` : ''}
                {gp.phone ? ` · ${gp.phone}` : ''}
              </p>
            ))
          ) : (
            <Empty action="Add GP" canEdit={canEdit} onAdd={() => setModal('gp')} />
          )}
        </Section>

        {providers.filter((p) => p.provider_type !== 'gp').length > 0 ? (
          <Section title="Other providers">
            {providers.filter((p) => p.provider_type !== 'gp').slice(0, 6).map((p) => (
              <p key={p.id} className="text-sm">
                <span className="font-medium">{p.name}</span> ({providerTypeLabel(p.provider_type)})
                {p.phone ? ` · ${p.phone}` : ''}
              </p>
            ))}
          </Section>
        ) : null}

        {asArray<string>(plan?.communication_needs).length > 0 ? (
          <Section title="Communication">
            <p className="text-sm">{asArray<string>(plan?.communication_needs).join(' · ')}</p>
          </Section>
        ) : null}

        <p className="text-xs text-muted border-t border-border pt-2">
          Generated by PareCare on {format(new Date(), 'd MMM yyyy')}. Verify details before relying on them.
        </p>
      </div>

      <AllergyModal profileId={profile.id} open={modal === 'allergy'} onClose={closeModal} />
      <EmergencyContactModal profileId={profile.id} open={modal === 'contact'} onClose={closeModal} />
      <ConditionModal profileId={profile.id} open={modal === 'condition'} onClose={closeModal} />
      <MedicationModal profileId={profile.id} open={modal === 'medication'} onClose={closeModal} />
      <GpModal profileId={profile.id} open={modal === 'gp'} onClose={closeModal} />
      <Modal open={modal === 'poa'} onClose={closeModal} title="Name a power of attorney holder" wide>
        <SetPoaForm profileId={profile.id} onSaved={closeModal} />
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">{title}</h2>
      {children}
    </div>
  );
}

/**
 * An empty section records the fact right here, in a dialog, instead of
 * sending the user to another page. The button stays off the printed
 * sheet, where it would be meaningless on paper.
 */
function Empty({
  text = 'Not recorded.',
  action,
  canEdit,
  onAdd,
}: {
  text?: string;
  action: string;
  canEdit: boolean;
  onAdd: () => void;
}) {
  return (
    <p className="text-sm text-muted flex items-center gap-2">
      {text}
      {canEdit ? (
        <Button size="xs" variant="secondary" className="print:hidden" onClick={onAdd}>
          {action}
        </Button>
      ) : null}
    </p>
  );
}
