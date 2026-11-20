import {  } from 'react';
import {  } from 'react-router-dom';
import {  } from '../../../../components/ui/icons';
import {  } from '../../../../components/CatalogueCombo';
import {  } from '../../../../components/ProseReport';
import {  } from '../../../../components/AllergyModal';
import {   
       
    type PlanVersionMeta } from '../../../../lib/care';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {  } from 'date-fns';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import { ContactPicker, emptyContact, type PickedContact } from '../../../../components/ContactPicker';
import { PersonPicker } from '../../../../components/PersonPicker';
import type { PickablePerson } from '../../../../lib/care';

export function InviteReviewerModal({
  profileId,
  version,
  onClose,
}: {
  profileId: string;
  version: PlanVersionMeta;
  onClose: () => void;
}) {
  // Picked rather than typed: their email is read from their own record.
  const [who, setWho] = useState<'contact' | 'circle' | 'other'>('contact');
  const [contact, setContact] = useState<PickedContact>(emptyContact);
  const [personKey, setPersonKey] = useState('');
  const [person, setPerson] = useState<PickablePerson | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [canApprove, setCanApprove] = useState(false);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const inviteMutation = useMutation({
    mutationFn: () =>
      api.post<{ review_path: string }>(`/care-profiles/${profileId}/plan/versions/${version.id}/reviews`, {
        ...(who === 'contact' && contact.providerId
          ? { provider_id: contact.providerId }
          : who === 'circle' && person && 'circle_member_id' in person.ref
            ? { circle_member_id: person.ref.circle_member_id }
            : who === 'circle' && person
              ? { invited_name: person.name, invited_email: person.email }
              : { invited_name: name.trim() || null, invited_email: email.trim() || null }),
        can_comment: true,
        can_approve: canApprove,
      }),
    onSuccess: (res) => setLink(`${window.location.origin}${res.review_path}`),
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not create the review link.'),
  });

  return (
    <Modal open onClose={onClose} title={`Invite a reviewer for version ${version.version}`}>
      <div className="space-y-4">
        {link ? (
          <>
            <p className="text-sm text-ink">Share this secure link. It expires after 14 days.</p>
            <div className="flex items-center gap-2">
              <Input aria-label="Review link" value={link} readOnly className="flex-1" />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted">
              The reviewer opens a secure link to read this version and leave a comment, without needing an
              account. Every view and response is recorded in the activity log.
            </p>
            <fieldset className="space-y-1 text-sm text-ink">
              <legend className="block text-sm font-medium text-ink mb-1">Who reviews it</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="reviewer-who" checked={who === 'contact'} onChange={() => setWho('contact')} />
                Someone in Contacts
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="reviewer-who" checked={who === 'circle'} onChange={() => setWho('circle')} />
                Someone in the care circle
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="reviewer-who" checked={who === 'other'} onChange={() => setWho('other')} />
                Someone else
              </label>
            </fieldset>
            {who === 'contact' ? (
              <ContactPicker id="reviewer-contact" label="Reviewer" profileId={profileId} value={contact} onChange={setContact} />
            ) : who === 'circle' ? (
              <PersonPicker
                id="reviewer-person"
                label="Reviewer"
                profileId={profileId}
                value={personKey}
                emptyLabel="Choose someone"
                onChange={(key, p) => {
                  setPersonKey(key);
                  setPerson(p);
                }}
              />
            ) : (
              <>
                <Input label="Reviewer name" value={name} onChange={(e) => setName(e.target.value)} />
                <Input label="Reviewer email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="Used to label their responses. The link itself is what grants access." />
              </>
            )}
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                checked={canApprove}
                onChange={(e) => setCanApprove(e.target.checked)}
              />
              Allow this reviewer to approve the version
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={inviteMutation.isPending}
                onClick={() => {
                  // Create always answers: say who is still to be chosen.
                  if (who === 'contact' && !contact.providerId) {
                    setError(contact.name.trim() ? 'Pick them from Contacts, or choose Someone else.' : 'Choose the reviewer from Contacts, then create the link.');
                    return;
                  }
                  if (who === 'circle' && !person) {
                    setError('Choose the reviewer from the care circle, then create the link.');
                    return;
                  }
                  setError('');
                  inviteMutation.mutate();
                }}
              >
                Create link
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Access control
