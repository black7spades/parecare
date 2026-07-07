import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfDay, endOfMonth, endOfWeek,
  format, startOfDay, startOfMonth, startOfWeek,
} from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { MED_STATUSES, type MedicationRecord, type MedicationAdministration } from '../../../lib/care';
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

function MarChart({ profileId, personName, canAdminister }: { profileId: string; personName: string; canAdminister: boolean }) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(() => new Date());
  const [recording, setRecording] = useState<{ med: MedicationRecord; slotISO: string; whenLocal: string } | null>(null);

  const [from, to] = useMemo((): [Date, Date] => {
    if (period === 'day') return [startOfDay(anchor), endOfDay(anchor)];
    if (period === 'week') return [startOfWeek(anchor, { weekStartsOn: 1 }), endOfWeek(anchor, { weekStartsOn: 1 })];
    return [startOfMonth(anchor), endOfMonth(anchor)];
  }, [period, anchor]);

  const { data } = useQuery({
    queryKey: ['med-chart', profileId, from.toISOString(), to.toISOString()],
    queryFn: () => api.get<{ medications: MedicationRecord[]; administrations: ChartAdmin[] }>(
      `/care-profiles/${profileId}/medications/chart?from=${from.toISOString()}&to=${to.toISOString()}`
    ),
  });
  const meds = data?.medications ?? [];
  const admins = data?.administrations ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['med-chart', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['med-log', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['medications', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-events', profileId] });
  };

  const now = new Date();
  const days = eachDayOfInterval({ start: from, end: to });

  // Adherence summary: expected past slots vs recorded outcomes.
  const summary = useMemo(() => {
    let expected = 0;
    for (const m of meds) {
      for (const day of days) {
        for (const t of m.schedule_times ?? []) {
          const slot = new Date(`${format(day, 'yyyy-MM-dd')}T${t}:00`);
          if (slot <= now) expected += 1;
        }
      }
    }
    const by: Record<string, number> = {};
    for (const a of admins) by[a.status] = (by[a.status] ?? 0) + 1;
    const given = (by['given'] ?? 0) + (by['self_administered'] ?? 0);
    const exceptions = (by['refused'] ?? 0) + (by['omitted'] ?? 0) + (by['held'] ?? 0);
    const recorded = admins.length;
    return { expected, given, exceptions, missed: Math.max(0, expected - recorded) };
  }, [meds, admins, days]); // eslint-disable-line react-hooks/exhaustive-deps

  // Find the administration for a given medication + scheduled slot datetime.
  const findAdmin = (medId: string, slotISO: string): ChartAdmin | undefined =>
    admins.find((a) => a.medication_id === medId && a.scheduled_for && new Date(a.scheduled_for).getTime() === new Date(slotISO).getTime());

  const label = period === 'day' ? format(anchor, 'EEEE d MMMM yyyy')
    : period === 'week' ? `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`
    : format(anchor, 'MMMM yyyy');
  const step = (dir: number) => setAnchor((a) => period === 'day' ? addDays(a, dir) : period === 'week' ? addWeeks(a, dir) : addMonths(a, dir));

  const batchRound = useMutation({
    mutationFn: (entries: { medication_id: string; scheduled_for: string; administered_at: string; status: string }[]) =>
      api.post(`/care-profiles/${profileId}/medications/administrations/batch`, { entries }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(['day', 'week', 'month'] as Period[]).map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} className={`px-3 py-1.5 text-sm capitalize ${period === p ? 'bg-primary text-white' : 'bg-card text-muted hover:text-ink'}`}>{p}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => step(-1)} aria-label="Previous">←</Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(new Date())}>Today</Button>
          <Button size="sm" variant="secondary" onClick={() => step(1)} aria-label="Next">→</Button>
        </div>
      </div>
      <p className="text-sm font-medium text-ink">{label}</p>

      <div className="flex flex-wrap gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm">
        <span><span className="font-semibold text-ink">{summary.given}</span><span className="text-muted">/{summary.expected} doses given</span></span>
        {summary.exceptions > 0 ? <span className="text-amber-700">{summary.exceptions} exception{summary.exceptions === 1 ? '' : 's'}</span> : null}
        {summary.missed > 0 ? <span className="text-red-600">{summary.missed} missed</span> : null}
        {summary.expected > 0 ? <span className="text-muted">· {Math.round((summary.given / summary.expected) * 100)}% adherence</span> : null}
      </div>

      {meds.length === 0 ? (
        <p className="text-sm text-muted py-6 text-center">No active medications to chart.</p>
      ) : period === 'day' ? (
        <DayGrid meds={meds} day={anchor} findAdmin={findAdmin} now={now} canAdminister={canAdminister}
          onRecord={(med, slotISO) => setRecording({ med, slotISO, whenLocal: format(new Date(slotISO), "yyyy-MM-dd'T'HH:mm") })}
          onRound={(entries) => batchRound.mutate(entries)} />
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
          onClose={() => setRecording(null)}
          onSaved={() => { setRecording(null); invalidate(); }}
        />
      ) : null}
    </div>
  );
}

// Aligned day grid: rows = meds, columns = the union of scheduled times.
function DayGrid({ meds, day, findAdmin, now, canAdminister, onRecord, onRound }: {
  meds: MedicationRecord[]; day: Date; now: Date; canAdminister: boolean;
  findAdmin: (medId: string, slotISO: string) => ChartAdmin | undefined;
  onRecord: (med: MedicationRecord, slotISO: string) => void;
  onRound: (entries: { medication_id: string; scheduled_for: string; administered_at: string; status: string }[]) => void;
}) {
  const dayStr = format(day, 'yyyy-MM-dd');
  const times = [...new Set(meds.flatMap((m) => m.schedule_times ?? []))].sort();
  const slotISO = (t: string) => new Date(`${dayStr}T${t}:00`).toISOString();

  const roundDue = (t: string) => meds
    .filter((m) => (m.schedule_times ?? []).includes(t) && !findAdmin(m.id, slotISO(t)) && new Date(`${dayStr}T${t}:00`) <= now)
    .map((m) => ({ medication_id: m.id, scheduled_for: slotISO(t), administered_at: new Date().toISOString(), status: 'given' }));

  if (times.length === 0) return <p className="text-sm text-muted py-4">These medications have no scheduled times. Use “Record dose” on the list to log an ad-hoc administration.</p>;

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-xs text-muted border-b border-border">
            <th className="px-3 py-2 text-left font-medium sticky left-0 bg-card">Medication</th>
            {times.map((t) => (
              <th key={t} className="px-2 py-2 font-medium text-center min-w-[4.5rem]">
                <div>{t}</div>
                {canAdminister ? (
                  <button type="button" data-testid={`round-${t}`} className="text-[11px] text-primary hover:underline disabled:opacity-40"
                    disabled={roundDue(t).length === 0}
                    onClick={() => { const e = roundDue(t); if (e.length) onRound(e); }}>
                    give all
                  </button>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {meds.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 text-ink sticky left-0 bg-card">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-muted">{[m.dose, m.route].filter(Boolean).join(' · ')}</div>
              </td>
              {times.map((t) => {
                const has = (m.schedule_times ?? []).includes(t);
                if (!has) return <td key={t} className="px-2 py-2 text-center text-muted/40">·</td>;
                const iso = slotISO(t);
                const a = findAdmin(m.id, iso);
                const past = new Date(`${dayStr}T${t}:00`) <= now;
                return (
                  <td key={t} className="px-2 py-2 text-center">
                    {a ? (
                      <span data-testid={`slot-${m.id}-${t}`} title={`${statusLabel(a.status)}${a.notes ? ` — ${a.notes}` : ''}`}
                        style={swatch(statusColorFor(a.status))}
                        className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded px-1 text-xs font-medium">
                        {a.status === 'given' || a.status === 'self_administered' ? '✓' : statusLabel(a.status).slice(0, 4)}
                      </span>
                    ) : canAdminister ? (
                      <button type="button" data-testid={`slot-${m.id}-${t}`} onClick={() => onRecord(m, iso)}
                        style={past ? { borderColor: C64.lightRed, color: C64.lightRed } : undefined}
                        className={`inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded border border-dashed px-1 text-xs ${past ? 'hover:bg-surface-2' : 'border-border text-muted hover:bg-surface-2'}`}>
                        {past ? 'due' : '+'}
                      </button>
                    ) : (
                      <span className="text-xs text-muted">{past ? '—' : ''}</span>
                    )}
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

// Adherence heatmap: rows = meds, columns = days in the week/month.
function MonthGrid({ meds, days, admins, now, onPickDay }: {
  meds: MedicationRecord[]; days: Date[]; admins: ChartAdmin[]; now: Date; onPickDay: (d: Date) => void;
}) {
  const givenByMedDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of admins) {
      if (a.status !== 'given' && a.status !== 'self_administered') continue;
      const key = `${a.medication_id}|${format(new Date(a.administered_at), 'yyyy-MM-dd')}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [admins]);

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-xs text-muted border-b border-border">
            <th className="px-3 py-2 text-left font-medium sticky left-0 bg-card">Medication</th>
            {days.map((d) => (
              <th key={d.toISOString()} className="px-1 py-2 font-medium text-center min-w-[2rem]">
                <button type="button" className="hover:text-primary" onClick={() => onPickDay(d)} title={format(d, 'd MMM')}>{format(d, 'd')}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {meds.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 text-ink sticky left-0 bg-card font-medium">{m.name}</td>
              {days.map((d) => {
                const expected = (m.schedule_times ?? []).filter((t) => new Date(`${format(d, 'yyyy-MM-dd')}T${t}:00`) <= now).length;
                const given = givenByMedDay.get(`${m.id}|${format(d, 'yyyy-MM-dd')}`) ?? 0;
                const totalSlots = (m.schedule_times ?? []).length;
                let bg = C64.lightGrey;
                if (totalSlots > 0 && expected > 0) {
                  if (given >= expected) bg = C64.green;
                  else if (given > 0) bg = C64.yellow;
                  else bg = C64.lightRed;
                }
                return (
                  <td key={d.toISOString()} className="px-1 py-1 text-center">
                    <button type="button" onClick={() => onPickDay(d)} title={`${format(d, 'd MMM')}: ${given}/${totalSlots} given`}
                      style={{ backgroundColor: bg }} className="inline-block h-5 w-5 rounded" />
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
                <td className="px-4 py-3"><span className="badge text-xs font-medium" style={swatch(statusColorFor(a.status))}>{statusLabel(a.status)}</span></td>
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
