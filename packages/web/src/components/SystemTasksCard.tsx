import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { Button } from './ui/Button';
import { CONTACT_LINK } from './ContactStrip';
import { formatDateOnly } from '../lib/datetime';

interface AdminCountryState {
  country: { code: string; name: string };
  confirmed: boolean;
  guessed: string;
  choices: Array<{ code: string; name: string }>;
  check: { title: string; due_on: string; due: boolean; last_done_on: string | null };
}

/**
 * The country this browser's clock is set to. A clock says more than a
 * language: many browsers in Australia are set to US English.
 */
function browserCountry(codes: string[]): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    const pick = (c: string) => (codes.includes(c) ? c : null);
    if (/^Australia\//.test(zone)) return pick('AU');
    if (/^Pacific\/(Auckland|Chatham)/.test(zone)) return pick('NZ');
    if (/^Europe\/(London|Belfast)/.test(zone)) return pick('GB');
    if (/^Europe\/Dublin/.test(zone)) return pick('IE');
    if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal)/.test(zone)) return pick('CA');
    if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit)|^Pacific\/Honolulu/.test(zone)) return pick('US');
  } catch {
    // No clock to go on: the server's guess stands.
  }
  return null;
}

const SELECT =
  'block w-full max-w-xs rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * Jobs for whoever runs PareCare, on their home page: at first run, which
 * country it is used in (worked out from the server and this browser, so it
 * is one tap to confirm); and once a year, checking the national services
 * are still right. Nothing shows when there is nothing to do.
 */
export function SystemTasksCard() {
  const role = useAuthStore((s) => s.account?.role);
  // Whoever runs PareCare: the country also sets the currency, which only a super admin changes.
  const isAdmin = role === 'super_admin';
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['system-tasks'],
    queryFn: () => api.get<AdminCountryState>('/admin/country'),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!data || choice) return;
    // This browser's clock wins over the server's guess at first run.
    setChoice(data.confirmed ? data.country.code : browserCountry(data.choices.map((c) => c.code)) ?? data.country.code);
  }, [data, choice]);

  const confirm = useMutation({
    mutationFn: () => api.put<AdminCountryState>('/admin/country', { country: choice }),
    onSuccess: (next) => {
      queryClient.setQueryData(['system-tasks'], next);
      void queryClient.invalidateQueries({ queryKey: ['country'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-country'] });
      setNote(`Saved. PareCare is set to ${next.country.name}.`);
    },
    onError: (err) => setNote(err instanceof Error ? err.message : 'That did not save. Try again in a moment.'),
  });

  if (!isAdmin || !data) return null;
  const askCountry = !data.confirmed;
  const checkDue = data.check.due;
  if (!askCountry && !checkDue && !note) return null;

  return (
    <section className="card space-y-3" aria-label="Jobs for whoever runs PareCare">
      {askCountry || note ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">Which country is PareCare used in?</h2>
          {askCountry ? (
            <>
              <p className="text-sm text-ink">
                It sets the services people are sent to, the ID numbers asked for, the funding schemes and how dates are written. This was worked out from the server and this browser.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="first-run-country" className="block text-sm font-medium text-ink mb-1">Country</label>
                  <select id="first-run-country" className={SELECT} value={choice} onChange={(e) => setChoice(e.target.value)}>
                    {data.choices.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <Button variant="secondary" loading={confirm.isPending} onClick={() => confirm.mutate()}>
                  Use this country
                </Button>
              </div>
            </>
          ) : null}
          {note ? <p className="text-sm text-muted" role="status">{note}</p> : null}
        </div>
      ) : null}
      {checkDue ? (
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-ink">{data.check.title}</h2>
          <p className="text-sm text-ink">
            Due {formatDateOnly(data.check.due_on)}. Once a year, check the national services PareCare sends people to still have the right names, numbers and websites.
          </p>
          <p className="text-sm">
            <Link to="/system/country" className={CONTACT_LINK}>Check the services</Link>
          </p>
        </div>
      ) : null}
    </section>
  );
}
