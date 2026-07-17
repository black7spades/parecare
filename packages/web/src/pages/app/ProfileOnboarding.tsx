import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { CatalogueCombo } from '../../components/CatalogueCombo';
import { ResidenceFields, emptyResidence, persistResidence, type ResidenceValue } from '../../components/ResidenceFields';
import { NEUROTYPE_LABELS, RELATIONSHIPS, type CareProfile } from '../../lib/care';
import type { JourneyTemplateSummary } from '../../lib/journeys';

/**
 * The guided setup that runs after a person or pet is created. One step per
 * screen, every step skippable, and only the steps that fit the profile are
 * shown (no neurotype for a pet; a vet instead of a GP). It opens with who
 * cares for them — themselves, a person, or a facility — which sets the
 * contact and, for a facility, the residence, the care phase and a matching
 * journey. Nothing is written until Finish, so leaving early costs nothing.
 */

type StepId = 'carer' | 'conditions' | 'allergies' | 'neurotype' | 'gp' | 'emergency';
type CarerMode = '' | 'self' | 'person' | 'facility';

const inputClass =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const STEP_TITLE: Record<StepId, string> = {
  carer: 'Who cares for them?',
  conditions: 'Conditions',
  allergies: 'Allergies',
  neurotype: 'Neurotypes',
  gp: 'GP',
  emergency: 'Emergency contact',
};

/** Journey templates that suit someone moving into residential care. */
const RESIDENTIAL_HINT = /aged|ageing|aging|residential|older|elder|dementia|nursing/i;

export function ProfileOnboarding({ profile, onDone }: { profile: CareProfile; onDone: () => void }) {
  const isPet = profile.kind === 'pet';
  const firstName = profile.preferred_name ?? profile.first_name ?? profile.full_name;

  const steps: StepId[] = useMemo(
    () => (['carer', 'conditions', 'allergies', ...(isPet ? [] : (['neurotype'] as StepId[])), 'gp', 'emergency'] as StepId[]),
    [isPet]
  );
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  // Carer
  const [carerMode, setCarerMode] = useState<CarerMode>('');
  const [selfPhone, setSelfPhone] = useState('');
  const [selfEmail, setSelfEmail] = useState('');
  const [personName, setPersonName] = useState('');
  const [personRel, setPersonRel] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [residence, setResidence] = useState<ResidenceValue>({ ...emptyResidence, residence_type: 'care_facility', use_facility_as_contact: true });
  const [startJourney, setStartJourney] = useState(true);

  // Health
  const [conditions, setConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<{ substance: string; reaction: string }[]>([]);
  const [allergySubstance, setAllergySubstance] = useState('');
  const [allergyReaction, setAllergyReaction] = useState('');
  const [neurotypes, setNeurotypes] = useState<{ name: string; neurotype: string }[]>([]);
  const [gpName, setGpName] = useState('');
  const [gpPractice, setGpPractice] = useState('');
  const [gpPhone, setGpPhone] = useState('');
  const [emName, setEmName] = useState('');
  const [emRel, setEmRel] = useState('');
  const [emPhone, setEmPhone] = useState('');

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Suggest a residential journey once a facility is chosen.
  const { data: templatesData } = useQuery({
    queryKey: ['journey-templates'],
    queryFn: () => api.get<{ templates: JourneyTemplateSummary[] }>('/journey-templates'),
    enabled: carerMode === 'facility',
  });
  const residentialTemplate = (templatesData?.templates ?? []).find(
    (t) => !t.slug?.startsWith('pet-') && RESIDENTIAL_HINT.test(`${t.name} ${t.slug ?? ''}`)
  );

  const addAllergy = () => {
    if (!allergySubstance.trim()) return;
    setAllergies((prev) => [...prev, { substance: allergySubstance.trim(), reaction: allergyReaction.trim() }]);
    setAllergySubstance('');
    setAllergyReaction('');
  };

  async function saveAll() {
    setError('');
    setSaving(true);
    try {
      // 1. Carer -> contact, and for a facility also residence, phase and journey.
      const profilePatch: Record<string, unknown> = {};
      if (carerMode === 'self') {
        Object.assign(profilePatch, {
          contact_kind: 'self',
          contact_phone: selfPhone.trim() || null,
          contact_phone_type: selfPhone.trim() ? 'mobile' : null,
          contact_email: selfEmail.trim() || null,
        });
      } else if (carerMode === 'person') {
        Object.assign(profilePatch, {
          contact_kind: personName.trim() ? 'contact' : null,
          contact_name: personName.trim() || null,
          contact_relationship: personRel.trim() || null,
          contact_phone: personPhone.trim() || null,
          contact_phone_type: personPhone.trim() ? 'mobile' : null,
          contact_email: personEmail.trim() || null,
        });
      } else if (carerMode === 'facility') {
        const { payload, contact } = await persistResidence(profile.id, residence);
        Object.assign(profilePatch, payload, contact ?? {}, { current_phase: 'residential_ongoing' });
      }
      if (Object.keys(profilePatch).length > 0) {
        await api.patch(`/care-profiles/${profile.id}`, profilePatch);
      }
      if (carerMode === 'facility' && startJourney && residentialTemplate) {
        await api.post(`/care-profiles/${profile.id}/journeys`, { template_id: residentialTemplate.id }).catch(() => {});
      }

      // 2. Health facts.
      await Promise.all([
        ...conditions.map((name) => api.post(`/care-profiles/${profile.id}/conditions`, { name })),
        ...neurotypes.map((n) =>
          api.post(`/care-profiles/${profile.id}/conditions`, { name: n.name, category: 'neurotype', neurotype: n.neurotype })
        ),
        ...allergies.map((a) =>
          api.post(`/care-profiles/${profile.id}/allergies`, { substance: a.substance, reaction: a.reaction || null })
        ),
        gpName.trim()
          ? api.post(`/care-profiles/${profile.id}/providers`, {
              provider_type: isPet ? 'vet' : 'gp',
              name: gpName.trim(),
              organisation: gpPractice.trim() || null,
              phone: gpPhone.trim() || null,
            })
          : Promise.resolve(),
      ]);

      // 3. Emergency contact rides on the care-needs record.
      if (emName.trim() && emPhone.trim()) {
        const planRes = await api.get<{ plan: { emergency_contacts?: unknown } | null }>(`/care-profiles/${profile.id}/plan`);
        const existing = Array.isArray(planRes.plan?.emergency_contacts) ? planRes.plan!.emergency_contacts : [];
        await api.put(`/care-profiles/${profile.id}/plan`, {
          dietary_requirements: [],
          mobility_aids: [],
          communication_needs: [],
          advance_care_directive: false,
          emergency_contacts: [...existing, { name: emName.trim(), relationship: emRel.trim() || undefined, phone: emPhone.trim() }],
        });
      }

      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish setup');
      setSaving(false);
    }
  }

  const next = () => {
    if (isLast) void saveAll();
    else setStepIndex((i) => i + 1);
  };

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Setting up {firstName}</p>
          <h1 className="text-xl font-semibold text-ink">{step === 'gp' && isPet ? 'Vet' : STEP_TITLE[step]}</h1>
        </div>
        <Button variant="ghost" size="sm" loading={saving} onClick={() => void saveAll()}>
          Finish now
        </Button>
      </div>

      {/* Progress */}
      <div className="mb-5 flex items-center gap-1.5" aria-hidden="true">
        {steps.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i < stepIndex ? 'bg-primary' : i === stepIndex ? 'bg-primary/60' : 'bg-surface-2'}`}
          />
        ))}
      </div>

      <div className="card space-y-4">
        {step === 'carer' ? (
          <CarerStep
            firstName={firstName}
            isPet={isPet}
            mode={carerMode}
            onMode={setCarerMode}
            selfPhone={selfPhone} setSelfPhone={setSelfPhone} selfEmail={selfEmail} setSelfEmail={setSelfEmail}
            personName={personName} setPersonName={setPersonName} personRel={personRel} setPersonRel={setPersonRel}
            personPhone={personPhone} setPersonPhone={setPersonPhone} personEmail={personEmail} setPersonEmail={setPersonEmail}
            residence={residence} setResidence={setResidence}
            startJourney={startJourney} setStartJourney={setStartJourney}
            residentialTemplateName={residentialTemplate?.name ?? null}
          />
        ) : null}

        {step === 'conditions' ? (
          <div>
            <p className="text-sm text-muted mb-2">
              {isPet ? 'Any ongoing conditions or diagnoses.' : 'Conditions, illnesses or diagnoses. Type to search; anything new joins the shared list.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {conditions.map((c) => (
                <span key={c} className="badge bg-surface-2 text-ink text-xs flex items-center gap-1">
                  {c}
                  <button type="button" aria-label={`Remove ${c}`} className="text-muted hover:text-red-600" onClick={() => setConditions(conditions.filter((x) => x !== c))}>✕</button>
                </span>
              ))}
              <CatalogueCombo endpoint="/condition-catalogue" ariaLabel="Add a condition" placeholder="e.g. Asthma" exclude={conditions}
                onPick={(name) => { if (!conditions.includes(name)) setConditions([...conditions, name]); }} />
            </div>
          </div>
        ) : null}

        {step === 'allergies' ? (
          <div>
            <p className="text-sm text-muted mb-2">What they must not be given, and what happens if they are.</p>
            {allergies.length > 0 ? (
              <ul className="mb-2 space-y-1">
                {allergies.map((a, i) => (
                  <li key={`${a.substance}-${i}`} className="flex items-center gap-2 text-sm">
                    <span className="badge bg-red-50 text-red-700 text-xs">{a.substance}</span>
                    <span className="text-ink flex-1">{a.reaction}</span>
                    <button type="button" aria-label={`Remove ${a.substance}`} className="text-muted hover:text-red-600" onClick={() => setAllergies(allergies.filter((_, idx) => idx !== i))}>✕</button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <CatalogueCombo endpoint="/option-catalogue?category=allergen" ariaLabel="Allergic to" placeholder="Allergic to, e.g. Penicillin" exclude={allergies.map((a) => a.substance)} keepValue initial={allergySubstance} onPick={setAllergySubstance} />
              <CatalogueCombo endpoint="/option-catalogue?category=allergy_reaction" ariaLabel="Reaction" placeholder="Reaction, e.g. rash" keepValue initial={allergyReaction} onPick={setAllergyReaction} />
              <Button type="button" variant="secondary" size="sm" disabled={!allergySubstance.trim()} onClick={addAllergy}>Add</Button>
            </div>
          </div>
        ) : null}

        {step === 'neurotype' ? (
          <div>
            <p className="text-sm text-muted mb-2">Neurodivergences such as autism, ADHD or dyslexia.</p>
            <div className="flex flex-wrap gap-2">
              {NEUROTYPE_LABELS.filter((n) => n.value !== 'other').map((n) => {
                const on = neurotypes.some((x) => x.neurotype === n.value);
                return (
                  <button
                    key={n.value}
                    type="button"
                    className={`px-3 py-1.5 rounded-full text-sm border ${on ? 'bg-primary text-btn-primary-text border-primary' : 'border-border text-ink hover:bg-surface-2'}`}
                    onClick={() =>
                      setNeurotypes((prev) => on ? prev.filter((x) => x.neurotype !== n.value) : [...prev, { name: n.label, neurotype: n.value }])
                    }
                  >
                    {n.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 'gp' ? (
          <div>
            <p className="text-sm text-muted mb-2">{isPet ? 'Their vet. Saved to the providers list.' : 'Their GP. Saved to the providers list.'}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input aria-label={isPet ? 'Vet name' : 'GP name'} placeholder="Name" value={gpName} onChange={(e) => setGpName(e.target.value)} />
              <Input aria-label="Practice" placeholder="Practice" value={gpPractice} onChange={(e) => setGpPractice(e.target.value)} />
              <Input aria-label="Phone" type="tel" placeholder="Phone" value={gpPhone} onChange={(e) => setGpPhone(e.target.value)} />
            </div>
          </div>
        ) : null}

        {step === 'emergency' ? (
          <div>
            <p className="text-sm text-muted mb-2">Who to call first in an emergency.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input aria-label="Contact name" placeholder="Name" value={emName} onChange={(e) => setEmName(e.target.value)} />
              <select aria-label="Relationship" className={inputClass} value={emRel} onChange={(e) => setEmRel(e.target.value)}>
                <option value="">Relationship</option>
                {RELATIONSHIPS.filter((r) => r !== 'Myself').map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <Input aria-label="Contact phone" type="tel" placeholder="Phone" value={emPhone} onChange={(e) => setEmPhone(e.target.value)} />
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <Button variant="ghost" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={stepIndex === 0}>
            Back
          </Button>
          <div className="flex gap-2">
            {!isLast ? (
              <Button variant="ghost" onClick={() => setStepIndex((i) => i + 1)}>Skip</Button>
            ) : null}
            <Button loading={saving && isLast} onClick={next}>
              {isLast ? 'Finish' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CarerStep({
  firstName,
  isPet,
  mode,
  onMode,
  selfPhone, setSelfPhone, selfEmail, setSelfEmail,
  personName, setPersonName, personRel, setPersonRel,
  personPhone, setPersonPhone, personEmail, setPersonEmail,
  residence, setResidence,
  startJourney, setStartJourney, residentialTemplateName,
}: {
  firstName: string;
  isPet: boolean;
  mode: CarerMode;
  onMode: (m: CarerMode) => void;
  selfPhone: string; setSelfPhone: (v: string) => void; selfEmail: string; setSelfEmail: (v: string) => void;
  personName: string; setPersonName: (v: string) => void; personRel: string; setPersonRel: (v: string) => void;
  personPhone: string; setPersonPhone: (v: string) => void; personEmail: string; setPersonEmail: (v: string) => void;
  residence: ResidenceValue; setResidence: (v: ResidenceValue) => void;
  startJourney: boolean; setStartJourney: (v: boolean) => void; residentialTemplateName: string | null;
}) {
  const choices: { value: CarerMode; label: string; blurb: string }[] = [
    { value: 'self', label: 'They manage their own care', blurb: 'Contact them directly.' },
    { value: 'person', label: isPet ? 'Their owner or a carer' : 'A family member or friend', blurb: 'A person to contact about them.' },
    { value: 'facility', label: isPet ? 'They stay at a facility' : 'They live in a care facility', blurb: 'A care home, retirement village or similar.' },
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Who is the main point of contact for {firstName}?</p>
      <div className="grid gap-2">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => onMode(c.value)}
            className={`text-left rounded-md border p-3 transition-colors ${mode === c.value ? 'border-primary bg-primary-50 dark:bg-primary-900/20' : 'border-border hover:bg-surface-2'}`}
          >
            <span className="block text-sm font-medium text-ink">{c.label}</span>
            <span className="block text-xs text-muted">{c.blurb}</span>
          </button>
        ))}
      </div>

      {mode === 'self' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Phone" type="tel" value={selfPhone} onChange={(e) => setSelfPhone(e.target.value)} />
          <Input label="Email" type="email" value={selfEmail} onChange={(e) => setSelfEmail(e.target.value)} />
        </div>
      ) : null}

      {mode === 'person' ? (
        <div className="space-y-3">
          <Input label="Name" value={personName} onChange={(e) => setPersonName(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="carer-rel" className="block text-sm font-medium text-ink mb-1">Relationship</label>
              <select id="carer-rel" className={inputClass} value={personRel} onChange={(e) => setPersonRel(e.target.value)}>
                <option value="">Choose</option>
                {RELATIONSHIPS.filter((r) => r !== 'Myself').map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <Input label="Phone" type="tel" value={personPhone} onChange={(e) => setPersonPhone(e.target.value)} />
            <Input label="Email" type="email" value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} />
          </div>
        </div>
      ) : null}

      {mode === 'facility' ? (
        <div className="space-y-3">
          <ResidenceFields value={residence} onChange={setResidence} providers={[]} />
          {residentialTemplateName ? (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={startJourney} onChange={(e) => setStartJourney(e.target.checked)} />
              Start the {residentialTemplateName} journey
              <span className="text-xs text-muted">and mark them as in residential care</span>
            </label>
          ) : (
            <p className="text-xs text-muted">They will be marked as in residential care.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
