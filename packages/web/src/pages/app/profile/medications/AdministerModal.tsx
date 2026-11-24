import { asNeededLine, medStatusDescription, MED_STATUSES } from '../../../../lib/care';
import { format, formatDistanceStrict } from 'date-fns';
import { SELECT, localNow } from './shared';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input, Textarea } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import { checkLimits } from '../../../../lib/asNeeded';
import type { MedicationRecord } from '../../../../lib/care';
import { askIfHome } from '../../../../stores/homeDose';

// Outcomes that stand on their own. Refused, omitted and held need a note
// saying why.
const NOTE_OPTIONAL_OUTCOMES = new Set(['given', 'self_administered', 'not_in_stock']);
const GIVEN_OUTCOMES = new Set(['given', 'self_administered']);

/** What a limit check found, from this screen or from the server. */
interface LimitNotice {
  lastGivenAt: Date | null;
  nextFrom: Date | null;
  insideGap: boolean;
  overMost: boolean;
  countWithThis: number;
}

/** "Last given 14:05 by Jess Carter. 2 doses in the last 24 hours." */
export function lastGivenLine(m: MedicationRecord): string | null {
  const h = m.dose_history;
  if (!h) return null;
  if (!h.last_given_at) return 'Not given yet.';
  const at = new Date(h.last_given_at);
  const when = format(at, Date.now() - at.getTime() > 24 * 3600 * 1000 ? 'd MMM, HH:mm' : 'HH:mm');
  return `Last given ${when}${h.last_given_by ? ` by ${h.last_given_by}` : ''}. ${h.given_24h} ${h.given_24h === 1 ? 'dose' : 'doses'} in the last 24 hours.`;
}

export function AdministerModal({ profileId, med, personName, scheduledFor, initialWhen, initialStatus, maxWhen, onClose, onSaved }: { profileId: string; med: MedicationRecord; personName: string; scheduledFor?: string; initialWhen?: string; initialStatus?: string; maxWhen?: string; onClose: () => void; onSaved: () => void }) {
  const [when, setWhen] = useState(initialWhen ?? localNow());
  const [status, setStatus] = useState(initialStatus ?? 'given');
  const [doseGiven, setDoseGiven] = useState(med.dose ?? '');
  const [routeGiven, setRouteGiven] = useState(med.route ?? '');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  // Why it must be given inside the gap or over the most: its own field.
  const [whyNow, setWhyNow] = useState('');
  // Inside the gap or over the most: the person chose to give it anyway.
  const [giveAnyway, setGiveAnyway] = useState(false);
  const [serverLimits, setServerLimits] = useState<LimitNotice | null>(null);
  const [error, setError] = useState('');
  const focus = (id: string) => setTimeout(() => document.getElementById(id)?.focus(), 0);

  const given = GIVEN_OUTCOMES.has(status);
  const notesRequired = !NOTE_OPTIONAL_OUTCOMES.has(status);
  const reasonRequired = med.as_needed && given;
  const limitsLine = asNeededLine(med);

  // Worked out here from the doses already given, so the warning shows
  // before Save; the server checks again and has the last word.
  const at = new Date(when);
  const localCheck = (() => {
    if (!given || !med.as_needed || Number.isNaN(at.getTime())) return null;
    if (med.min_hours_between_doses == null && med.max_doses_per_day == null) return null;
    const c = checkLimits(
      { min_hours_between_doses: med.min_hours_between_doses ?? null, max_doses_per_day: med.max_doses_per_day ?? null },
      at,
      (med.dose_history?.recent_given ?? []).map((d) => new Date(d))
    );
    return c.outside ? { lastGivenAt: c.last_given_at, nextFrom: c.next_from, insideGap: c.inside_gap, overMost: c.over_most, countWithThis: c.count_with_this } : null;
  })();
  const notice = given ? localCheck ?? serverLimits : null;
  const waitUntil = (() => {
    if (!notice) return null;
    if (notice.nextFrom) return notice.nextFrom;
    // Over the most: the next dose is due once the oldest one in 24 hours drops off.
    const day = (med.dose_history?.recent_given ?? []).map((d) => new Date(d)).filter((d) => at.getTime() - d.getTime() < 24 * 3600 * 1000 && d <= at);
    const oldest = day.sort((a, b) => a.getTime() - b.getTime())[0];
    return oldest ? new Date(oldest.getTime() + 24 * 3600 * 1000) : null;
  })();
  const justification = notice && giveAnyway ? whyNow : '';

  const mutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/medications/${med.id}/administrations`, {
      administered_at: new Date(when).toISOString(),
      scheduled_for: scheduledFor ?? null,
      status,
      dose_given: doseGiven || null,
      route_given: routeGiven || null,
      notes: notes.trim() || null,
      reason: given && reason.trim() ? reason.trim() : null,
      outside_limits_reason: notice && giveAnyway && whyNow.trim() ? whyNow.trim() : null,
      // Person, medication and documentation are guaranteed by context and set
      // server-side; time is the recorded moment; dose and route are recorded.
      right_dose: !!doseGiven.trim(),
      right_route: !!routeGiven.trim(),
      right_time: true,
    }),
    onSuccess: (res) => {
      askIfHome(profileId, res);
      onSaved();
    },
    onError: (err) => {
      // The server found it inside the gap or over the most: say so here.
      if (err instanceof ApiError && err.code === 'OUTSIDE_LIMITS' && err.data?.['limits']) {
        const l = err.data['limits'] as { last_given_at: string | null; next_from: string | null; inside_gap: boolean; over_most: boolean; count_with_this: number };
        setServerLimits({
          lastGivenAt: l.last_given_at ? new Date(l.last_given_at) : null,
          nextFrom: l.next_from ? new Date(l.next_from) : null,
          insideGap: l.inside_gap,
          overMost: l.over_most,
          countWithThis: l.count_with_this,
        });
        setError('');
        return;
      }
      setError(err instanceof Error ? err.message : 'The dose was not recorded. Try again.');
    },
  });

  const submit = () => {
    if (maxWhen && when > maxWhen) {
      setError('A dose cannot be recorded in the future. Pick a time that has passed.');
      return;
    }
    if (reasonRequired && !reason.trim()) {
      setError('Say why it is needed now, e.g. Pain in her hip when standing.');
      focus('admin-reason');
      return;
    }
    if (notice && !giveAnyway) {
      setError('This dose is inside its limits. Choose Wait, or Give it now and say why.');
      return;
    }
    if (notice && giveAnyway && !justification.trim()) {
      setError('Say why it must be given now.');
      focus('admin-why-now');
      return;
    }
    if (notesRequired && !notes.trim()) {
      setError(`Say why the dose was ${MED_STATUSES.find((s) => s.value === status)?.label.toLowerCase()}.`);
      focus('admin-notes');
      return;
    }
    setError('');
    mutation.mutate();
  };

  const ago = (d: Date) => (Math.abs(at.getTime() - d.getTime()) < 60000 ? 'just now' : formatDistanceStrict(d, at, { addSuffix: true }));

  return (
    <Modal open onClose={onClose} title={`${personName} · ${format(Number.isNaN(at.getTime()) ? new Date() : at, 'd MMM yyyy')}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {/* The medication being logged, under the person + date heading. */}
        <div className="border-b border-border pb-3">
          <p className="text-sm font-semibold text-ink">{med.name}</p>
          {med.instructions ? <p className="text-sm text-ink">{med.instructions}</p> : null}
          {med.with_food ? <p className="text-xs text-muted">Take with food.</p> : null}
          {limitsLine ? <p className="text-xs text-muted">{limitsLine}</p> : null}
          {lastGivenLine(med) && (med.as_needed || limitsLine) ? <p className="text-xs text-muted">{lastGivenLine(med)}</p> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Dose" value={doseGiven} onChange={(e) => setDoseGiven(e.target.value)} placeholder="e.g. 500 mg" />
          <Input label="Given by route" value={routeGiven} onChange={(e) => setRouteGiven(e.target.value)} placeholder="e.g. Oral" />
        </div>

        <div>
          <label htmlFor="admin-when" className="block text-sm font-medium text-ink mb-1">Time</label>
          <input id="admin-when" type="datetime-local" className={`${SELECT} w-full`} value={when} max={maxWhen} onChange={(e) => { setWhen(e.target.value); setServerLimits(null); }} required />
        </div>

        <div>
          <label htmlFor="admin-status" className="block text-sm font-medium text-ink mb-1">Outcome</label>
          <select id="admin-status" className={`${SELECT} w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {MED_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">{medStatusDescription(status)}</p>
        </div>

        {med.as_needed && given ? (
          <Textarea
            id="admin-reason"
            label="Why is it needed now?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. Pain in her hip when standing"
          />
        ) : null}

        {notice ? (
          <div className="rounded-md border-l-4 border-red-500 bg-red-50 dark:bg-red-900/10 px-3 py-2 text-sm text-red-700 dark:text-red-300 space-y-1" role="alert">
            {notice.insideGap && notice.lastGivenAt && med.min_hours_between_doses != null ? (
              <p>
                Last given at {format(notice.lastGivenAt, 'HH:mm')}, {ago(notice.lastGivenAt)}. {med.name} needs at least {med.min_hours_between_doses} hours between doses.
                {notice.nextFrom ? ` The next dose is due from ${format(notice.nextFrom, 'HH:mm')}.` : ''}
              </p>
            ) : null}
            {notice.overMost && med.max_doses_per_day != null ? (
              <p>This would be dose {notice.countWithThis} in 24 hours. The most is {med.max_doses_per_day}.</p>
            ) : null}
            {!giveAnyway ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" size="sm" onClick={onClose}>{waitUntil ? `Wait until ${format(waitUntil, 'HH:mm')}` : 'Wait'}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => { setGiveAnyway(true); setError(''); focus('admin-why-now'); }}>Give it now</Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {notice && giveAnyway ? (
          <Textarea
            id="admin-why-now"
            label="Why it must be given now"
            value={whyNow}
            onChange={(e) => setWhyNow(e.target.value)}
            rows={2}
            placeholder="e.g. The doctor said to give it now"
          />
        ) : null}
        {(
          <Textarea
            id="admin-notes"
            label={notesRequired ? 'Why was it not given?' : 'Notes'}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={notesRequired ? 'e.g. She was asleep' : 'Anything worth recording'}
          />
        )}
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          {/* The wait button leads while the limits notice is up. */}
          <Button type="submit" variant={notice && !giveAnyway ? 'secondary' : 'primary'} loading={mutation.isPending}>Log dose</Button>
        </div>
      </form>
    </Modal>
  );
}
