import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { Modal } from './ui/Modal';
import { ContactPicker, contactProblem, pickedFrom, type PickedContact } from './ContactPicker';
import { noticeFiled, refreshContacts } from '../stores/notice';
import { DOCTOR_VIEWS, RESULT_FLAGS, type ResultValue, type TestResult } from '../lib/lifeEvents';

const selectClass =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

interface ApptOption {
  id: string;
  title: string;
  starts_at: string | null;
  appointment_type: string;
  status: string;
  provider_name: string | null;
}

interface ValueDraft {
  key: number;
  name: string;
  result: string;
  unit: string;
  low: string;
  high: string;
  flag: string;
}

const numOrNull = (s: string): number | null => {
  const t = s.trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** The flag the normal range gives, the same rule the server uses. */
const workedOutFlag = (v: Pick<ResultValue, 'value_number' | 'range_low' | 'range_high'>): string => {
  if (v.value_number == null) return '';
  if (v.range_low != null && v.value_number < v.range_low) return 'low';
  if (v.range_high != null && v.value_number > v.range_high) return 'high';
  return v.range_low != null || v.range_high != null ? 'normal' : '';
};

const draftFrom = (v: ResultValue, key: number): ValueDraft => ({
  key,
  name: v.name,
  result: v.value_number != null ? String(v.value_number) : v.value_text ?? '',
  unit: v.unit ?? '',
  low: v.range_low != null ? String(v.range_low) : '',
  high: v.range_high != null ? String(v.range_high) : '',
  // A flag the range worked out stays worked out, so a corrected number gets the right one.
  flag: v.flag && v.flag !== workedOutFlag(v) ? v.flag : '',
});

const when = (a: ApptOption) => (a.starts_at ? format(new Date(a.starts_at), 'd MMM yyyy') : 'Not booked yet');

/**
 * Add a test result or change one: what the test was, when, who ordered it,
 * what the doctor said, and each measure in its own row. The visit to talk
 * about it at is worked out from who ordered it, and can be changed.
 */
export function ResultEditor({
  profileId,
  result,
  initialAppointmentId,
  initialTestName,
  onClose,
  onSaved,
  fromJourneyItemId,
}: {
  profileId: string;
  result?: TestResult | null;
  initialAppointmentId?: string | null;
  initialTestName?: string | null;
  /** The journey step this is recorded from; saving ticks it off. */
  fromJourneyItemId?: string | null;

  onClose: () => void;
  onSaved?: (r: TestResult) => void;
}) {
  const queryClient = useQueryClient();
  const [testName, setTestName] = useState(result?.test_name ?? initialTestName ?? '');
  const [collected, setCollected] = useState(result?.collected_on ?? '');
  const [reported, setReported] = useState(result?.reported_on ?? '');
  const [apptId, setApptId] = useState(result?.appointment_id ?? initialAppointmentId ?? '');
  const [orderedBy, setOrderedBy] = useState<PickedContact>(pickedFrom(result?.ordered_by ?? null));
  const [lab, setLab] = useState<PickedContact>(pickedFrom(result?.lab ?? null));
  const [summary, setSummary] = useState(result?.summary ?? '');
  const [view, setView] = useState<string>(result?.doctor_view ?? '');
  // Empty means worked out from who ordered it.
  const [reviewId, setReviewId] = useState(result?.review_appointment_id ?? '');
  const [reviewTouched, setReviewTouched] = useState(false);
  const [nextKey, setNextKey] = useState((result?.values.length ?? 0) + 1);
  const [values, setValues] = useState<ValueDraft[]>(
    result?.values.length ? result.values.map((v, i) => draftFrom(v, i)) : [{ key: 0, name: '', result: '', unit: '', low: '', high: '', flag: '' }]
  );
  const [missing, setMissing] = useState('');
  const [error, setError] = useState('');

  const { data: apptData } = useQuery({
    queryKey: ['appointments', profileId],
    queryFn: () => api.get<{ appointments: ApptOption[] }>(`/care-profiles/${profileId}/appointments`),
  });
  const appts = apptData?.appointments ?? [];
  const tests = appts.filter((a) => a.status !== 'cancelled').sort((a, b) => (b.starts_at ?? '').localeCompare(a.starts_at ?? ''));
  const upcoming = appts
    .filter((a) => a.status === 'scheduled' && a.starts_at && new Date(a.starts_at) >= new Date())
    .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));

  const setValue = (key: number, patch: Partial<ValueDraft>) => setValues((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const contactField = (prefix: string, v: PickedContact, before: { id: string | null } | null | undefined) => {
    if (v.providerId) return v.providerId === (before?.id ?? '') ? {} : { [`${prefix}_provider_id`]: v.providerId };
    if (v.name.trim()) return { [`${prefix}_name`]: v.name.trim(), ...(prefix === 'ordered_by' ? { ordered_by_type: v.providerType.trim() || null } : {}) };
    return before?.id ? { [`${prefix}_provider_id`]: null } : {};
  };

  const save = useMutation({
    mutationFn: () => {
      const rows = values.filter((v) => v.name.trim() || v.result.trim());
      const body = {
        test_name: testName.trim(),
        // Left empty, the server uses the day of the test appointment.
        ...(collected || result?.collected_on ? { collected_on: collected || null } : {}),
        reported_on: reported || null,
        appointment_id: apptId || null,
        summary: summary.trim() || null,
        doctor_view: view || null,
        ...contactField('ordered_by', orderedBy, result?.ordered_by),
        ...contactField('lab', lab, result?.lab),
        ...(reviewTouched ? { review_appointment_id: reviewId || null } : {}),
        values: rows.map((v) => {
          const n = numOrNull(v.result);
          return {
            name: v.name.trim(),
            value_number: n,
            value_text: n == null ? v.result.trim() || null : null,
            unit: v.unit.trim() || null,
            range_low: numOrNull(v.low),
            range_high: numOrNull(v.high),
            flag: v.flag || null,
          };
        }),
      };
      return result
        ? api.patch<{ result: TestResult; filed?: Array<{ id: string; name: string }> }>(`/care-profiles/${profileId}/results/${result.id}`, body)
        : api.post<{ result: TestResult; filed?: Array<{ id: string; name: string }> }>(`/care-profiles/${profileId}/results`, { ...body, ...(fromJourneyItemId ? { from_journey_item_id: fromJourneyItemId } : {}) });
    },
    onSuccess: (res) => {
      noticeFiled(profileId, res.filed);
      refreshContacts(queryClient);
      for (const key of [['test-results', profileId], ['appointments', profileId], ['tasks', profileId]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      onSaved?.(res.result);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The result did not save. Check your connection and try again.'),
  });

  return (
    <Modal open onClose={onClose} title={result ? `Change the ${result.test_name} result` : 'Add a result'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          // Save always answers: name what is missing.
          const unnamed = values.find((v) => !v.name.trim() && v.result.trim());
          if (!testName.trim()) {
            setMissing('Say which test it was, then save.');
            document.getElementById('result-test')?.focus();
            return;
          }
          if (unnamed) {
            setMissing('Each result needs its measure named, such as HbA1c.');
            document.getElementById(`result-measure-${unnamed.key}`)?.focus();
            return;
          }
          const unpicked = contactProblem(orderedBy, 'Ordered by') ?? contactProblem(lab, 'Lab');
          if (unpicked) {
            setMissing(unpicked);
            document.getElementById(contactProblem(orderedBy, 'Ordered by') ? 'result-ordered' : 'result-lab')?.focus();
            return;
          }
          setMissing('');
          save.mutate();
        }}
      >
        <Input id="result-test" label="Test" value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="e.g. Full blood count" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="result-collected" label="Collected on" type="date" value={collected} onChange={(e) => setCollected(e.target.value)} hint={!collected && apptId ? 'Left empty, it is the day of the test appointment.' : undefined} />
          <Input id="result-reported" label="Results came on" type="date" value={reported} onChange={(e) => setReported(e.target.value)} />
        </div>
        <div>
          <label htmlFor="result-appt" className="block text-sm font-medium text-ink mb-1">From the appointment</label>
          <select id="result-appt" className={selectClass} value={apptId} onChange={(e) => setApptId(e.target.value)}>
            <option value="">Not from an appointment on file</option>
            {tests.map((a) => (
              <option key={a.id} value={a.id}>{a.title}, {when(a)}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ContactPicker id="result-ordered" label="Ordered by" profileId={profileId} value={orderedBy} onChange={setOrderedBy} kind="person" hint="Who asked for the test. The result shows at the next visit with them." />
          <ContactPicker id="result-lab" label="Lab" profileId={profileId} value={lab} onChange={setLab} kind="organisation" placeholder="e.g. Melbourne Pathology" defaultType="Pathology" />
        </div>
        <Textarea id="result-summary" label="What it showed" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Iron a little low, everything else normal" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="result-view" className="block text-sm font-medium text-ink mb-1">What the doctor said</label>
            <select id="result-view" className={selectClass} value={view} onChange={(e) => setView(e.target.value)}>
              <option value="">Not said yet</option>
              {DOCTOR_VIEWS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="result-review" className="block text-sm font-medium text-ink mb-1">To talk about at</label>
            <select
              id="result-review"
              className={selectClass}
              value={reviewId}
              onChange={(e) => {
                setReviewId(e.target.value);
                setReviewTouched(true);
              }}
            >
              <option value="">{result ? 'No visit' : 'Worked out from who ordered it'}</option>
              {upcoming.map((a) => (
                <option key={a.id} value={a.id}>{a.title}, {when(a)}{a.provider_name ? `, ${a.provider_name}` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Each measure</legend>
          {values.map((v) => (
            <div key={v.key} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_0.8fr_0.9fr_auto] items-end">
              <Input id={`result-measure-${v.key}`} label="Measure" value={v.name} onChange={(e) => setValue(v.key, { name: e.target.value })} placeholder="e.g. HbA1c" />
              <Input label="Result" value={v.result} onChange={(e) => setValue(v.key, { result: e.target.value })} placeholder="e.g. 6.8" />
              <Input label="Unit" value={v.unit} onChange={(e) => setValue(v.key, { unit: e.target.value })} placeholder="e.g. %" />
              <Input label="Normal range from" value={v.low} onChange={(e) => setValue(v.key, { low: e.target.value })} inputMode="decimal" />
              <Input label="Normal range to" value={v.high} onChange={(e) => setValue(v.key, { high: e.target.value })} inputMode="decimal" />
              <label className="block">
                <span className="block text-sm font-medium text-ink mb-1">Flag</span>
                <select className={selectClass} value={v.flag} onChange={(e) => setValue(v.key, { flag: e.target.value })} aria-label="Flag">
                  <option value="">Worked out</option>
                  {RESULT_FLAGS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </label>
              <Button type="button" size="xs" variant="ghost-danger" onClick={() => setValues((vs) => vs.filter((x) => x.key !== v.key))}>Remove</Button>
            </div>
          ))}
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={() => {
              setValues((vs) => [...vs, { key: nextKey, name: '', result: '', unit: '', low: '', high: '', flag: '' }]);
              setNextKey((k) => k + 1);
            }}
          >
            Add a measure
          </Button>
          <p className="text-xs text-muted">The flag is worked out from the normal range when it is left as it is.</p>
        </fieldset>
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save the result</Button>
        </div>
        {missing ? <p className="text-sm text-red-600 text-right" role="alert">{missing}</p> : null}
      </form>
    </Modal>
  );
}

