import { Fragment, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ContactSummary } from '../lib/care';
import { findPersonWithPhone, findPhones, phoneDigits, splitLinkedText } from '../lib/phoneText';
import { refreshContacts, useNoticeStore } from '../stores/notice';
import { Button } from './ui/Button';
import { CONTACT_LINK } from './ContactStrip';

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * Any free text with its phone numbers, email addresses and web links made
 * tappable. When the record's contact has no phone and the text holds one,
 * it offers to save it on them; when the text names someone with a number
 * and the record has no contact, it offers to add them to Contacts.
 */
export function LinkedText({
  text,
  profileId,
  contact,
  context = '',
  canEdit = true,
  onLinkContact,
}: {
  text: string;
  profileId?: string;
  /** The record's contact, if it has one. */
  contact?: ContactSummary | null;
  /** More words that say what kind of person they are, such as a task's title. */
  context?: string;
  canEdit?: boolean;
  /** Link a contact just added from the text to this record. */
  onLinkContact?: (providerId: string) => unknown;
}) {
  const queryClient = useQueryClient();
  const notice = useNoticeStore((s) => s.show);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const parts = splitLinkedText(text);
  const phones = findPhones(text);
  const onlyPhone = phones.length === 1 ? phones[0]!.text : null;
  const offerSave = canEdit && !!profileId && !!contact && contact.source === 'contact' && !!contact.id && !contact.phone && !!onlyPhone;
  const person = !contact && canEdit && profileId ? findPersonWithPhone(text, context) : null;

  const savePhone = useMutation({
    mutationFn: () => api.patch(`/care-profiles/${profileId}/providers/${contact!.id}`, { phone: onlyPhone }),
    onSuccess: () => {
      notice({ message: `Saved. ${contact!.name}'s number is ${onlyPhone}.` });
      refreshContacts(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['appointments', profileId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The number did not save. Try again in a moment.'),
  });

  const addContact = useMutation({
    mutationFn: async () => {
      // Already in their Contacts: link them rather than file them twice.
      const linked = await queryClient.fetchQuery({
        queryKey: ['providers', profileId],
        queryFn: () => api.get<{ providers: Array<{ id: string; name: string }> }>(`/care-profiles/${profileId}/providers`),
      });
      const bare = (n: string) => n.toLowerCase().replace(/^(dr|prof|mr|mrs|ms|mx)\.?\s+/, '').replace(/\s+/g, ' ').trim();
      const known = linked.providers.find((p) => bare(p.name) === bare(person!.name));
      if (known) {
        if (onLinkContact) await onLinkContact(known.id);
        return known;
      }
      const res = await api.post<{ provider: { id: string; name: string } }>(`/care-profiles/${profileId}/providers`, {
        name: person!.name,
        provider_type: person!.type ?? 'specialist',
        phone: person!.phone,
        kind: 'person',
      });
      if (onLinkContact) await onLinkContact(res.provider.id);
      return res.provider;
    },
    onSuccess: (p) => {
      setAdded(onLinkContact ? `${p.name} is in Contacts and linked here.` : `${p.name} is in Contacts.`);
      refreshContacts(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'They were not added. Try again in a moment.'),
  });

  return (
    <span className="block">
      <span className="whitespace-pre-wrap break-words">
        {parts.map((p, i) => (
          <Fragment key={i}>
            {p.kind === 'phone' ? (
              <>
                <a href={telHref(p.text)} className={CONTACT_LINK} aria-label={`Call ${p.text}`}>{p.text}</a>
                {offerSave && phoneDigits(p.text) === phoneDigits(onlyPhone!) ? (
                  <Button size="xs" variant="ghost" className="ml-1" loading={savePhone.isPending} onClick={() => savePhone.mutate()}>
                    Save as {contact!.name}'s number
                  </Button>
                ) : null}
              </>
            ) : p.kind === 'email' ? (
              <a href={`mailto:${p.text}`} className={CONTACT_LINK}>{p.text}</a>
            ) : p.kind === 'url' ? (
              <a href={p.text} target="_blank" rel="noopener noreferrer" className={`${CONTACT_LINK} break-all`}>{p.text}</a>
            ) : (
              p.text
            )}
          </Fragment>
        ))}
      </span>
      {person && !added ? (
        <span className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <span className="text-xs text-muted">The notes mention {person.name}, {person.phone}.</span>
          <Button size="xs" variant="secondary" loading={addContact.isPending} onClick={() => addContact.mutate()}>
            Add {person.name} to Contacts
          </Button>
        </span>
      ) : null}
      {added ? <span className="mt-1 block text-xs text-muted">{added}</span> : null}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
