import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { AvatarEditor } from '../../../components/ui/AvatarEditor';
import { Avatar } from '../../../components/ui/Avatar';
import { ContactDetails, contactPayload, emptyContact, type ContactValue } from '../../../components/ContactDetails';
import { PET_SPECIES, type CareProfile } from '../../../lib/care';

/** Edit the person or pet in care, and their photo. Shown only to those with edit access. */
export function EditProfileModal({
  profile,
  open,
  onClose,
}: {
  profile: CareProfile;
  open: boolean;
  onClose: () => void;
}) {
  const isPet = profile.kind === 'pet';
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [dob, setDob] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [notes, setNotes] = useState('');
  const [species, setSpecies] = useState('');
  const [breed, setBreed] = useState('');
  const [desexed, setDesexed] = useState(false);
  const [microchip, setMicrochip] = useState('');
  const [contact, setContact] = useState<ContactValue>(emptyContact);
  const [error, setError] = useState('');
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoError, setPhotoError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(profile.title ?? '');
    setFirstName(profile.first_name ?? '');
    setMiddleName(profile.middle_name ?? '');
    setLastName(profile.last_name ?? '');
    setSuffix(profile.suffix ?? '');
    setPreferredName(profile.preferred_name ?? '');
    setDob(profile.date_of_birth ? profile.date_of_birth.slice(0, 10) : '');
    setPronouns(profile.pronouns ?? '');
    setNotes(profile.notes ?? '');
    setSpecies(profile.species ?? '');
    setBreed(profile.breed ?? '');
    setDesexed(!!profile.desexed);
    setMicrochip(profile.microchip_number ?? '');
    setContact({
      kind: profile.contact_kind ?? '',
      account_id: profile.contact_account_id ?? '',
      name: profile.contact_name ?? '',
      relationship: profile.contact_relationship ?? '',
      phone: profile.contact_phone ?? '',
      phone_type: profile.contact_phone_type ?? 'mobile',
      email: profile.contact_email ?? '',
    });
    setError('');
  }, [open, profile]);

  const displayName = (isPet ? [firstName, lastName] : [title, firstName, middleName, lastName, suffix])
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['care-profile', profile.id] });

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(
        `/care-profiles/${profile.id}`,
        isPet
          ? {
              first_name: firstName.trim(),
              last_name: lastName.trim() || null,
              preferred_name: preferredName.trim() || null,
              date_of_birth: dob || null,
              pronouns: pronouns.trim() || null,
              species: species || null,
              breed: breed.trim() || null,
              desexed,
              microchip_number: microchip.trim() || null,
              notes: notes.trim() || null,
              ...contactPayload(contact),
            }
          : {
              title: title.trim() || null,
              first_name: firstName.trim(),
              middle_name: middleName.trim() || null,
              last_name: lastName.trim() || null,
              suffix: suffix.trim() || null,
              preferred_name: preferredName.trim() || null,
              date_of_birth: dob || null,
              pronouns: pronouns.trim() || null,
              ...contactPayload(contact),
            }
      ),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  const photoMutation = useMutation({
    mutationFn: (blob: Blob) => {
      const form = new FormData();
      form.append('photo', blob, 'photo.png');
      return api.upload(`/care-profiles/${profile.id}/photo`, form);
    },
    onSuccess: () => {
      setPhotoOpen(false);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['pinned-profiles'] });
    },
    onError: (err) => setPhotoError(err instanceof Error ? err.message : 'Upload failed'),
  });

  const colorMutation = useMutation({
    mutationFn: async (hex: string) => {
      if (profile.photo_url) await api.delete(`/care-profiles/${profile.id}/photo`);
      await api.patch(`/care-profiles/${profile.id}`, { photo_color: hex });
    },
    onSuccess: () => {
      setPhotoOpen(false);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['pinned-profiles'] });
    },
    onError: (err) => setPhotoError(err instanceof Error ? err.message : 'Failed to save colour'),
  });

  const removePhotoMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profile.id}/photo`),
    onSuccess: () => {
      setPhotoOpen(false);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={isPet ? 'Edit pet' : 'Edit profile'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="flex items-center gap-4">
          <Avatar
            accountId={profile.id}
            name={profile.full_name}
            avatarUrl={profile.photo_url}
            color={profile.photo_color}
            fetchPath={`/care-profiles/${profile.id}/photo`}
            size={64}
          />
          <div>
            <Button type="button" size="sm" variant="secondary" onClick={() => { setPhotoError(''); setPhotoOpen(true); }}>
              Edit photo
            </Button>
            {photoError ? <p className="mt-1 text-xs text-red-600">{photoError}</p> : null}
          </div>
        </div>

        {isPet ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              <Input label="Family name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <Input label="Known as" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} />
            {displayName ? (
              <p className="text-xs text-muted">
                Shown across the app as <span className="font-medium text-ink">{displayName}</span>
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="edit-pet-species" className="block text-sm font-medium text-ink mb-1">
                  Species
                </label>
                <select
                  id="edit-pet-species"
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
              <Input label="Date of birth" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              <Input label="Pronouns" value={pronouns} onChange={(e) => setPronouns(e.target.value)} placeholder="e.g. she/her" />
            </div>
            <Input label="Microchip number" value={microchip} onChange={(e) => setMicrochip(e.target.value)} />
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
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
              <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dr" />
              <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Middle name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
              <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <Input label="Suffix" value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="e.g. OAM, Jr" />
            {displayName ? (
              <p className="text-xs text-muted">
                Shown across the app as <span className="font-medium text-ink">{displayName}</span>
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Preferred name" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} />
              <Input label="Date of birth" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
            <Input label="Pronouns" value={pronouns} onChange={(e) => setPronouns(e.target.value)} placeholder="e.g. she/her" />
          </>
        )}
        <ContactDetails value={contact} onChange={setContact} />
        {isPet ? (
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saveMutation.isPending}>Save</Button>
        </div>
      </form>

      <AvatarEditor
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        accountId={profile.id}
        name={profile.full_name}
        avatarUrl={profile.photo_url}
        color={profile.photo_color}
        fetchPath={`/care-profiles/${profile.id}/photo`}
        onSavePhoto={(blob) => photoMutation.mutate(blob)}
        onSaveColor={(hex) => colorMutation.mutate(hex)}
        onRemovePhoto={() => removePhotoMutation.mutate()}
        saving={photoMutation.isPending || colorMutation.isPending || removePhotoMutation.isPending}
      />
    </Modal>
  );
}

