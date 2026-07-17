import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { POA_TYPES, PROVIDER_TYPES, providerTypeLabel, type CircleMember, type Provider } from '../lib/care';

/**
 * The one way a power of attorney holder is named, wherever the need
 * arises: inline on the overview card, in a modal on the emergency sheet,
 * or anywhere else the fact is shown. Holders are people already in the
 * care circle or organisations, which can be added right here; the form
 * writes to the existing circle and provider records.
 */
export function SetPoaForm({
  profileId,
  compact = false,
  onSaved,
}: {
  profileId: string;
  /** Starts as a small "Name another" affordance instead of the full form. */
  compact?: boolean;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [holder, setHolder] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState('legal');
  const [poaType, setPoaType] = useState<string>(POA_TYPES[0].value);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(!compact);

  const { data: circleData } = useQuery({
    queryKey: ['circle', profileId],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profileId}/circle`),
  });
  const { data: providersData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
  });
  const members = circleData?.members ?? [];
  const providers = providersData?.providers ?? [];

  const mutation = useMutation({
    mutationFn: async () => {
      let path: string;
      let id: string;
      if (holder === 'neworg') {
        const created = await api.post<{ provider: Provider }>(`/care-profiles/${profileId}/providers`, {
          provider_type: orgType,
          name: orgName.trim(),
        });
        path = 'providers';
        id = created.provider.id;
      } else {
        const [source, holderId] = holder.split(':');
        path = source === 'provider' ? 'providers' : 'circle';
        id = holderId;
      }
      return api.patch(`/care-profiles/${profileId}/${path}/${id}`, { poa_type: poaType });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['circle', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });
      setHolder('');
      setOrgName('');
      setError('');
      if (compact) setExpanded(false);
      onSaved?.();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not set the power of attorney.'),
  });

  const ready = holder === 'neworg' ? orgName.trim().length > 0 : !!holder;

  if (compact && !expanded) {
    return (
      <Button type="button" variant="ghost" size="xs" onClick={() => setExpanded(true)}>
        Name another
      </Button>
    );
  }

  const selectClass =
    'rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="space-y-2">
      {!compact ? (
        <p className="text-sm text-muted">No power of attorney recorded yet. Name whoever holds it:</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Who</span>
          <select
            aria-label="Who holds power of attorney"
            className={selectClass}
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
          >
            <option value="">Choose a person or organisation</option>
            {members.length > 0 ? (
              <optgroup label="People in the care circle">
                {members.map((m) => (
                  <option key={m.id} value={`member:${m.id}`}>
                    {m.display_name}
                    {m.relationship ? ` — ${m.relationship}` : ''}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {providers.length > 0 ? (
              <optgroup label="Organisations">
                {providers.map((p) => (
                  <option key={p.id} value={`provider:${p.id}`}>
                    {p.name} — {providerTypeLabel(p.provider_type)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <option value="neworg">An organisation not listed yet</option>
          </select>
        </label>
        {holder === 'neworg' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Organisation name</span>
              <Input
                aria-label="Organisation name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Smith and Co Lawyers"
                className="w-52"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Kind of organisation</span>
              <select aria-label="Kind of organisation" className={selectClass} value={orgType} onChange={(e) => setOrgType(e.target.value)}>
                {PROVIDER_TYPES.filter((t) => t.value !== 'gp').map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Kind of authority</span>
          <select
            aria-label="Kind of power of attorney"
            className={selectClass}
            value={poaType}
            onChange={(e) => setPoaType(e.target.value)}
          >
            {POA_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" disabled={!ready || mutation.isPending} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Set
        </Button>
        {compact ? (
          <Button type="button" variant="ghost" onClick={() => setExpanded(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
      {members.length === 0 ? (
        <p className="text-xs text-muted">
          To name a person, first{' '}
          <Link to={`/app/${profileId}/circle`} className="text-primary hover:underline">
            invite them to the care circle
          </Link>
          . Organisations can be added right here.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
