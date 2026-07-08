import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { AvatarEditor } from '../../../components/ui/AvatarEditor';
import { Avatar } from '../../../components/ui/Avatar';
import type { CareProfile } from '../../../lib/care';

/** Edit the person-in-care's details and photo. Shown only to those with edit access. */
export function EditProfileModal({
  profile,
  open,
  onClose,
}: {
  profile: CareProfile;
  open: boolean;
  onClose: () => void;
}) {
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
    setError('');
  }, [open, profile]);

  const displayName = [title, firstName, middleName, lastName, suffix]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['care-profile', profile.id] });

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profile.id}`, {
        title: title.trim() || null,
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim() || null,
        suffix: suffix.trim() || null,
        preferred_name: preferredName.trim() || null,
        date_of_birth: dob || null,
        pronouns: pronouns.trim() || null,
        notes: notes.trim() || null,
      }),
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
    <Modal open={open} onClose={onClose} title="Edit profile">
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
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
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
