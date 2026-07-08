import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Input, Textarea } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { CARE_PHASES, type CareProfile } from '../../lib/care';
import { RelationshipSelect } from '../../components/RelationshipSelect';
import { useAuthStore } from '../../stores/auth';

export function NewCareProfile() {
  const account = useAuthStore((s) => s.account);
  const mayCreate =
    account?.can_create_care_profiles !== false || account?.role === 'admin' || account?.role === 'super_admin';
  const [title, setTitle] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phase, setPhase] = useState('early_concern');
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
        title: title.trim() || null,
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim() || null,
        suffix: suffix.trim() || null,
        preferred_name: preferredName || null,
        date_of_birth: dateOfBirth || null,
        current_phase: phase,
        owner_relationship: relationship.trim() || null,
        pronouns: pronouns || null,
        primary_language: language || null,
        notes: notes || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      navigate(`/app/${data.profile.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setSaving(false);
    }
  }

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

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">New care profile</h1>
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
        <Input label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
        <RelationshipSelect value={relationship} onChange={setRelationship} />
        <div>
          <label htmlFor="care-phase" className="block text-sm font-medium text-ink mb-1">
            Current phase of care
          </label>
          <select
            id="care-phase"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
          >
            {CARE_PHASES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">A starter checklist for this phase is created automatically.</p>
        </div>
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
