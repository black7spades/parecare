import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Input } from './ui/Input';
import { RELATIONSHIPS, type Provider } from '../lib/care';

/**
 * "Who should we contact about this person?" A conditional field set, so
 * each contact is captured as its own discrete facts:
 *  - Themselves: the person's own phone and email.
 *  - Someone already using PareCare: picked from the people this account
 *    already shares care with.
 *  - A new contact: their name, relationship, phone (home or mobile) and
 *    email. They can be invited to log in later.
 *  - A provider: e.g. the care home they live in. Reaching them means
 *    phoning the provider, whose details stand in for a personal number.
 */

export interface ContactValue {
  kind: '' | 'self' | 'user' | 'contact' | 'provider';
  account_id: string;
  provider_id: string;
  name: string;
  relationship: string;
  phone: string;
  phone_type: 'home' | 'mobile';
  email: string;
}

export const emptyContact: ContactValue = {
  kind: '',
  account_id: '',
  provider_id: '',
  name: '',
  relationship: '',
  phone: '',
  phone_type: 'mobile',
  email: '',
};

interface ContactableUser {
  id: string;
  display_name: string;
  email: string;
}

/** Turn the field set into the care-profile contact columns for the API. */
export function contactPayload(v: ContactValue): Record<string, string | null> {
  const base = {
    contact_kind: null as string | null,
    contact_account_id: null as string | null,
    contact_provider_id: null as string | null,
    contact_name: null as string | null,
    contact_relationship: null as string | null,
    contact_phone: null as string | null,
    contact_phone_type: null as string | null,
    contact_email: null as string | null,
  };
  if (v.kind === 'self') {
    return {
      ...base,
      contact_kind: 'self',
      contact_phone: v.phone.trim() || null,
      contact_phone_type: v.phone.trim() ? v.phone_type : null,
      contact_email: v.email.trim() || null,
    };
  }
  if (v.kind === 'user') {
    return { ...base, contact_kind: v.account_id ? 'user' : null, contact_account_id: v.account_id || null };
  }
  if (v.kind === 'provider') {
    return { ...base, contact_kind: v.provider_id ? 'provider' : null, contact_provider_id: v.provider_id || null };
  }
  if (v.kind === 'contact') {
    return {
      ...base,
      contact_kind: 'contact',
      contact_name: v.name.trim() || null,
      contact_relationship: v.relationship.trim() || null,
      contact_phone: v.phone.trim() || null,
      contact_phone_type: v.phone.trim() ? v.phone_type : null,
      contact_email: v.email.trim() || null,
    };
  }
  return base;
}

export function ContactDetails({
  value,
  onChange,
  providers = [],
}: {
  value: ContactValue;
  onChange: (v: ContactValue) => void;
  /** Providers linked to this profile, so one can stand in as the contact. */
  providers?: Provider[];
}) {
  const set = (patch: Partial<ContactValue>) => onChange({ ...value, ...patch });

  const { data } = useQuery({
    queryKey: ['contactable-users'],
    queryFn: () => api.get<{ users: ContactableUser[] }>('/care-profiles/contactable-users'),
    enabled: value.kind === 'user',
  });
  const users = data?.users ?? [];

  const inputClass =
    'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  const PhoneRow = (
    <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
      <Input label="Phone" value={value.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="e.g. 0400 000 000" />
      <div>
        <label htmlFor="contact-phone-type" className="block text-sm font-medium text-ink mb-1">
          Phone type
        </label>
        <select
          id="contact-phone-type"
          className={inputClass}
          value={value.phone_type}
          onChange={(e) => set({ phone_type: e.target.value as 'home' | 'mobile' })}
        >
          <option value="mobile">Mobile</option>
          <option value="home">Home</option>
        </select>
      </div>
    </div>
  );

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div>
        <label htmlFor="contact-kind" className="block text-sm font-medium text-ink mb-1">
          Contact details
        </label>
        <p className="text-xs text-muted mb-1">Who should the care circle contact about this person?</p>
        <select id="contact-kind" className={inputClass} value={value.kind} onChange={(e) => set({ kind: e.target.value as ContactValue['kind'] })}>
          <option value="">Choose later</option>
          <option value="self">Themselves</option>
          <option value="user">Someone already using PareCare</option>
          <option value="contact">A new contact</option>
          {providers.length > 0 ? <option value="provider">A provider, such as their care home</option> : null}
        </select>
      </div>

      {value.kind === 'provider' ? (
        <div>
          <label htmlFor="contact-provider" className="block text-sm font-medium text-ink mb-1">
            Provider
          </label>
          <select id="contact-provider" className={inputClass} value={value.provider_id} onChange={(e) => set({ provider_id: e.target.value })}>
            <option value="">Choose a provider</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted mt-1">Their phone and email will be used to reach this person.</p>
        </div>
      ) : null}

      {value.kind === 'self' ? (
        <>
          {PhoneRow}
          <Input label="Email" type="email" value={value.email} onChange={(e) => set({ email: e.target.value })} />
        </>
      ) : null}

      {value.kind === 'user' ? (
        <div>
          <label htmlFor="contact-user" className="block text-sm font-medium text-ink mb-1">
            Person
          </label>
          <select id="contact-user" className={inputClass} value={value.account_id} onChange={(e) => set({ account_id: e.target.value })}>
            <option value="">Choose a person</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name} ({u.email})
              </option>
            ))}
          </select>
          {users.length === 0 ? (
            <p className="text-xs text-muted mt-1">No one you share care with yet. Add a new contact instead, or invite them later.</p>
          ) : null}
        </div>
      ) : null}

      {value.kind === 'contact' ? (
        <>
          <Input label="Name" value={value.name} onChange={(e) => set({ name: e.target.value })} />
          <div>
            <label htmlFor="contact-relationship" className="block text-sm font-medium text-ink mb-1">
              Relationship to this person
            </label>
            <select
              id="contact-relationship"
              className={inputClass}
              value={value.relationship}
              onChange={(e) => set({ relationship: e.target.value })}
            >
              <option value="">Prefer not to say</option>
              {RELATIONSHIPS.filter((r) => r !== 'Myself').map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {PhoneRow}
          <Input label="Email" type="email" value={value.email} onChange={(e) => set({ email: e.target.value })} />
          <p className="text-xs text-muted">You can invite them to log in later from the care circle.</p>
        </>
      ) : null}
    </div>
  );
}
