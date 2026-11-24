import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { ServicesTable } from '../../components/ServicesTable';
import { CONTACT_LINK } from '../../components/ContactStrip';
import { formatDateOnly } from '../../lib/datetime';
import { usePareOn } from '../../lib/aiStatus';
import type { Service } from '../../lib/country';

interface AdminCountryState {
  country: { code: string; name: string };
  confirmed: boolean;
  guessed: string;
  choices: Array<{ code: string; name: string }>;
  services: Service[];
  check: { title: string; due_on: string; due: boolean; last_done_on: string | null };
}

interface Proposal {
  kind: string;
  name: string | null;
  phone: string | null;
  website: string | null;
  why: string;
}

const SELECT =
  'block w-full max-w-xs rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * Country and services, for whoever runs PareCare: which country it is
 * used in, the national services everyone is sent to there, and the yearly
 * check that they are still right.
 */
export function AdminCountry() {
  const queryClient = useQueryClient();
  const pareOn = usePareOn();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-country'],
    queryFn: () => api.get<AdminCountryState>('/admin/country'),
  });
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [lookError, setLookError] = useState('');

  useEffect(() => {
    if (data && !choice) setChoice(data.country.code);
  }, [data, choice]);

  const changed = (next: AdminCountryState) => {
    queryClient.setQueryData(['admin-country'], next);
    // Everything that speaks the country's words reads it again.
    void queryClient.invalidateQueries({ queryKey: ['country'] });
    void queryClient.invalidateQueries({ queryKey: ['system-tasks'] });
  };

  const saveCountry = useMutation({
    mutationFn: () => api.put<AdminCountryState>('/admin/country', { country: choice }),
    onSuccess: (next) => {
      changed(next);
      setProposals(null);
      setNote(`PareCare is set to ${next.country.name}. Journeys, the emergency sheet, ID numbers, funding and yearly checks now follow it.`);
    },
    onError: (err) => setNote(err instanceof Error ? err.message : 'The country did not save. Try again in a moment.'),
  });

  const finish = useMutation({
    mutationFn: () => api.post<AdminCountryState>('/admin/country/check/done'),
    onSuccess: (next) => {
      changed(next);
      setProposals(null);
      setNote(`Done. The next check is due ${formatDateOnly(next.check.due_on)}.`);
    },
  });

  const lookUp = useMutation({
    mutationFn: () => api.post<{ proposals: Proposal[] }>('/admin/country/check/look-up'),
    onSuccess: (res) => {
      setLookError('');
      setProposals(res.proposals);
    },
    onError: (err) => setLookError(err instanceof Error ? err.message : 'Pare could not check just now. Check each website in the list instead.'),
  });

  const accept = useMutation({
    mutationFn: (p: Proposal) => api.put<AdminCountryState>(`/admin/country/services/${encodeURIComponent(p.kind)}`, { name: p.name, phone: p.phone, website: p.website }),
    onSuccess: (next, p) => {
      changed(next);
      setProposals((list) => (list ?? []).filter((x) => x.kind !== p.kind));
    },
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (isError || !data) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600" role="alert">The country and services could not be loaded just now. Check the connection and try again.</p>
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }

  const labelOf = (kind: string) => data.services.find((s) => s.kind === kind)?.label ?? 'Service';
  const now = (kind: string) => data.services.find((s) => s.kind === kind);

  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-ink">Country</h2>
        <p className="text-sm text-ink">
          The country PareCare is used in sets the services people are sent to, the ID numbers asked for, the funding schemes, the yearly checks and how dates are written.
        </p>
        {!data.confirmed ? (
          <p className="text-sm text-ink">PareCare worked this out from the server's clock. Check it is right, then save.</p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="system-country" className="block text-sm font-medium text-ink mb-1">Country</label>
            <select id="system-country" className={SELECT} value={choice} onChange={(e) => setChoice(e.target.value)}>
              {data.choices.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
          <Button variant="secondary" loading={saveCountry.isPending} onClick={() => saveCountry.mutate()}>
            Save country
          </Button>
        </div>
        <p className="text-xs text-muted">An account set up somewhere else can pick its own country in its account settings.</p>
        {note ? <p className="text-sm text-muted" role="status">{note}</p> : null}
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-ink">{data.check.title}</h2>
        <p className="text-sm text-ink">
          {data.check.due ? 'Due now. ' : `Next due ${formatDateOnly(data.check.due_on)}. `}
          Once a year, check each service below still has the right name, phone and website. Services do change their numbers.
        </p>
        {data.check.last_done_on ? <p className="text-xs text-muted">Last done {formatDateOnly(data.check.last_done_on)}.</p> : null}
        {pareOn ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" loading={lookUp.isPending} onClick={() => lookUp.mutate()}>
                Check current services
              </Button>
              <span className="text-xs text-muted">Pare suggests changes one at a time. Nothing changes until you use one.</span>
            </div>
            {lookError ? <p className="text-sm text-red-600" role="alert">{lookError}</p> : null}
            {proposals && proposals.length === 0 ? <p className="text-sm text-muted" role="status">Pare found nothing to change.</p> : null}
            {proposals && proposals.length > 0 ? (
              <ul className="space-y-2">
                {proposals.map((p) => {
                  const was = now(p.kind);
                  return (
                    <li key={p.kind} className="rounded-md border border-border p-3 space-y-1">
                      <p className="text-sm font-semibold text-ink">{labelOf(p.kind)}</p>
                      <p className="text-sm text-ink">{p.why}</p>
                      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr_1fr]">
                        <dt className="text-xs text-muted sm:col-start-2">Now</dt>
                        <dt className="text-xs text-muted">Pare suggests</dt>
                        <dt className="text-xs text-muted sm:col-start-1">Name</dt>
                        <dd className="text-ink">{was?.name ?? '-'}</dd>
                        <dd className="text-ink">{p.name ?? '-'}</dd>
                        <dt className="text-xs text-muted">Phone</dt>
                        <dd className="text-ink">{was?.phone ?? '-'}</dd>
                        <dd className="text-ink">{p.phone ?? '-'}</dd>
                        <dt className="text-xs text-muted">Website</dt>
                        <dd className="text-ink break-all">{was?.website ?? '-'}</dd>
                        <dd className="text-ink break-all">
                          {p.website ? <a href={p.website} target="_blank" rel="noopener noreferrer" className={CONTACT_LINK}>{p.website}</a> : '-'}
                        </dd>
                      </dl>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="xs" variant="secondary" loading={accept.isPending && accept.variables?.kind === p.kind} onClick={() => accept.mutate(p)}>
                          Use these details
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setProposals((list) => (list ?? []).filter((x) => x.kind !== p.kind))}>
                          Dismiss
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-ink">Open each website in the list below and check the name and number on it. Edit any that have changed.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button loading={finish.isPending} onClick={() => finish.mutate()}>
            Done checking
          </Button>
          <span className="text-xs text-muted">Every service counts as checked today, and the next check is set for a year from now.</span>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Services in {data.country.name}</h2>
        <p className="text-sm text-ink">Journey steps and the emergency sheet use these. A change here shows everywhere they are used, for everyone.</p>
        <ServicesTable
          services={data.services}
          basePath="/admin/country"
          everyone
          onChanged={() => {
            void refetch();
            void queryClient.invalidateQueries({ queryKey: ['country'] });
          }}
        />
      </section>
    </div>
  );
}
