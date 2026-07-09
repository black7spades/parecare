import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Input, Textarea } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { PET_SPECIES, petRelationshipFor, type CareProfile, type ProfileKind } from '../../lib/care';
import { matchingLifeStages, type JourneyTemplateSummary, type LifeStage } from '../../lib/journeys';
import { RelationshipSelect } from '../../components/RelationshipSelect';
import { useAuthStore } from '../../stores/auth';

export function NewCareProfile() {
  const account = useAuthStore((s) => s.account);
  const mayCreate =
    account?.can_create_care_profiles !== false || account?.role === 'admin' || account?.role === 'super_admin';
  const [kind, setKind] = useState<ProfileKind | null>(null);

  if (!mayCreate) {
    return (
      <div className="max-w-xl">
        <div className="card text-center py-10">
          <p className="text-sm text-ink font-medium mb-2">Your account cannot create care profiles.</p>
          <p className="text-sm text-muted mb-4">
            You joined PareCare to help with someone else's care. If you also need to manage care profiles of your
            own, ask an administrator to enable it for your account.
          </p>
          <Link to="/app" className="text-primary text-sm hover:underline">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!kind) return <KindChooser onChoose={setKind} />;
  return kind === 'pet' ? <PetForm onBack={() => setKind(null)} /> : <PersonForm onBack={() => setKind(null)} />;
}

/**
 * The first choice in onboarding: is this a person or a pet? It sends each
 * down its own tailored form, so a family carer setting up their dog is not
 * asked for a middle name or power of attorney.
 */
function KindChooser({ onChoose }: { onChoose: (kind: ProfileKind) => void }) {
  const options: { kind: ProfileKind; title: string; blurb: string; emoji: string }[] = [
    {
      kind: 'person',
      title: 'A person',
      blurb: 'Yourself, a child, a partner, an ageing relative, or anyone else in your care.',
      emoji: '🧑',
    },
    {
      kind: 'pet',
      title: 'A pet',
      blurb: 'A dog, cat, or any other animal you look after.',
      emoji: '🐾',
    },
  ];
  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">New care profile</h1>
        <p className="text-sm text-muted">Who are you setting up a profile for?</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.kind}
            type="button"
            onClick={() => onChoose(o.kind)}
            className="card text-left hover:border-primary transition-colors"
          >
            <span className="text-3xl" aria-hidden>
              {o.emoji}
            </span>
            <h3 className="mt-2">{o.title}</h3>
            <p className="text-sm text-muted mt-1">{o.blurb}</p>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <Link to="/app" className="text-sm text-muted hover:text-ink">
          Cancel
        </Link>
      </div>
    </div>
  );
}

function PersonForm({ onBack }: { onBack: () => void }) {
  const [title, setTitle] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [journeyIds, setJourneyIds] = useState<string[]>([]);
  const [relationship, setRelationship] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [language, setLanguage] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const displayName = [title, firstName, middleName, lastName, suffix]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const data = await api.post<{ profile: CareProfile }>('/care-profiles', {
        kind: 'person',
        title: title.trim() || null,
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim() || null,
        suffix: suffix.trim() || null,
        preferred_name: preferredName || null,
        date_of_birth: dateOfBirth || null,
        due_date: dueDate || null,
        owner_relationship: relationship.trim() || null,
        pronouns: pronouns || null,
        primary_language: language || null,
        notes: notes || null,
        journey_template_ids: journeyIds,
      });
      await queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      navigate(`/app/${data.profile.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <button type="button" onClick={onBack} className="text-sm text-muted hover:text-ink mb-2">
          ← Person or pet
        </button>
        <h1 className="text-xl font-semibold text-ink">New person</h1>
        <p className="text-sm text-muted">Set up a profile for the person whose care you are managing. That can be yourself.</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dr" />
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Middle name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Suffix" value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="e.g. OAM, Jr" />
          <Input
            label="Preferred name"
            value={preferredName}
            onChange={(e) => setPreferredName(e.target.value)}
            hint="What they like to be called"
          />
        </div>
        {displayName ? (
          <p className="text-xs text-muted">
            Shown across the app as <span className="font-medium text-ink">{displayName}</span>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
          <Input
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            hint="For a baby not yet born"
          />
        </div>
        <RelationshipSelect value={relationship} onChange={setRelationship} />
        <JourneyPicker dateOfBirth={dateOfBirth} dueDate={dueDate} selected={journeyIds} onChange={setJourneyIds} />
        <Input label="Pronouns" value={pronouns} onChange={(e) => setPronouns(e.target.value)} placeholder="e.g. she/her" />
        <Input label="Primary language" value={language} onChange={(e) => setLanguage(e.target.value)} />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Link to="/app">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" loading={saving}>
            Create profile
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * A pet's onboarding: short, and about the animal. Name and species are all
 * that is really needed; everything else is optional. Picking a species
 * pre-fills a natural relationship like "pet cat".
 */
function PetForm({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [species, setSpecies] = useState('');
  const [breed, setBreed] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [desexed, setDesexed] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [microchip, setMicrochip] = useState('');
  const [relationship, setRelationship] = useState('');
  // Once the carer edits the relationship, stop overwriting it from species.
  const [relationshipTouched, setRelationshipTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const displayName = [name, familyName].map((p) => p.trim()).filter(Boolean).join(' ');
  const relationshipValue = relationshipTouched ? relationship : species ? petRelationshipFor(species) : relationship;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const data = await api.post<{ profile: CareProfile }>('/care-profiles', {
        kind: 'pet',
        first_name: name.trim(),
        last_name: familyName.trim() || null,
        preferred_name: preferredName.trim() || null,
        species: species || null,
        breed: breed.trim() || null,
        pronouns: pronouns || null,
        desexed,
        date_of_birth: dateOfBirth || null,
        microchip_number: microchip.trim() || null,
        owner_relationship: relationshipValue.trim() || null,
        notes: notes || null,
        // A pet is not enrolled in the human ageing journey by default.
        journey_template_ids: [],
      });
      await queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      navigate(`/app/${data.profile.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <button type="button" onClick={onBack} className="text-sm text-muted hover:text-ink mb-2">
          ← Person or pet
        </button>
        <h1 className="text-xl font-semibold text-ink">New pet</h1>
        <p className="text-sm text-muted">Just a name and what kind of animal to start. You can fill in the rest later.</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Family name" value={familyName} onChange={(e) => setFamilyName(e.target.value)} hint="If they share your surname" />
        </div>
        <Input
          label="Known as"
          value={preferredName}
          onChange={(e) => setPreferredName(e.target.value)}
          hint="A nickname you actually call them"
        />
        {displayName ? (
          <p className="text-xs text-muted">
            Shown across the app as <span className="font-medium text-ink">{displayName}</span>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pet-species" className="block text-sm font-medium text-ink mb-1">
              Species
            </label>
            <select
              id="pet-species"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
            >
              <option value="">Choose one…</option>
              {PET_SPECIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <Input label="Breed" value={breed} onChange={(e) => setBreed(e.target.value)} placeholder="e.g. Ragdoll" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} hint="Or your best guess" />
          <Input label="Pronouns" value={pronouns} onChange={(e) => setPronouns(e.target.value)} placeholder="e.g. she/her" />
        </div>
        <Input
          label="What they are to you"
          value={relationshipValue}
          onChange={(e) => {
            setRelationshipTouched(true);
            setRelationship(e.target.value);
          }}
          placeholder="e.g. pet cat"
        />
        <Input
          label="Microchip number"
          value={microchip}
          onChange={(e) => setMicrochip(e.target.value)}
          hint="If they are microchipped"
        />
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={desexed}
            onChange={(e) => setDesexed(e.target.checked)}
          />
          Desexed
          <span className="text-xs text-muted">neutered or spayed</span>
        </label>
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Link to="/app">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" loading={saving}>
            Create profile
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Care journeys to start with, suggested by life stage from the date of
 * birth or due date. Optional; journeys can always be added later, and
 * any journey can be applied to anyone.
 */
function JourneyPicker({
  dateOfBirth,
  dueDate,
  selected,
  onChange,
}: {
  dateOfBirth: string;
  dueDate: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const { data: stagesData } = useQuery({
    queryKey: ['life-stages'],
    queryFn: () => api.get<{ stages: LifeStage[] }>(`/life-stages`),
  });
  const { data: templatesData } = useQuery({
    queryKey: ['journey-templates'],
    queryFn: () => api.get<{ templates: JourneyTemplateSummary[] }>(`/journey-templates`),
  });
  const stages = useMemo(() => stagesData?.stages ?? [], [stagesData]);
  const templates = useMemo(() => templatesData?.templates ?? [], [templatesData]);

  const matched = useMemo(
    () => matchingLifeStages(stages, { date_of_birth: dateOfBirth || null, due_date: dueDate || null }),
    [stages, dateOfBirth, dueDate]
  );
  const matchedIds = new Set(matched.map((s) => s.id));
  const suggested = templates.filter((t) => t.life_stage_ids.some((id) => matchedIds.has(id)));
  const shown = showAll || suggested.length === 0 ? templates : suggested;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div>
      <p className="block text-sm font-medium text-ink mb-1">Care journeys to start with</p>
      <p className="text-xs text-muted mb-2">
        {matched.length > 0
          ? `Suggested for ${matched.map((s) => s.name.toLowerCase()).join(' and ')}. `
          : 'Enter a date of birth or due date to see suggestions. '}
        Optional, and journeys can be added or changed at any time.
      </p>
      <div className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {shown.map((t) => (
          <label key={t.id} className="flex items-start gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-surface">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={selected.includes(t.id)}
              onChange={() => toggle(t.id)}
            />
            <span>
              <span className="text-ink">{t.name}</span>
              <span className="block text-xs text-muted line-clamp-1">{t.description}</span>
            </span>
          </label>
        ))}
        {shown.length === 0 ? <p className="px-3 py-2 text-sm text-muted">The journey library is empty.</p> : null}
      </div>
      {suggested.length > 0 && suggested.length < templates.length ? (
        <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show suggestions only' : `Show the whole library (${templates.length})`}
        </button>
      ) : null}
    </div>
  );
}
