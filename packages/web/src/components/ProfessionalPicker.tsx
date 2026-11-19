import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { providerTypeLabel, type Provider } from '../lib/care';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

export interface PickedProfessional {
  /** Someone already in Contacts, or empty for a new name. */
  providerId: string;
  name: string;
  /** What they do, as stored: a built-in code or plain words. */
  providerType: string;
}

/**
 * Name a professional: type and pick someone already in Contacts, or keep
 * typing a new name, which is filed in Contacts when the form is saved. Used
 * for who a referral is to, so nobody is ever entered twice.
 */
export function ProfessionalPicker({
  id,
  label,
  value,
  onChange,
  placeholder = 'e.g. Dr Patel',
}: {
  id: string;
  label: string;
  value: PickedProfessional;
  onChange: (next: PickedProfessional) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = value.name.trim();
  const { data } = useQuery({
    queryKey: ['provider-search', 'person', q],
    queryFn: () => api.get<{ providers: Provider[] }>(`/providers/search?kind=person&q=${encodeURIComponent(q)}`),
    enabled: open && !value.providerId && q.length >= 2,
  });
  const matches = (data?.providers ?? []).slice(0, 5);
  const offering = open && !value.providerId && matches.length > 0;

  return (
    <div>
      <Input
        id={id}
        label={label}
        placeholder={placeholder}
        value={value.name}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setOpen(true);
          onChange({ providerId: '', name: e.target.value, providerType: value.providerType });
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
        <ul className="mt-1 rounded-md border border-border bg-card divide-y divide-border">
          {matches.map((p) => (
            <li key={p.id}>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="w-full !justify-start text-left"
                onClick={() => {
                  onChange({ providerId: p.id, name: p.name, providerType: p.provider_type });
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
    </div>
  );
}
