import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { providerTypeLabel, summaryFromProvider, type Provider } from '../lib/care';
import { ContactStrip } from './ContactStrip';
import { ProviderTypeField } from './ProviderFields';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

export interface PickedContact {
  /** Someone already in Contacts, or empty for a new name. */
  providerId: string;
  name: string;
  /** What they do, as stored: a built-in code or plain words. */
  providerType: string;
  /** Their phone, for a new name or one with no number yet. */
  phone: string;
  /** Chosen as a new contact with Add new, where the picker asks for that. */
  isNew?: boolean;
}

export const emptyContact: PickedContact = { providerId: '', name: '', providerType: '', phone: '' };

/**
 * Name who something is with: this person's contacts first, then anyone in
 * the account's directory, or a new name with what they do and their phone,
 * filed in Contacts when the form is saved. A picked contact shows their
 * number straight away.
 */
export function ContactPicker({
  id,
  label = 'Who with',
  profileId,
  value,
  onChange,
  kind,
  placeholder = 'Search Contacts or type a new name',
  hint,
  defaultType,
  confirmNew = false,
}: {
  id: string;
  label?: string;
  profileId?: string;
  value: PickedContact;
  onChange: (next: PickedContact) => void;
  kind?: 'person' | 'organisation';
  placeholder?: string;
  /** Said under the box when nothing more pressing is, e.g. "Who writes the script." */
  hint?: string;
  /** What a new name is filed as when "What they do" is left empty. */
  defaultType?: string;
  /**
   * Typing never files anyone on its own: the matches are offered first,
   * and only "Add ... as a new contact" makes a new one.
   */
  confirmNew?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = value.name.trim();
  const { data: linkedData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
    enabled: !!profileId,
  });
  const linked = linkedData?.providers ?? [];
  const { data } = useQuery({
    queryKey: ['provider-search', kind ?? 'any', q],
    queryFn: () => api.get<{ providers: Provider[] }>(`/providers/search?${kind ? `kind=${kind}&` : ''}q=${encodeURIComponent(q)}`),
    enabled: (open || confirmNew) && !value.providerId && q.length >= 2,
  });
  const lower = q.toLowerCase();
  const linkedMatches = q ? linked.filter((p) => p.name.toLowerCase().includes(lower) || providerTypeLabel(p.provider_type).toLowerCase().includes(lower)) : linked;
  // People they still see come first; anyone no longer seen is listed last,
  // under Past contacts.
  const current = linkedMatches.filter((p) => !p.ended_on);
  const past = linkedMatches.filter((p) => !!p.ended_on);
  const others = (data?.providers ?? []).filter((p) => !linked.some((l) => l.id === p.id));
  const matches = [...current, ...others, ...past].slice(0, 8);
  const firstPast = matches.findIndex((p) => !!p.ended_on);
  // Where a new contact must be chosen on purpose, the matches stay on show
  // until one is picked or Add new is chosen, so they are never missed.
  const offering = (open || (confirmNew && !!q)) && !value.providerId && !value.isNew && matches.length > 0;
  // A new name is only new once someone says so, where the picker asks.
  const newChosen = !confirmNew || !!value.isNew;
  const picked = value.providerId ? linked.find((p) => p.id === value.providerId) ?? (data?.providers ?? []).find((p) => p.id === value.providerId) : undefined;

  return (
    <div className="space-y-2">
      <Input
        id={id}
        label={label}
        placeholder={placeholder}
        value={value.name}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setOpen(true);
          onChange({ ...value, providerId: '', isNew: false, name: e.target.value });
        }}
        hint={
          value.providerId
            ? 'From Contacts.'
            : offering
              ? confirmNew
                ? 'Pick them below, or add them as a new contact.'
                : 'Already in Contacts? Pick them below.'
              : q && newChosen
                ? 'New to Contacts. Filed there when you save.'
                : q && confirmNew && matches.length > 0
                  ? 'Pick them below, or add them as a new contact.'
                  : q
                    ? 'Not in Contacts yet. Add them as a new contact to file them.'
                    : hint
        }
      />
      {offering ? (
        <ul className="rounded-md border border-border bg-card divide-y divide-border">
          {matches.map((p, i) => (
            <li key={p.id}>
              {i === firstPast ? <p className="px-3 pt-2 text-xs text-muted">Past contacts</p> : null}
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="w-full !justify-start text-left"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ providerId: p.id, name: p.name, providerType: p.provider_type, phone: '', isNew: false });
                  setOpen(false);
                }}
              >
                {p.name}
                <span className="ml-1 font-normal text-muted">
                  {providerTypeLabel(p.provider_type)}
                  {p.organisation ? `, ${p.organisation}` : ''}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.providerId && picked ? (
        <div className="rounded-md border border-border px-3 py-2">
          <ContactStrip contact={summaryFromProvider(picked)} size="compact" book={false} />
        </div>
      ) : null}
      {value.providerId && picked && !picked.phone ? (
        <Input id={`${id}-phone`} label="Their phone" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} placeholder="e.g. 03 9345 6677" />
      ) : null}
      {confirmNew && !value.providerId && q && !value.isNew ? (
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange({ ...value, providerId: '', isNew: true });
            setOpen(false);
          }}
        >
          Add {q} as a new contact
        </Button>
      ) : null}
      {!value.providerId && q && newChosen ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ProviderTypeField
            id={`${id}-type`}
            label="What they do"
            value={value.providerType || defaultType || ''}
            onChange={(providerType) => onChange({ ...value, providerType })}
          />
          <Input id={`${id}-phone`} label="Their phone" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} placeholder="e.g. 03 9345 6677" />
        </div>
      ) : null}
    </div>
  );
}

/** The fields a form sends for who it is with. */
export function contactPayload(v: PickedContact): { provider_id: string | null } | { provider_name: string; provider_type: string | null; provider_phone: string | null } {
  if (v.providerId) return { provider_id: v.providerId, ...(v.phone.trim() ? { provider_phone: v.phone.trim() } : {}) } as { provider_id: string };
  if (v.name.trim()) return { provider_name: v.name.trim(), provider_type: v.providerType.trim() || null, provider_phone: v.phone.trim() || null };
  return { provider_id: null };
}

/**
 * The same, for a record that names its contact under another word: a
 * medicine's prescriber, a condition's treating contact, a treatment's
 * practitioner. "prescriber" sends prescriber_provider_id, or
 * prescriber_name with prescriber_type and prescriber_phone.
 */
export function contactFieldsAs(prefix: string, v: PickedContact): Record<string, string | null> {
  if (v.providerId) return { [`${prefix}_provider_id`]: v.providerId, ...(v.phone.trim() ? { [`${prefix}_phone`]: v.phone.trim() } : {}) };
  if (v.name.trim()) {
    return { [`${prefix}_name`]: v.name.trim(), [`${prefix}_type`]: v.providerType.trim() || null, [`${prefix}_phone`]: v.phone.trim() || null };
  }
  return { [`${prefix}_provider_id`]: null };
}

/** A picked contact from a record's contact, ready to edit. */
export const pickedFrom = (c: { id: string | null; name: string } | null | undefined): PickedContact =>
  c && c.id ? { providerId: c.id, name: c.name, providerType: '', phone: '' } : emptyContact;

/**
 * The same, but only when it changed from what the record already had, so
 * saving an unrelated change never links a contact back that was removed
 * from the person's contacts.
 */
export function changedContactFieldsAs(prefix: string, before: PickedContact, now: PickedContact): Record<string, string | null> {
  const same = before.providerId === now.providerId && (now.providerId ? !now.phone.trim() : before.name.trim() === now.name.trim());
  return same ? {} : contactFieldsAs(prefix, now);
}
