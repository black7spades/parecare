import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { CatalogueCombo } from '../../components/CatalogueCombo';
import { IdentifiersForm } from '../../components/IdentifiersForm';
import { ResidenceFields, emptyResidence, persistResidence, type ResidenceValue } from '../../components/ResidenceFields';
import {
  EMERGENCY_RELATIONSHIPS,
  NEUROTYPE_LABELS,
  POA_TYPES,
  RELATIONSHIPS,
  inverseRelationship,
  isSelfRelationship,
  type CareProfile,
  type IdentifierField,
} from '../../lib/care';
import { useAuthStore } from '../../stores/auth';
import type { JourneyTemplateSummary } from '../../lib/journeys';

/**
 * The guided setup that runs after a person or pet is created. One step per
 * screen, every step skippable, and only the steps that fit the profile are
 * shown (no neurotype or pharmacy for a pet; a vet instead of a GP). On your
 * own profile it speaks to you: "Your medicines", "Your pharmacy".
 *
 * Nothing is written until Finish. Each thing is then saved in turn and
 * remembered once it is saved, and each carries its own key, so trying again
 * after a failure picks up where it stopped and adds nothing twice.
 */

type StepId = 'carer' | 'conditions' | 'allergies' | 'neurotype' | 'medicines' | 'gp' | 'pharmacy' | 'ids' | 'directive' | 'poa' | 'emergency';
type CarerMode = '' | 'self' | 'person' | 'facility';
type WhoChoice = 'me' | 'carer' | 'other' | 'none';

const inputClass =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** Journey templates that suit someone moving into residential care. */
const RESIDENTIAL_HINT = /aged|ageing|aging|residential|older|elder|dementia|nursing/i;

interface SetupMed {
  key: string;
  name: string;
  amount: string;
  measure: string;
  times: string[];
  asNeeded: boolean;
}

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

const FAILED = 'That did not save. Nothing was added twice. Try again.';

export function ProfileOnboarding({ profile, onDone }: { profile: CareProfile; onDone: () => void }) {
  const isPet = profile.kind === 'pet';
  const firstName = profile.preferred_name ?? profile.first_name ?? profile.full_name;
  // Your own profile speaks to you.
  const self = !isPet && isSelfRelationship(profile.owner_relationship);
  const their = self ? 'your' : 'their';
  const Their = self ? 'Your' : 'Their';

  const steps: StepId[] = useMemo(
    () =>
      (isPet
        ? ['carer', 'conditions', 'allergies', 'medicines', 'gp', 'emergency']
        : ['carer', 'conditions', 'allergies', 'neurotype', 'medicines', 'gp', 'pharmacy', 'ids', 'directive', 'poa', 'emergency']) as StepId[],
    [isPet]
  );
  const stepTitle: Record<StepId, string> = {
    carer: self ? 'Who looks after your care?' : 'Who cares for them?',
    conditions: 'Conditions',
    allergies: 'Allergies',
    neurotype: 'Neurotypes',
    medicines: self ? 'Medicines you take' : `Medicines ${firstName} takes`,
    gp: isPet ? 'Vet' : `${Their} GP`,
    pharmacy: `${Their} pharmacy`,
    ids: 'ID numbers',
    directive: 'Advance care directive',
    poa: 'Power of attorney',
    emergency: 'Who to call in an emergency',
  };
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

  // Medicines, pharmacy, ID numbers, directive, power of attorney
  const [meds, setMeds] = useState<SetupMed[]>([]);
  const [medName, setMedName] = useState('');
  const [medAmount, setMedAmount] = useState('');
  const [medMeasure, setMedMeasure] = useState('');
  const [medTime, setMedTime] = useState('');
  const [medTimes, setMedTimes] = useState<string[]>([]);
  const [medAsNeeded, setMedAsNeeded] = useState(false);
  const [medNote, setMedNote] = useState('');
  const [pharmacyName, setPharmacyName] = useState('');
  const [pharmacyPhone, setPharmacyPhone] = useState('');
  const [ids, setIds] = useState<Partial<Record<IdentifierField, string>>>({});
  const [directive, setDirective] = useState<'' | 'yes' | 'no' | 'unsure'>('');
  const [directiveWhere, setDirectiveWhere] = useState('');
  const [poaWho, setPoaWho] = useState<WhoChoice>('none');
  const [poaName, setPoaName] = useState('');
  const [poaRel, setPoaRel] = useState('');
  const [poaPhone, setPoaPhone] = useState('');
  const [poaType, setPoaType] = useState<string>(POA_TYPES[0].value);

  // Who to call: the account holder when the person is not themselves
  // ("Is it you, Linda?"), the carer named on the first step, or someone
  // else named here, who joins the circle.
  const account = useAuthStore((st) => st.account);
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ id: string; phone: string | null; gender: string | null }>('/auth/me') });
  const myFirstName = (account?.display_name ?? '').split(' ')[0] || 'you';
  const carerNamed = carerMode === 'person' && personName.trim() ? personName.trim() : '';
  const [emChoice, setEmChoice] = useState<WhoChoice | ''>('');
  const emWho: WhoChoice = emChoice || (isPet ? 'other' : self ? (carerNamed ? 'carer' : 'other') : 'me');
  const [emName, setEmName] = useState('');
  const [emRel, setEmRel] = useState('');
  const [emPhone, setEmPhone] = useState('');
  const myRelationship = inverseRelationship(profile.owner_relationship, me?.gender) ?? '';

  const [error, setError] = useState('');
  const [left, setLeft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // What has saved, so trying again carries on from where it stopped.
  const done = useRef(new Set<string>());
  // The key for a medicine still in the boxes at Finish, the same on every try.
  const typedMedKey = useRef(newKey());

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
    if (!allergySubstance.trim()) {
      setError('Type what they are allergic to, then add it.');
      return;
    }
    setError('');
    setAllergies((prev) => [...prev, { substance: allergySubstance.trim(), reaction: allergyReaction.trim() }]);
    setAllergySubstance('');
    setAllergyReaction('');
  };

  const addMed = () => {
    if (!medName.trim()) {
      setMedNote('Type the medicine name first, then add it.');
      document.getElementById('setup-med-name')?.focus();
      return;
    }
    const times = medTime && !medTimes.includes(medTime) ? [...medTimes, medTime] : medTimes;
    setMeds((m) => [...m, { key: newKey(), name: medName.trim(), amount: medAmount.trim(), measure: medMeasure.trim(), times: medAsNeeded ? [] : [...times].sort(), asNeeded: medAsNeeded }]);
    setMedName('');
    setMedAmount('');
    setMedMeasure('');
    setMedTime('');
    setMedTimes([]);
    setMedAsNeeded(false);
    setMedNote('');
  };

  /** Run one save once: skipped when it already saved on an earlier try. */
  async function once(key: string, label: string, run: () => Promise<unknown>, pending: string[]) {
    if (done.current.has(key)) return;
    pending.push(label);
    await run();
    done.current.add(key);
    pending.pop();
  }

  async function saveAll() {
    setError('');
    setLeft([]);
    setSaving(true);
    const pending: string[] = [];
    // A medicine still in the boxes counts as added.
    const allMeds = medName.trim()
      ? [...meds, { key: 'typed-med', name: medName.trim(), amount: medAmount.trim(), measure: medMeasure.trim(), times: medAsNeeded ? [] : (medTime ? [...new Set([...medTimes, medTime])] : medTimes), asNeeded: medAsNeeded }]
      : meds;
    try {
      // 1. Carer -> contact, and for a facility also residence, phase and journey.
      await once('carer', 'who cares for them', async () => {
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
        if (Object.keys(profilePatch).length > 0) await api.patch(`/care-profiles/${profile.id}`, profilePatch);
      }, pending);
      if (carerMode === 'facility' && startJourney && residentialTemplate) {
        await once('journey', 'the journey', () => api.post(`/care-profiles/${profile.id}/journeys`, { template_id: residentialTemplate.id }), pending);
      }

      // 2. Health facts, one at a time, each remembered once saved.
      for (const name of conditions) {
        await once(`condition:${name}`, 'conditions', () => api.post(`/care-profiles/${profile.id}/conditions`, { name }), pending);
      }
      for (const n of neurotypes) {
        await once(`neurotype:${n.neurotype}`, 'neurotypes', () => api.post(`/care-profiles/${profile.id}/conditions`, { name: n.name, category: 'neurotype', neurotype: n.neurotype }), pending);
      }
      for (const a of allergies) {
        await once(`allergy:${a.substance.toLowerCase()}`, 'allergies', () => api.post(`/care-profiles/${profile.id}/allergies`, { substance: a.substance, reaction: a.reaction || null }), pending);
      }
      // Each medicine carries its own key, so the server adds it once however often this runs.
      for (const m of allMeds) {
        await once(`med:${m.key}`, 'medicines', () =>
          api.post(`/care-profiles/${profile.id}/medications`, {
            name: m.name,
            dose_amount: m.amount || null,
            dose_unit: m.measure || null,
            schedule_times: m.asNeeded ? [] : m.times,
            as_needed: m.asNeeded,
            client_key: m.key === 'typed-med' ? typedMedKey.current : m.key,
          }), pending);
      }
      // Contacts are found by name before anyone is filed.
      if (gpName.trim()) {
        await once('gp', isPet ? 'the vet' : 'the GP', () =>
          api.post(`/care-profiles/${profile.id}/providers`, {
            ensure: true,
            provider_type: isPet ? 'vet' : 'gp',
            name: gpName.trim(),
            organisation: gpPractice.trim() || null,
            phone: gpPhone.trim() || null,
          }), pending);
      }
      if (pharmacyName.trim()) {
        await once('pharmacy', 'the pharmacy', () =>
          api.post(`/care-profiles/${profile.id}/providers`, {
            ensure: true,
            kind: 'organisation',
            provider_type: 'pharmacy',
            name: pharmacyName.trim(),
            phone: pharmacyPhone.trim() || null,
          }), pending);
      }
      const idChanges = Object.fromEntries(Object.entries(ids).filter(([, v]) => (v ?? '').trim()));
      if (Object.keys(idChanges).length > 0) {
        await once('ids', 'ID numbers', async () => {
          const res = await api.put<{ problems?: Record<string, string> }>(`/care-profiles/${profile.id}/identifiers`, idChanges);
          const bad = Object.values(res.problems ?? {});
          if (bad.length) throw new Error(`An ID number did not look right: ${bad[0]} Go back to ID numbers to fix it, or clear the box.`);
        }, pending);
      }
      if (directive === 'yes' || directive === 'no') {
        await once('directive', 'the advance care directive', () =>
          api.put(`/care-profiles/${profile.id}/plan`, {
            advance_care_directive: directive === 'yes',
            advance_care_directive_location: directive === 'yes' ? directiveWhere.trim() || null : null,
          }), pending);
      }

      // 3. People: the carer, whoever holds power of attorney and who to
      // call, each added to the circle once by name and pointed at from there.
      const circlePerson = async (name: string, relationship: string, phone: string, extra: Record<string, unknown> = {}) => {
        const added = await api.post<{ member: { id: string } }>(`/care-profiles/${profile.id}/circle/people`, {
          setup: true,
          display_name: name,
          role: /daughter|son|mother|father|sister|brother|partner|wife|husband|grand|niece|nephew|aunt|uncle|cousin/i.test(relationship) ? 'family' : 'other',
          relationship: relationship || null,
          phone: phone || null,
          ...extra,
        });
        return added.member.id;
      };
      if (poaWho === 'carer' && carerNamed) {
        await once('poa', 'power of attorney', () => circlePerson(carerNamed, personRel.trim(), personPhone.trim(), { poa_type: poaType }), pending);
      } else if (poaWho === 'other' && poaName.trim()) {
        await once('poa', 'power of attorney', () => circlePerson(poaName.trim(), poaRel.trim(), poaPhone.trim(), { poa_type: poaType }), pending);
      }
      if (emWho === 'me' && me?.id && !self) {
        await once('emergency', 'who to call', () =>
          api.post(`/care-profiles/${profile.id}/emergency-contacts`, {
            ref: { account_id: me.id },
            relationship: (emRel || myRelationship).trim() || null,
            phone: emPhone.trim() || null,
          }), pending);
      } else if (emWho === 'carer' && carerNamed) {
        await once('emergency', 'who to call', async () => {
          const id = await circlePerson(carerNamed, personRel.trim(), personPhone.trim());
          await api.post(`/care-profiles/${profile.id}/emergency-contacts`, { ref: { circle_member_id: id }, relationship: personRel.trim() || null });
        }, pending);
      } else if (emWho === 'other' && emName.trim()) {
        await once('emergency', 'who to call', async () => {
          const id = await circlePerson(emName.trim(), emRel.trim(), emPhone.trim());
          await api.post(`/care-profiles/${profile.id}/emergency-contacts`, { ref: { circle_member_id: id }, relationship: emRel.trim() || null });
        }, pending);
      }

      onDone();
    } catch (err) {
      // Say it plainly, say nothing was doubled, and keep everything typed.
      const why = err instanceof Error && err.message && !/^(request failed|internal|network)/i.test(err.message) ? err.message : '';
      setError(why ? `${FAILED} ${why}` : FAILED);
      setLeft([...new Set(pending)]);
      setSaving(false);
    }
  }

  const next = () => {
    // A phone is welcome but never required: who to call is saved either
    // way, and the emergency contacts list offers Add their phone later.
    setError('');
    if (isLast) void saveAll();
    else setStepIndex((i) => i + 1);
  };

  const radio = (name: string, checked: boolean, onPick: () => void, label: string) => (
    <label className="flex items-center gap-2">
      <input type="radio" name={name} checked={checked} onChange={onPick} />
      {label}
    </label>
  );

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted">{self ? 'Setting up your profile' : `Setting up ${firstName}`}</p>
          <h1 className="text-2xl font-bold text-ink">{stepTitle[step]}</h1>
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
      <p className="sr-only" aria-live="polite">Step {stepIndex + 1} of {steps.length}: {stepTitle[step]}</p>

      <div className="card space-y-4">
        {step === 'carer' ? (
          <CarerStep
            firstName={firstName}
            isPet={isPet}
            self={self}
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
              {isPet ? 'Any ongoing conditions or diagnoses.' : `Conditions, illnesses or diagnoses ${self ? 'you have' : 'they have'}. Type to search; anything new joins the shared list.`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {conditions.map((c) => (
                <span key={c} className="badge bg-surface-2 text-ink text-xs flex items-center gap-1">
                  {c}
                  <button type="button" aria-label={`Remove ${c}`} title={`Remove ${c}`} className="text-muted hover:text-red-600" onClick={() => setConditions(conditions.filter((x) => x !== c))}>✕</button>
                </span>
              ))}
              <CatalogueCombo endpoint="/condition-catalogue" ariaLabel="Add a condition" placeholder="e.g. Asthma" exclude={conditions}
                onPick={(name) => { if (!conditions.includes(name)) setConditions([...conditions, name]); }} />
            </div>
          </div>
        ) : null}

        {step === 'allergies' ? (
          <div>
            <p className="text-sm text-muted mb-2">What {self ? 'you' : 'they'} must not be given, and what happens if {self ? 'you are' : 'they are'}.</p>
            {allergies.length > 0 ? (
              <ul className="mb-2 space-y-1">
                {allergies.map((a, i) => (
                  <li key={`${a.substance}-${i}`} className="flex items-center gap-2 text-sm">
                    <span className="badge bg-red-50 text-red-700 text-xs">{a.substance}</span>
                    <span className="text-ink flex-1">{a.reaction}</span>
                    <button type="button" aria-label={`Remove ${a.substance}`} title={`Remove ${a.substance}`} className="text-muted hover:text-red-600" onClick={() => setAllergies(allergies.filter((_, idx) => idx !== i))}>✕</button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <CatalogueCombo endpoint="/option-catalogue?category=allergen" ariaLabel="Allergic to" placeholder="Allergic to, e.g. Penicillin" exclude={allergies.map((a) => a.substance)} keepValue initial={allergySubstance} onPick={setAllergySubstance} />
              <CatalogueCombo endpoint="/option-catalogue?category=allergy_reaction" ariaLabel="Reaction" placeholder="Reaction, e.g. rash" keepValue initial={allergyReaction} onPick={setAllergyReaction} />
              <Button type="button" variant="secondary" size="sm" onClick={addAllergy}>Add</Button>
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
                  <Button
                    key={n.value}
                    type="button"
                    size="sm"
                    variant={on ? 'secondary' : 'ghost'}
                    aria-pressed={on}
                    onClick={() =>
                      setNeurotypes((prev) => on ? prev.filter((x) => x.neurotype !== n.value) : [...prev, { name: n.label, neurotype: n.value }])
                    }
                  >
                    {on ? '✓ ' : ''}{n.label}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 'medicines' ? (
          <MedicinesStep
            self={self}
            meds={meds}
            onRemove={(key) => setMeds((m) => m.filter((x) => x.key !== key))}
            name={medName} setName={setMedName}
            amount={medAmount} setAmount={setMedAmount}
            measure={medMeasure} setMeasure={setMedMeasure}
            time={medTime} setTime={setMedTime}
            times={medTimes} setTimes={setMedTimes}
            asNeeded={medAsNeeded} setAsNeeded={setMedAsNeeded}
            note={medNote}
            onAdd={addMed}
          />
        ) : null}

        {step === 'gp' ? (
          <div>
            <p className="text-sm text-muted mb-2">{isPet ? 'Their vet. Saved to Contacts.' : `${Their} GP. Saved to Contacts, with the practice and phone.`}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input aria-label={isPet ? 'Vet name' : 'GP name'} placeholder="Name" value={gpName} onChange={(e) => setGpName(e.target.value)} />
              <Input aria-label="Practice" placeholder="Practice" value={gpPractice} onChange={(e) => setGpPractice(e.target.value)} />
              <Input aria-label="Phone" type="tel" placeholder="Phone" value={gpPhone} onChange={(e) => setGpPhone(e.target.value)} />
            </div>
          </div>
        ) : null}

        {step === 'pharmacy' ? (
          <div>
            <p className="text-sm text-muted mb-2">
              Where {their} scripts are filled. When a medicine runs low, PareCare shows this pharmacy and its number to call.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Pharmacy name" placeholder="Pharmacy name" value={pharmacyName} onChange={(e) => setPharmacyName(e.target.value)} />
              <Input aria-label="Pharmacy phone" type="tel" placeholder="Phone" value={pharmacyPhone} onChange={(e) => setPharmacyPhone(e.target.value)} />
            </div>
          </div>
        ) : null}

        {step === 'ids' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              The numbers on {their} cards, each in its own box, so they are on the emergency sheet when someone needs them. Fill in the ones to hand and skip the rest.
            </p>
            <IdentifiersForm profileId={profile.id} canEdit onDraft={setIds} initialDraft={ids} />
          </div>
        ) : null}

        {step === 'directive' ? (
          <fieldset className="space-y-3 text-sm text-ink">
            <legend className="text-sm text-muted mb-1">
              An advance care directive writes down the care {self ? 'you want' : 'they want'} if {self ? 'you cannot' : 'they cannot'} say. {self ? 'Do you have one?' : 'Do they have one?'}
            </legend>
            {radio('setup-directive', directive === 'yes', () => setDirective('yes'), 'Yes')}
            {radio('setup-directive', directive === 'no', () => setDirective('no'), 'No')}
            {radio('setup-directive', directive === 'unsure', () => setDirective('unsure'), 'Not sure')}
            {directive === 'yes' ? (
              <Input label="Where is it kept?" value={directiveWhere} onChange={(e) => setDirectiveWhere(e.target.value)} placeholder="e.g. Kitchen drawer, blue folder" hint="Shown on the emergency sheet, so paramedics know where to look." />
            ) : null}
          </fieldset>
        ) : null}

        {step === 'poa' ? (
          <fieldset className="space-y-3 text-sm text-ink">
            <legend className="text-sm text-muted mb-1">
              Someone allowed by law to make decisions for {self ? 'you' : firstName}. Who holds it?
            </legend>
            {radio('setup-poa', poaWho === 'none', () => setPoaWho('none'), 'Nobody yet, or not sure')}
            {carerNamed ? radio('setup-poa', poaWho === 'carer', () => setPoaWho('carer'), carerNamed) : null}
            {radio('setup-poa', poaWho === 'other', () => setPoaWho('other'), carerNamed ? 'Someone else' : 'Someone')}
            {poaWho === 'other' ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <Input aria-label="Their name" placeholder="Name" value={poaName} onChange={(e) => setPoaName(e.target.value)} />
                <Input aria-label="Relationship" placeholder="Relationship, e.g. Son" value={poaRel} onChange={(e) => setPoaRel(e.target.value)} list="onboarding-em-rel" />
                <Input aria-label="Their phone" type="tel" placeholder="Phone" value={poaPhone} onChange={(e) => setPoaPhone(e.target.value)} />
              </div>
            ) : null}
            {poaWho !== 'none' ? (
              <div>
                <label htmlFor="setup-poa-type" className="block text-sm font-medium text-ink mb-1">What kind</label>
                <select id="setup-poa-type" className={inputClass} value={poaType} onChange={(e) => setPoaType(e.target.value)}>
                  {POA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            ) : null}
          </fieldset>
        ) : null}

        {step === 'emergency' ? (
          <div>
            <p className="text-sm text-muted mb-2">Who to call first in an emergency.</p>
            <fieldset className="mb-3 space-y-1 text-sm text-ink">
              <legend className="sr-only">Who to call</legend>
              {!isPet && !self && account ? radio('em-who', emWho === 'me', () => setEmChoice('me'), `Is it you, ${myFirstName}?`) : null}
              {carerNamed ? radio('em-who', emWho === 'carer', () => setEmChoice('carer'), `${carerNamed}, who ${self ? 'looks after your care' : 'cares for them'}`) : null}
              {radio('em-who', emWho === 'other', () => setEmChoice('other'), 'Someone else')}
            </fieldset>
            {emWho === 'me' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="Relationship"
                  placeholder="Relationship, e.g. Daughter"
                  value={emRel || myRelationship}
                  onChange={(e) => setEmRel(e.target.value)}
                  list="onboarding-em-rel"
                />
                {me?.phone ? (
                  <p className="text-sm text-muted self-center">Your phone {me.phone} is on your account.</p>
                ) : (
                  <Input
                    id="onboarding-em-phone"
                    aria-label="Your phone"
                    type="tel"
                    placeholder="Your phone"
                    value={emPhone}
                    onChange={(e) => setEmPhone(e.target.value)}
                    hint="Shown wherever you are picked, for example as an emergency contact."
                  />
                )}
              </div>
            ) : emWho === 'carer' ? (
              <p className="text-sm text-muted">{carerNamed}{personPhone.trim() ? `, ${personPhone.trim()}` : ''}. Their details come from the first step.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                <Input aria-label="Contact name" placeholder="Name" value={emName} onChange={(e) => setEmName(e.target.value)} />
                <Input aria-label="Relationship" placeholder="Relationship, e.g. Son" value={emRel} onChange={(e) => setEmRel(e.target.value)} list="onboarding-em-rel" />
                <Input id="onboarding-em-phone" aria-label="Contact phone" type="tel" placeholder="Phone" value={emPhone} onChange={(e) => setEmPhone(e.target.value)} />
              </div>
            )}
          </div>
        ) : null}
        <datalist id="onboarding-em-rel">
          {EMERGENCY_RELATIONSHIPS.map((r) => <option key={r} value={r} />)}
        </datalist>

        {error ? (
          <div className="rounded-md border-l-4 border-red-400 bg-red-50 dark:bg-red-900/10 px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">
            <p>{error}</p>
            {left.length ? <p className="text-xs mt-1">Still to save: {left.join(', ')}. Everything before that is saved.</p> : null}
          </div>
        ) : null}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          {stepIndex > 0 ? (
            <Button variant="ghost" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
              Back
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            {!isLast ? (
              <Button variant="ghost" onClick={() => setStepIndex((i) => i + 1)}>Skip</Button>
            ) : null}
            <Button loading={saving && isLast} onClick={next}>
              {isLast ? (error ? 'Try again' : 'Finish') : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MedicinesStep({
  self,
  meds,
  onRemove,
  name, setName, amount, setAmount, measure, setMeasure, time, setTime, times, setTimes, asNeeded, setAsNeeded,
  note,
  onAdd,
}: {
  self: boolean;
  meds: SetupMed[];
  onRemove: (key: string) => void;
  name: string; setName: (v: string) => void;
  amount: string; setAmount: (v: string) => void;
  measure: string; setMeasure: (v: string) => void;
  time: string; setTime: (v: string) => void;
  times: string[]; setTimes: (v: string[]) => void;
  asNeeded: boolean; setAsNeeded: (v: boolean) => void;
  note: string;
  onAdd: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['medication-catalogue'],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/medication-catalogue'),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {self ? 'The medicines you take' : 'The medicines they take'}, with how much and when. Doses show up on the medication record when they are due. Add as many as you like, or skip this and add them later.
      </p>
      {meds.length > 0 ? (
        <ul className="space-y-1">
          {meds.map((m) => (
            <li key={m.key} className="flex items-center gap-2 text-sm">
              <span className="font-medium text-ink">{m.name}</span>
              {m.amount ? <span className="text-muted">{m.amount}</span> : null}
              {m.measure ? <span className="text-muted">{m.measure}</span> : null}
              <span className="text-muted flex-1">{m.asNeeded ? 'Only when needed' : m.times.join(', ')}</span>
              <button type="button" aria-label={`Remove ${m.name}`} title={`Remove ${m.name}`} className="text-muted hover:text-red-600" onClick={() => onRemove(m.key)}>✕</button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input id="setup-med-name" label="Medicine" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Metformin" list="setup-med-options" autoComplete="off" />
      <datalist id="setup-med-options">
        {(data?.items ?? []).slice(0, 300).map((i) => <option key={i.id} value={i.name} />)}
      </datalist>
      <div className="grid gap-2 grid-cols-2">
        <Input label="How much" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" inputMode="decimal" />
        <Input label="Measure" value={measure} onChange={(e) => setMeasure(e.target.value)} placeholder="e.g. mg" />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={asNeeded} onChange={(e) => setAsNeeded(e.target.checked)} />
        Only when needed
      </label>
      {!asNeeded ? (
        <div>
          <div className="flex items-end gap-2">
            <Input label="When" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                if (time && !times.includes(time)) setTimes([...times, time].sort());
                setTime('');
              }}
            >
              Add another time
            </Button>
          </div>
          {times.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {times.map((t) => (
                <span key={t} className="badge bg-surface-2 text-ink text-xs flex items-center gap-1">
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} title={`Remove ${t}`} className="text-muted hover:text-red-600" onClick={() => setTimes(times.filter((x) => x !== t))}>✕</button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {note ? <p className="text-sm text-red-600" role="alert">{note}</p> : null}
      <Button type="button" variant="secondary" size="sm" onClick={onAdd}>Add this medicine</Button>
    </div>
  );
}

function CarerStep({
  firstName,
  isPet,
  self,
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
  self: boolean;
  mode: CarerMode;
  onMode: (m: CarerMode) => void;
  selfPhone: string; setSelfPhone: (v: string) => void; selfEmail: string; setSelfEmail: (v: string) => void;
  personName: string; setPersonName: (v: string) => void; personRel: string; setPersonRel: (v: string) => void;
  personPhone: string; setPersonPhone: (v: string) => void; personEmail: string; setPersonEmail: (v: string) => void;
  residence: ResidenceValue; setResidence: (v: ResidenceValue) => void;
  startJourney: boolean; setStartJourney: (v: boolean) => void; residentialTemplateName: string | null;
}) {
  const choices: { value: CarerMode; label: string; blurb: string }[] = self
    ? [
        { value: 'self', label: 'I manage my own care', blurb: 'People contact me directly.' },
        { value: 'person', label: 'A family member or friend helps me', blurb: 'Someone to contact about me.' },
        { value: 'facility', label: 'I live in a care facility', blurb: 'A care home, retirement village or similar.' },
      ]
    : [
        { value: 'self', label: 'They manage their own care', blurb: 'Contact them directly.' },
        { value: 'person', label: isPet ? 'Their owner or a carer' : 'A family member or friend', blurb: 'A person to contact about them.' },
        { value: 'facility', label: isPet ? 'They stay at a facility' : 'They live in a care facility', blurb: 'A care home, retirement village or similar.' },
      ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{self ? 'Who is the main point of contact for you?' : `Who is the main point of contact for ${firstName}?`}</p>
      <div className="grid gap-2" role="radiogroup" aria-label="Who cares for them">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={mode === c.value}
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
          <Input label={self ? 'Your phone' : 'Phone'} type="tel" value={selfPhone} onChange={(e) => setSelfPhone(e.target.value)} />
          <Input label={self ? 'Your email' : 'Email'} type="email" value={selfEmail} onChange={(e) => setSelfEmail(e.target.value)} />
        </div>
      ) : null}

      {mode === 'person' ? (
        <div className="space-y-3">
          <Input label="Name" value={personName} onChange={(e) => setPersonName(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="carer-rel" className="block text-sm font-medium text-ink mb-1">{self ? 'Who they are to you' : 'Relationship'}</label>
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
              <span className="text-xs text-muted">and mark {self ? 'you' : 'them'} as in residential care</span>
            </label>
          ) : (
            <p className="text-xs text-muted">{self ? 'You will' : 'They will'} be marked as in residential care.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
