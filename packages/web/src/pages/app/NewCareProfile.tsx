import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Input, Textarea } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { CARE_PHASES, type CareProfile } from '../../lib/care';

export function NewCareProfile() {
  const [fullName, setFullName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phase, setPhase] = useState('early_concern');
  const [pronouns, setPronouns] = useState('');
  const [language, setLanguage] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const data = await api.post<{ profile: CareProfile }>('/care-profiles', {
        full_name: fullName,
        preferred_name: preferredName || null,
        date_of_birth: dateOfBirth || null,
        current_phase: phase,
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

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">New care profile</h1>
        <p className="text-sm text-muted">Set up a profile for the person you're caring for.</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <Input
          label="Preferred name"
          value={preferredName}
          onChange={(e) => setPreferredName(e.target.value)}
          hint="What they like to be called (optional)"
        />
        <Input label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
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
