import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Input } from './ui/Input';
import { ShareLinkBox, type ShareLink } from './ShareLinkBox';
import { usePickablePeople, personOption } from './PersonPicker';
import { providerTypeLabel, personKey, type Provider } from '../lib/care';

/**
 * Who to send something to, from one list: their contacts, the care circle
 * (you first), or someone else by email. A picked person with no email on
 * file is asked for it, and it is saved on their record for next time.
 */
export interface SendToValue {
  /** "p:<contact id>", "a:<account id>", "m:<circle member id>", "other", or empty. */
  key: string;
  /** Typed for someone with no email on file, or for someone else. */
  email: string;
  /** Someone else's name. */
  name: string;
}

export const emptySendTo: SendToValue = { key: '', email: '', name: '' };

const SELECT = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function useSendOptions(profileId: string) {
  const { data: providerData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
  });
  const { data: peopleData } = usePickablePeople(profileId);
  const contacts = (providerData?.providers ?? []).filter((p) => !p.ended_on);
  const people = peopleData?.people ?? [];
  return { contacts, people };
}

/** The email on file for the picked one, or null when there is none. */
export function sendToEmailOnFile(value: SendToValue, opts: ReturnType<typeof useSendOptions>): string | null {
  if (value.key.startsWith('p:')) return opts.contacts.find((c) => `p:${c.id}` === value.key)?.email?.trim() || null;
  if (value.key.startsWith('a:') || value.key.startsWith('m:')) return opts.people.find((p) => personKey(p.ref) === value.key)?.email?.trim() || null;
  return null;
}

/** The name of whoever is picked, for the sentence that says what is missing. */
export function sendToName(value: SendToValue, opts: ReturnType<typeof useSendOptions>): string {
  if (value.key.startsWith('p:')) return opts.contacts.find((c) => `p:${c.id}` === value.key)?.name ?? 'them';
  if (value.key.startsWith('a:') || value.key.startsWith('m:')) return opts.people.find((p) => personKey(p.ref) === value.key)?.name ?? 'them';
  return value.name.trim() || 'them';
}

/** What is still needed before it can be sent, in one sentence, or empty. */
export function sendToMissing(value: SendToValue, opts: ReturnType<typeof useSendOptions>): string {
  if (!value.key) return 'Choose who to send it to.';
  if (value.key === 'other') {
    if (!value.email.trim()) return 'Type the email to send it to.';
    return '';
  }
  if (!sendToEmailOnFile(value, opts) && !value.email.trim()) return `${sendToName(value, opts)} has no email on file. Type it in Their email.`;
  return '';
}

/** The "to" the send routes take. */
export function sendToPayload(value: SendToValue): Record<string, string> {
  const email = value.email.trim();
  if (value.key.startsWith('p:')) return { provider_id: value.key.slice(2), ...(email ? { email } : {}) };
  if (value.key.startsWith('m:')) return { circle_member_id: value.key.slice(2), ...(email ? { email } : {}) };
  if (value.key.startsWith('a:')) return { account_id: value.key.slice(2) };
  return { email, ...(value.name.trim() ? { name: value.name.trim() } : {}) };
}

export function SendToPicker({ id, profileId, value, onChange }: { id: string; profileId: string; value: SendToValue; onChange: (v: SendToValue) => void }) {
  const opts = useSendOptions(profileId);
  const onFile = sendToEmailOnFile(value, opts);
  const picked = value.key && value.key !== 'other';
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">Send to</label>
        <select id={id} className={SELECT} value={value.key} onChange={(e) => onChange({ key: e.target.value, email: '', name: '' })}>
          <option value="">Choose who</option>
          {opts.contacts.length ? (
            <optgroup label="Their contacts">
              {opts.contacts.map((c) => (
                <option key={c.id} value={`p:${c.id}`}>
                  {c.name}
                  {c.provider_type && c.provider_type !== 'other' ? `, ${providerTypeLabel(c.provider_type)}` : ''}
                </option>
              ))}
            </optgroup>
          ) : null}
          {opts.people.length ? (
            <optgroup label="Care circle">
              {opts.people.map((p) => (
                <option key={personKey(p.ref)} value={personKey(p.ref)}>{personOption(p)}</option>
              ))}
            </optgroup>
          ) : null}
          <option value="other">Someone else, by email</option>
        </select>
        {picked && onFile ? <p className="mt-1 text-xs text-muted">Goes to {onFile}</p> : null}
      </div>
      {picked && !onFile ? (
        <Input
          label="Their email"
          type="email"
          value={value.email}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
          hint="Saved on their record, so it is there next time."
        />
      ) : null}
      {value.key === 'other' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Their name" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="e.g. Reception at Epworth" />
          <Input label="Their email" type="email" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} placeholder="name@clinic.com.au" />
        </div>
      ) : null}
    </div>
  );
}

/** What a send says back: sent, or the link to send another way. */
export interface SendResult {
  sent: boolean;
  link: ShareLink;
  recipient: { name: string; email: string };
}

export function SendDone({ result, what }: { result: SendResult; what: string }) {
  if (result.sent) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink" role="status">Sent to {result.recipient.name}.</p>
        <p className="text-xs text-muted">The link opens without logging in, for 30 days. It is here too, to send another way:</p>
        <ShareLinkBox url={result.link.url} primary={false} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink" role="status">
        Email is not set up on this PareCare, so nothing was emailed. Copy the link and send it to {result.recipient.name} in a message or your own email. It opens {what} without logging in, for 30 days.
      </p>
      <ShareLinkBox url={result.link.url} />
    </div>
  );
}
