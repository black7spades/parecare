import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfDay, endOfMonth, endOfWeek,
  format, isSameDay, startOfDay, startOfMonth, startOfWeek, subMonths,
} from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { MED_STATUSES, medStatusDescription, type MedicationRecord, type MedicationAdministration } from '../../../lib/care';
import { C64_PALETTE, contrastText } from '../../../components/ui/Avatar';
import { AdministerModal } from './MedicationsPage';

const SELECT = 'rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

type Period = 'day' | 'week' | 'month';

interface ChartAdmin {
  id: string;
  medication_id: string;
  scheduled_for: string | null;
  administered_at: string;
  status: string;
  notes: string | null;
}

// Dose-status colours drawn from the Commodore 64 palette (colodore).
const C64 = {
  green: C64_PALETTE[5],       // given
  lightGreen: C64_PALETTE[13], // self-administered
  orange: C64_PALETTE[8],      // refused
  red: C64_PALETTE[2],         // omitted
  yellow: C64_PALETTE[7],      // held
  lightRed: C64_PALETTE[10],   // missed
  lightGrey: C64_PALETTE[15],  // future / not due
} as const;

const STATUS_HEX: Record<string, string> = {
  given: C64.green,
  self_administered: C64.lightGreen,
  refused: C64.orange,
  omitted: C64.red,
  held: C64.yellow,
};

const statusColorFor = (s: string): string => STATUS_HEX[s] ?? C64_PALETTE[12];
const swatch = (hex: string) => ({ backgroundColor: hex, color: contrastText(hex) });
const statusLabel = (s: string) => MED_STATUSES.find((x) => x.value === s)?.label ?? s;

function Legend({ withPartial }: { withPartial?: boolean }) {
  const items: [string, string][] = [
    ['Given', C64.green],
    ...(withPartial ? [['Partly given', C64.yellow] as [string, string]] : []),
    ['Exception', C64.orange],
    ['Missed', C64.lightRed],
    ['None', C64.lightGrey],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {items.map(([label, hex]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: hex }} />{label}
        </span>
      ))}
    </div>
  );
}

export function MedicationMar({ profileId, personName, canAdminister }: { profileId: string; personName: string; canAdminister: boolean }) {
  const [tab, setTab] = useState<'chart' | 'log'>('chart');
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b border-border">
        <button type="button" onClick={() => setTab('chart')} className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === 'chart' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink'}`}>Chart</button>
        <button type="button" onClick={() => setTab('log')} className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === 'log' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink'}`}>Full record</button>
      </div>
      {tab === 'chart'
        ? <MarChart profileId={profileId} personName={personName} canAdminister={canAdminister} />
        : <MarLog profileId={profileId} />}
    </div>
  );
}

interface Entry { medication_id: string; scheduled_for?: string; administered_at: string; status: string }

function MarChart({ profileId, personName, canAdminister }: { profileId: string; personName: string; canAdminister: boolean }) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(() => new Date());
  const [recording, setRecording] = useState<{ med: MedicationRecord; slotISO?: string; whenLocal: string } | null>(null);

  const [from, to] = useMemo((): [Date, Date] => {
    if (period === 'day') return [startOfDay(anchor), endOfDay(anchor)];
    if (period === 'week') return [startOfWeek(anchor, { weekStartsOn: 1 }), endOfWeek(anchor, { weekStartsOn: 1 })];
    return [startOfMonth(anchor), endOfMonth(anchor)];
  }, [period, anchor]);

  const chartKey = ['med-chart', profileId, from.toISOString(), to.toISOString()];
  type ChartData = { medications: MedicationRecord[]; administrations: ChartAdmin[] };
  const { data } = useQuery({
    queryKey: chartKey,
    queryFn: () => api.get<ChartData>(`/care-profiles/${profileId}/medications/chart?from=${from.toISOString()}&to=${to.toISOString()}`),
  });
  const meds = data?.medications ?? [];
  const admins = data?.administrations ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['med-chart', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['med-log', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['medications', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-events', profileId] });
  };

  // Record one or more doses, updating the chart cache immediately so the cell
  // colours the instant you tap — no reload, no waiting on the network.
  const recordDose = useMutation({
    mutationFn: (entries: Entry[]) => api.post(`/care-profiles/${profileId}/medications/administrations/batch`, { entries }),
    onMutate: async (entries: Entry[]) => {
      await queryClient.cancelQueries({ queryKey: ['med-chart', profileId] });
      const prev = queryClient.getQueryData<ChartData>(chartKey);
      queryClient.setQueryData<ChartData>(chartKey, (old) => old ? {
        ...old,
        administrations: [
          ...old.administrations,
          ...entries.map((e, i) => ({
            id: `temp-${Date.now()}-${i}`, medication_id: e.medication_id,
            scheduled_for: e.scheduled_for ?? null, administered_at: e.administered_at,
            status: e.status, notes: null,
          })),
        ],
      } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev !== undefined) queryClient.setQueryData(chartKey, ctx.prev); },
    onSettled: () => invalidate(),
  });

  const now = new Date();
  const days = eachDayOfInterval({ start: from, end: to });

  // Adherence summary — only shows a denominator when there are scheduled doses.
  const summary = useMemo(() => {
    let expected = 0;
    for (const m of meds) for (const day of days) for (const t of m.schedule_times ?? []) {
      if (new Date(`${format(day, 'yyyy-MM-dd')}T${t}:00`) <= now) expected += 1;
    }
    const by: Record<string, number> = {};
    for (const a of admins) by[a.status] = (by[a.status] ?? 0) + 1;
    const given = (by['given'] ?? 0) + (by['self_administered'] ?? 0);
    const exceptions = (by['refused'] ?? 0) + (by['omitted'] ?? 0) + (by['held'] ?? 0);
    return { expected, given, exceptions, missed: expected > 0 ? Math.max(0, expected - admins.length) : 0 };
  }, [meds, admins, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const findAdmin = (medId: string, slotISO: string): ChartAdmin | undefined =>
    admins.find((a) => a.medication_id === medId && a.scheduled_for && new Date(a.scheduled_for).getTime() === new Date(slotISO).getTime());

  const label = period === 'day' ? format(anchor, 'EEEE d MMMM yyyy')
    : period === 'week' ? `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`
    : format(anchor, 'MMMM yyyy');
  const step = (dir: number) => setAnchor((a) => period === 'day' ? addDays(a, dir) : period === 'week' ? addWeeks(a, dir) : addMonths(a, dir));

  // The system runs on time: you can never move into the future, and you can
  // look back at most 12 months. Everything after "now" is locked.
  const backFloor = subMonths(startOfDay(new Date()), 12);
  const nextDisabled = to.getTime() >= now.getTime();
  const prevDisabled = from.getTime() <= backFloor.getTime();

  // Record a slot as given, dated to the slot itself so back-filled doses land
  // on the right day (not "now").
  const quick = (medId: string, scheduledFor: string) => {
    if (new Date(scheduledFor) > now) return; // never log a future dose
    recordDose.mutate([{ medication_id: medId, scheduled_for: scheduledFor, administered_at: scheduledFor, status: 'given' }]);
  };
  const logAllDue = () => {
    const dayStr = format(anchor, 'yyyy-MM-dd');
    const entries: Entry[] = [];
    for (const m of meds) for (const t of m.schedule_times ?? []) {
      const iso = new Date(`${dayStr}T${t}:00`).toISOString();
      if (new Date(iso) <= now && !findAdmin(m.id, iso)) entries.push({ medication_id: m.id, scheduled_for: iso, administered_at: iso, status: 'given' });
    }
    if (entries.length) recordDose.mutate(entries);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(['day', 'week', 'month'] as Period[]).map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} className={`px-3 py-1.5 text-sm capitalize ${period === p ? 'bg-primary text-white' : 'bg-card text-muted hover:text-ink'}`}>{p}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => step(-1)} disabled={prevDisabled} aria-label="Previous">←</Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(new Date())}>Today</Button>
          <Button size="sm" variant="secondary" onClick={() => step(1)} disabled={nextDisabled} aria-label="Next" title={nextDisabled ? 'You cannot log or view future dates' : undefined}>→</Button>
        </div>
      </div>
      <p className="text-sm font-medium text-ink">{label}</p>

      <div className="flex flex-wrap gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm">
        <span>
          <span className="font-semibold text-ink">{summary.given}</span>
          <span className="text-muted">{summary.expected > 0 ? `/${summary.expected} scheduled doses given` : ` dose${summary.given === 1 ? '' : 's'} given`}</span>
        </span>
        {summary.exceptions > 0 ? <span style={{ color: C64.orange }}>{summary.exceptions} exception{summary.exceptions === 1 ? '' : 's'}</span> : null}
        {summary.expected > 0 && summary.missed > 0 ? <span style={{ color: C64.red }}>{summary.missed} missed</span> : null}
        {summary.expected > 0 ? <span className="text-muted">· {Math.round((summary.given / summary.expected) * 100)}% adherence</span> : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend withPartial={period !== 'day'} />
        <Link to={`/app/${profileId}/calendar`} className="text-xs text-primary hover:underline">View on calendar →</Link>
      </div>

      {meds.length === 0 ? (
        <p className="text-sm text-muted py-6 text-center">No active medications to chart.</p>
      ) : period === 'day' ? (
        <DayGrid meds={meds} admins={admins} day={anchor} findAdmin={findAdmin} now={now} canAdminister={canAdminister}
          onQuick={quick} onLogAllDue={logAllDue}
          onLogDetail={(med, slotISO) => {
            const fallback = isSameDay(anchor, now) ? now : new Date(`${format(anchor, 'yyyy-MM-dd')}T12:00:00`);
            setRecording({ med, slotISO: slotISO ?? undefined, whenLocal: format(slotISO ? new Date(slotISO) : fallback, "yyyy-MM-dd'T'HH:mm") });
          }} />
      ) : (
        <MonthGrid meds={meds} days={days} admins={admins} now={now} onPickDay={(d) => { setPeriod('day'); setAnchor(d); }} />
      )}

      {recording ? (
        <AdministerModal
          profileId={profileId}
          med={recording.med}
          personName={personName}
          scheduledFor={recording.slotISO}
          initialWhen={recording.whenLocal}
          maxWhen={format(now, "yyyy-MM-dd'T'HH:mm")}
          onClose={() => setRecording(null)}
          onSaved={() => { setRecording(null); invalidate(); }}
        />
      ) : null}
    </div>
  );
}

// Per-medication day view: each row shows its scheduled slots (tap a due slot
// to log it "given" instantly) plus any doses recorded that day as coloured
// chips, and a "log" button for an ad-hoc or exception dose. Always renders,
// even for medications with no scheduled times.
function DayGrid({ meds, admins, day, findAdmin, now, canAdminister, onQuick, onLogAllDue, onLogDetail }: {
  meds: MedicationRecord[]; admins: ChartAdmin[]; day: Date; now: Date; canAdminister: boolean;
  findAdmin: (medId: string, slotISO: string) => ChartAdmin | undefined;
  onQuick: (medId: string, scheduledFor: string) => void;
  onLogAllDue: () => void;
  onLogDetail: (med: MedicationRecord, slotISO: string | null) => void;
}) {
  const dayStr = format(day, 'yyyy-MM-dd');
  const slotISO = (t: string) => new Date(`${dayStr}T${t}:00`).toISOString();
  const chipBase = 'inline-flex items-center gap-1 h-7 rounded px-2 text-xs font-medium';
  const anyDue = meds.some((m) => (m.schedule_times ?? []).some((t) => new Date(`${dayStr}T${t}:00`) <= now && !findAdmin(m.id, slotISO(t))));

  return (
    <div className="space-y-2">
      {canAdminister && anyDue ? (
        <div><Button size="sm" onClick={onLogAllDue}>Log all due doses</Button></div>
      ) : null}
      <div className="card divide-y divide-border p-0">
        {meds.map((m) => {
          const scheduled = (m.schedule_times ?? []).map((t) => ({ t, iso: slotISO(t) }));
          const usedIds = new Set(scheduled.map((s) => findAdmin(m.id, s.iso)?.id).filter(Boolean));
          const extras = admins.filter((a) => a.medication_id === m.id && !usedIds.has(a.id));
          return (
            <div key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-[9rem] mr-auto">
                <div className="font-medium text-ink text-sm">{m.name}</div>
                <div className="text-xs text-muted">{[m.dose, m.route].filter(Boolean).join(' · ')}</div>
              </div>
              {scheduled.map(({ t, iso }) => {
                const a = findAdmin(m.id, iso);
                const past = new Date(`${dayStr}T${t}:00`) <= now;
                if (a) return (
                  <span key={iso} data-testid={`slot-${m.id}-${t}`} title={`${t} — ${statusLabel(a.status)}${a.notes ? ` — ${a.notes}` : ''}`} style={swatch(statusColorFor(a.status))} className={chipBase}>
                    <span>{t}</span>{a.status === 'given' || a.status === 'self_administered' ? '✓' : statusLabel(a.status).slice(0, 3)}
                  </span>
                );
                // Future doses can't be logged yet; show them as upcoming.
                if (!canAdminister || !past) return (
                  <span key={iso} data-testid={`slot-${m.id}-${t}`} title={past ? t : `${t} — upcoming`} className="inline-flex items-center gap-1 h-7 rounded border border-dashed border-border px-2 text-xs text-muted">
                    <span>{t}</span>{!past ? <span className="text-[10px]">soon</span> : null}
                  </span>
                );
                return (
                  <button key={iso} type="button" data-testid={`slot-${m.id}-${t}`} onClick={() => onQuick(m.id, iso)}
                    style={{ borderColor: C64.lightRed, color: C64.lightRed }}
                    className="inline-flex items-center gap-1 h-7 rounded border border-dashed px-2 text-xs hover:bg-surface-2">
                    <span>{t}</span>due
                  </button>
                );
              })}
              {extras.map((a) => (
                <span key={a.id} data-testid={`dose-${m.id}`} title={`${statusLabel(a.status)}${a.notes ? ` — ${a.notes}` : ''}`} style={swatch(statusColorFor(a.status))} className={chipBase}>
                  <span>{format(new Date(a.administered_at), 'HH:mm')}</span>{a.status === 'given' || a.status === 'self_administered' ? '✓' : statusLabel(a.status).slice(0, 3)}
                </span>
              ))}
              {canAdminister ? (
                <button type="button" data-testid={`log-${m.id}`} onClick={() => onLogDetail(m, null)} className="inline-flex items-center h-7 rounded border border-border px-2 text-xs text-muted hover:bg-surface-2">＋ log</button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Adherence heatmap: rows = meds, columns = days in the week/month.
function MonthGrid({ meds, days, admins, now, onPickDay }: {
  meds: MedicationRecord[]; days: Date[]; admins: ChartAdmin[]; now: Date; onPickDay: (d: Date) => void;
}) {
  // Per medication+day: how many doses were given, and how many recorded at all.
  const byMedDay = useMemo(() => {
    const map = new Map<string, { given: number; any: number }>();
    for (const a of admins) {
      const key = `${a.medication_id}|${format(new Date(a.administered_at), 'yyyy-MM-dd')}`;
      const cur = map.get(key) ?? { given: 0, any: 0 };
      cur.any += 1;
      if (a.status === 'given' || a.status === 'self_administered') cur.given += 1;
      map.set(key, cur);
    }
    return map;
  }, [admins]);

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-xs text-muted border-b border-border">
            <th className="px-3 py-2 text-left font-medium sticky left-0 bg-card">Medication</th>
            {days.map((d) => {
              const future = startOfDay(d).getTime() > startOfDay(now).getTime();
              return (
                <th key={d.toISOString()} className="px-1 py-2 font-medium text-center min-w-[2rem]">
                  <button type="button" disabled={future} className={future ? 'text-muted/40 cursor-default' : 'hover:text-primary'} onClick={() => !future && onPickDay(d)} title={format(d, 'd MMM')}>{format(d, 'd')}</button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {meds.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 text-ink sticky left-0 bg-card font-medium">{m.name}</td>
              {days.map((d) => {
                const future = startOfDay(d).getTime() > startOfDay(now).getTime();
                const expected = (m.schedule_times ?? []).filter((t) => new Date(`${format(d, 'yyyy-MM-dd')}T${t}:00`) <= now).length;
                const { given = 0, any = 0 } = byMedDay.get(`${m.id}|${format(d, 'yyyy-MM-dd')}`) ?? {};
                // Colour by what actually happened, so ad-hoc doses show too.
                let bg = C64.lightGrey;
                if (given > 0) bg = expected > 0 && given < expected ? C64.yellow : C64.green;
                else if (any > 0) bg = C64.orange;
                else if (expected > 0) bg = C64.lightRed;
                const title = future ? `${format(d, 'd MMM')}: upcoming` : `${format(d, 'd MMM')}: ${given} given${expected ? ` of ${expected} due` : ''}${any > given ? `, ${any - given} exception${any - given === 1 ? '' : 's'}` : ''}`;
                return (
                  <td key={d.toISOString()} className="px-1 py-1 text-center">
                    <button type="button" disabled={future} onClick={() => !future && onPickDay(d)} title={title}
                      style={{ backgroundColor: future ? undefined : bg }} className={`inline-block h-6 w-6 rounded ${future ? 'border border-dashed border-border' : ''}`} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Full record: chronological, filterable, cursor-paginated, archive-aware.
function MarLog({ profileId }: { profileId: string }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [pages, setPages] = useState<MedicationAdministration[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const params = (c: string | null) => {
    const qs = new URLSearchParams({ limit: '50' });
    if (search.trim()) qs.set('search', search.trim());
    if (status) qs.set('status', status);
    if (includeArchived) qs.set('include_archived', 'true');
    if (c) qs.set('cursor', c);
    return qs.toString();
  };

  const { isFetching, refetch } = useQuery({
    queryKey: ['med-log', profileId, search, status, includeArchived],
    queryFn: async () => {
      const res = await api.get<{ administrations: MedicationAdministration[]; nextCursor: string | null; retentionMonths: number }>(
        `/care-profiles/${profileId}/medications/administrations?${params(null)}`
      );
      setPages([res.administrations]);
      setCursor(res.nextCursor);
      setDone(res.nextCursor === null);
      return res;
    },
  });

  const loadMore = async () => {
    const res = await api.get<{ administrations: MedicationAdministration[]; nextCursor: string | null }>(
      `/care-profiles/${profileId}/medications/administrations?${params(cursor)}`
    );
    setPages((p) => [...p, res.administrations]);
    setCursor(res.nextCursor);
    setDone(res.nextCursor === null);
  };

  const rows = pages.flat();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[12rem]">
          <Input aria-label="Search the record" placeholder="Search medication, notes or person…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by outcome">
          <option value="">All outcomes</option>
          {MED_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Include archived
        </label>
        <Button size="sm" variant="secondary" onClick={() => void refetch()}>Apply</Button>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Medication</th>
              <th className="px-4 py-3 font-medium">Dose</th>
              <th className="px-4 py-3 font-medium">Route</th>
              <th className="px-4 py-3 font-medium">By</th>
              <th className="px-4 py-3 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">{isFetching ? 'Loading…' : 'No administrations recorded yet.'}</td></tr>
            ) : rows.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0 align-top">
                <td className="px-4 py-3 whitespace-nowrap text-muted">
                  {format(new Date(a.administered_at), 'd MMM yyyy, HH:mm')}
                  {(a as { archived?: boolean }).archived ? <span className="ml-1 badge bg-surface-2 text-muted text-[10px]">archived</span> : null}
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink">{a.medication_name}</div>
                  {a.notes ? <div className="text-xs text-muted">{a.notes}</div> : null}
                </td>
                <td className="px-4 py-3 text-muted">{a.dose_given || '—'}</td>
                <td className="px-4 py-3 text-muted">{a.route_given || '—'}</td>
                <td className="px-4 py-3 text-muted whitespace-nowrap">{a.administered_by_name ?? '—'}</td>
                <td className="px-4 py-3"><span className="badge text-xs font-medium" style={swatch(statusColorFor(a.status))} title={medStatusDescription(a.status)}>{statusLabel(a.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!done && rows.length > 0 ? (
        <div className="text-center">
          <Button size="sm" variant="secondary" onClick={() => void loadMore()}>Load older</Button>
        </div>
      ) : null}
    </div>
  );
}
