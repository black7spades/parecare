import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, ApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { browserTimeZone } from '../../lib/datetime';
import { AdministerModal } from './profile/medications/AdministerModal';
import { ALLERGY_CHIP, reactionWords, type MedicationRecord } from '../../lib/care';
import { CONTACT_LINK } from '../../components/ContactStrip';

interface RoundDose {
  profile_id: string;
  profile_name: string;
  preferred_name: string | null;
  room_number: string | null;
  allergies: Array<{ substance: string; reaction: string | null }>;
  medication_id: string;
  medication_name: string;
  dose: string | null;
  route: string | null;
  instructions: string | null;
  with_food: boolean;
  critical: boolean;
  time: string;
  scheduled_for: string;
  late: boolean;
}

type Done = { status: string; at: string; adminId: string | null };
const doseKey = (d: RoundDose) => `${d.medication_id}|${d.scheduled_for}`;
const DONE_WORDS: Record<string, string> = { given: 'Given', refused: 'Refused', not_in_stock: 'Not in stock', omitted: 'Skipped', held: 'Paused on advice', self_administered: 'Took it themselves', recorded: 'Recorded' };

/**
 * The medicine round: every dose due from two hours ago to two hours ahead,
 * across everyone you give medicines to, grouped by room. Each dose is one
 * tap: Given, Refused with why, Not in stock, or More for the full form.
 * Every tap can be undone.
 */
export function MedicineRoundPage() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const only = params.get('for');
  const tz = browserTimeZone();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['medicine-round'],
    queryFn: () => api.get<{ doses: RoundDose[] }>(`/medicine-round${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`),
  });
  const [done, setDone] = useState<Record<string, Done>>({});
  const [refusing, setRefusing] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const [more, setMore] = useState<{ dose: RoundDose; med: MedicationRecord } | null>(null);

  const all = data?.doses ?? [];
  const doses = only ? all.filter((d) => d.profile_id === only) : all;

  // Grouped by room, rooms in number order; anyone without a room after.
  const groups = useMemo(() => {
    const byPerson = new Map<string, RoundDose[]>();
    for (const d of doses) byPerson.set(d.profile_id, [...(byPerson.get(d.profile_id) ?? []), d]);
    return [...byPerson.values()].sort((a, b) => {
      const ra = a[0]!.room_number ?? '￿';
      const rb = b[0]!.room_number ?? '￿';
      return ra.localeCompare(rb, undefined, { numeric: true }) || a[0]!.profile_name.localeCompare(b[0]!.profile_name);
    });
  }, [doses]);

  const refresh = () => {
    for (const key of ['pare-attention', 'medicine-round-count', 'notifications']) void queryClient.invalidateQueries({ queryKey: [key] });
  };

  const record = useMutation({
    mutationFn: async (v: { dose: RoundDose; status: string; notes?: string }) => {
      const now = new Date();
      const res = await api.post<{ administration: { id: string } }>(`/care-profiles/${v.dose.profile_id}/medications/${v.dose.medication_id}/administrations`, {
        scheduled_for: v.dose.scheduled_for,
        administered_at: now.toISOString(),
        status: v.status,
        notes: v.notes ?? null,
        // Given as prescribed, by the person tapping it.
        right_dose: true,
        right_route: true,
        right_time: true,
      });
      return { id: res.administration.id, at: now.toISOString() };
    },
    onSuccess: (r, v) => {
      setDone((prev) => ({ ...prev, [doseKey(v.dose)]: { status: v.status, at: r.at, adminId: r.id } }));
      setRefusing(null);
      setWhy('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['med-chart', v.dose.profile_id] });
      refresh();
    },
    onError: (err, v) => {
      // Inside its limits: the full form says why and asks why it must be given now.
      if (err instanceof ApiError && err.code === 'OUTSIDE_LIMITS') {
        void openMore(v.dose);
        return;
      }
      setError({ key: doseKey(v.dose), text: err instanceof Error ? err.message : 'That dose was not recorded. Try again.' });
    },
  });

  const undo = useMutation({
    mutationFn: async (v: { dose: RoundDose; adminId: string }) => api.delete(`/care-profiles/${v.dose.profile_id}/medications/administrations/${v.adminId}`),
    onSuccess: (_r, v) => {
      setDone((prev) => {
        const next = { ...prev };
        delete next[doseKey(v.dose)];
        return next;
      });
      refresh();
    },
    onError: (err, v) => setError({ key: doseKey(v.dose), text: err instanceof Error ? err.message : 'That could not be undone. Try again.' }),
  });

  const openMore = async (d: RoundDose) => {
    try {
      const res = await api.get<{ medications: MedicationRecord[] }>(`/care-profiles/${d.profile_id}/medications`);
      const med = res.medications.find((m) => m.id === d.medication_id);
      if (med) setMore({ dose: d, med });
      else setError({ key: doseKey(d), text: 'That medicine is no longer on their list.' });
    } catch {
      setError({ key: doseKey(d), text: 'The full form could not be opened just now. Try again.' });
    }
  };

  const onlyName = only ? all.find((d) => d.profile_id === only)?.profile_name : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Medicine round</h1>
          <p className="text-xs text-muted">
            Doses due from two hours ago to two hours ahead{onlyName ? ` for ${onlyName}` : ', for everyone you give medicines to'}, by room.
          </p>
        </div>
        {only ? <Link to="/app/round" className={`${CONTACT_LINK} text-sm`}>Show everyone</Link> : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading the round.</p>
      ) : isError ? (
        <p className="text-sm text-red-600">The round could not be loaded just now. Try again in a moment.</p>
      ) : groups.length === 0 ? (
        <div className="card text-center py-10 space-y-2">
          <p className="text-sm text-ink">No doses due in the next two hours.</p>
          <p className="text-xs text-muted">As-needed doses are recorded from each person&apos;s Medication record.</p>
          <Link to="/app" className={`${CONTACT_LINK} text-sm`}>Back to the Homeboard</Link>
        </div>
      ) : (
        groups.map((list) => {
          const p = list[0]!;
          return (
            <section key={p.profile_id} className="card p-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">
                  {p.room_number ? `Room ${p.room_number} · ` : ''}
                  <Link to={`/app/${p.profile_id}/mar`} className={`${CONTACT_LINK}`}>{p.profile_name}</Link>
                </h2>
                {p.allergies.length ? (
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-xs font-medium text-red-700 dark:text-red-300">Allergic to</span>
                    {p.allergies.map((a, i) => (
                      <span key={i} className={ALLERGY_CHIP}><span className="font-semibold">{a.substance}</span>{reactionWords(a.reaction) ? <span>: {reactionWords(a.reaction)}</span> : null}</span>
                    ))}
                  </span>
                ) : (
                  <span className="rounded px-2 py-0.5 text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">Allergies not recorded yet</span>
                )}
              </div>
              <ul className="divide-y divide-border">
                {list.map((d) => {
                  const key = doseKey(d);
                  const did = done[key];
                  return (
                    <li key={key} className="px-4 py-3 space-y-2">
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink">
                            <span className={`font-medium ${d.late && !did ? 'text-red-700 dark:text-red-300' : ''}`}>{d.time}</span> {d.medication_name}
                            {d.dose ? <span className="text-muted"> {d.dose}</span> : null}
                            {d.route ? <span className="text-muted"> {d.route}</span> : null}
                          </p>
                          {d.with_food ? <p className="text-xs font-medium text-ink">Take with food</p> : null}
                          {d.instructions ? <p className="text-xs text-muted">{d.instructions}</p> : null}
                        </div>
                        {did ? (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-ink">{DONE_WORDS[did.status] ?? did.status} at {format(new Date(did.at), 'HH:mm')}.</span>
                            {did.status === 'not_in_stock' ? <span className="text-xs text-muted">The alert says who to call.</span> : null}
                            {did.adminId ? (
                              <Button size="xs" variant="ghost" loading={undo.isPending && undo.variables?.adminId === did.adminId} onClick={() => undo.mutate({ dose: d, adminId: did.adminId! })}>Undo</Button>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            <Button size="xs" variant="secondary" loading={record.isPending && record.variables?.dose === d && record.variables.status === 'given'} onClick={() => record.mutate({ dose: d, status: 'given' })}>Given</Button>
                            <Button size="xs" variant="secondary" onClick={() => { setRefusing(key); setWhy(''); setError(null); setTimeout(() => document.getElementById(`why-${key}`)?.focus(), 0); }}>Refused</Button>
                            <Button size="xs" variant="secondary" loading={record.isPending && record.variables?.dose === d && record.variables.status === 'not_in_stock'} onClick={() => record.mutate({ dose: d, status: 'not_in_stock' })}>Not in stock</Button>
                            <Button size="xs" variant="ghost" onClick={() => void openMore(d)}>More</Button>
                          </div>
                        )}
                      </div>
                      {refusing === key && !did ? (
                        <form
                          className="flex flex-wrap items-end gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!why.trim()) {
                              setError({ key, text: 'Say why they refused, e.g. Said she felt sick.' });
                              document.getElementById(`why-${key}`)?.focus();
                              return;
                            }
                            record.mutate({ dose: d, status: 'refused', notes: why.trim() });
                          }}
                        >
                          <div className="min-w-[14rem] flex-1">
                            <Input id={`why-${key}`} label="Why did they refuse?" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Said she felt sick" />
                          </div>
                          <Button type="submit" size="sm" variant="secondary" loading={record.isPending}>Save refused</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setRefusing(null)}>Cancel</Button>
                        </form>
                      ) : null}
                      {error?.key === key ? <p className="text-sm text-red-600" role="alert">{error.text}</p> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {more ? (
        <AdministerModal
          profileId={more.dose.profile_id}
          med={more.med}
          personName={more.dose.preferred_name ?? more.dose.profile_name}
          scheduledFor={more.dose.scheduled_for}
          maxWhen={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
          onClose={() => setMore(null)}
          onSaved={() => {
            setDone((prev) => ({ ...prev, [doseKey(more.dose)]: { status: 'recorded', at: new Date().toISOString(), adminId: null } }));
            setMore(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
