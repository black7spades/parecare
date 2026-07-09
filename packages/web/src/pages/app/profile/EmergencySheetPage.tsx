import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { PoaBadge } from '../../../components/PoaBadge';
import { useProfile } from './ProfileLayout';
import { poaLabel, providerTypeLabel, type Allergy, type CarePlan, type CircleMember, type MedicalCondition, type Provider } from '../../../lib/care';

export function EmergencySheetPage() {
  const { profile } = useProfile();

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

  const plan = planData?.plan;
  const poaHolders = (circleData?.members ?? []).filter((m) => m.poa_type);
  const providers = providerData?.providers ?? [];
  const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const meds = asArray<{ name: string; dose?: string; frequency?: string }>(plan?.medications);
  const allergies = allergyData?.allergies ?? [];
  const conditions = conditionData?.conditions ?? [];
  const contacts = asArray<{ name: string; relationship?: string; phone: string }>(plan?.emergency_contacts);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-muted">
          A one-page summary for paramedics, hospital staff, or anyone stepping in. Keep a printed copy on the fridge.
        </p>
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
            <p className="text-sm">No known allergies recorded.</p>
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
            <Empty />
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
            <Empty />
          ) : (
            poaHolders.map((m) => (
              <p key={m.id} className="text-sm flex items-center gap-2">
                <span className="font-medium">{m.display_name}</span>
                <span>· {poaLabel(m.poa_type)}</span>
                <PoaBadge type={m.poa_type} activated={m.poa_activated} />
                {m.invited_email ? <span className="text-muted">{m.invited_email}</span> : null}
              </p>
            ))
          )}
        </Section>

        <Section title="Medical conditions">
          {conditions.length === 0 ? <Empty /> : <p className="text-sm">{conditions.map((c) => c.name).join(' · ')}</p>}
        </Section>

        <Section title="Current medications">
          {meds.length === 0 ? (
            <Empty />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {meds.map((m, i) => (
                  <tr key={i}>
                    <td className="py-0.5 font-medium">{m.name}</td>
                    <td className="py-0.5">{m.dose ?? ''}</td>
                    <td className="py-0.5">{m.frequency ?? ''}</td>
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
          {plan?.gp_name || plan?.gp_phone ? (
            <p className="text-sm">
              <span className="font-medium">{plan?.gp_name}</span>
              {plan?.gp_practice ? ` · ${plan.gp_practice}` : ''}
              {plan?.gp_phone ? ` · ${plan.gp_phone}` : ''}
            </p>
          ) : (
            <Empty />
          )}
        </Section>

        {providers.length > 0 ? (
          <Section title="Other providers">
            {providers.slice(0, 6).map((p) => (
              <p key={p.id} className="text-sm">
                <span className="font-medium">{p.name}</span> ({providerTypeLabel(p.provider_type)})
                {p.phone ? ` · ${p.phone}` : ''}
              </p>
            ))}
          </Section>
        ) : null}

        {plan?.communication_preferences ? (
          <Section title="Communication">
            <p className="text-sm">{plan.communication_preferences}</p>
          </Section>
        ) : null}

        <p className="text-xs text-muted border-t border-border pt-2">
          Generated by PareCare on {format(new Date(), 'd MMM yyyy')}. Verify details before relying on them.
        </p>
      </div>
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

function Empty() {
  return <p className="text-sm text-muted">Not recorded. Add it in the Care plan tab.</p>;
}
