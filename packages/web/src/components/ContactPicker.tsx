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
}: {
  id: string;
  label?: string;
  profileId?: string;
  value: PickedContact;
  onChange: (next: PickedContact) => void;
  kind?: 'person' | 'organisation';
  placeholder?: string;
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
    enabled: open && !value.providerId && q.length >= 2,
  });
  const lower = q.toLowerCase();
  const linkedMatches = q ? linked.filter((p) => p.name.toLowerCase().includes(lower) || providerTypeLabel(p.provider_type).toLowerCase().includes(lower)) : linked;
  const others = (data?.providers ?? []).filter((p) => !linked.some((l) => l.id === p.id));
  const matches = [...linkedMatches, ...others].slice(0, 6);
  const offering = open && !value.providerId && matches.length > 0;
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
          onChange({ ...value, providerId: '', name: e.target.value });
        }}
        hint={
          value.providerId
            ? 'From Contacts.'
            : offering
              ? 'Already in Contacts? Pick them below.'
              : q
                ? 'New to Contacts. Filed there when you save.'
                : undefined
        }
      />
      {offering ? (
        <ul className="rounded-md border border-border bg-card divide-y divide-border">
          {matches.map((p) => (
            <li key={p.id}>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="w-full !justify-start text-left"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ providerId: p.id, name: p.name, providerType: p.provider_type, phone: '' });
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
      {!value.providerId && q ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ProviderTypeField
            id={`${id}-type`}
            label="What they do"
            value={value.providerType}
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
