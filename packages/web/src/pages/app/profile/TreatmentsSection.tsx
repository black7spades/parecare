import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import {
  METRIC_VALUE_TYPES,
  OBSERVATION_STATUSES,
  TREATMENT_CATEGORIES,
  TREATMENT_TEMPLATES,
  observationStatusDescription,
  observationStatusLabel,
  treatmentCategoryLabel,
  type DeviceKey,
  type MedicalCondition,
  type Observation,
  type Treatment,
  type TreatmentMetric,
} from '../../../lib/care';

const SELECT = 'rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Therapies and devices: the treatments beyond medications. Each treatment
 * defines its own measures and every session is logged as an observation,
 * either by a person here or pushed by the device itself through the
 * device API.
 */
export function TreatmentsSection({ profileId, careName, canManage, canLog }: {
  profileId: string;
  careName: string;
  canManage: boolean;
  canLog: boolean;
}) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Treatment | null>(null);
  const [logging, setLogging] = useState<Treatment | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['treatments', profileId],
    queryFn: () => api.get<{ treatments: Treatment[] }>(`/care-profiles/${profileId}/treatments`),
  });
  const treatments = data?.treatments ?? [];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['treatments', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['observations', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">Therapies and devices</h3>
          <p className="mt-1 text-sm text-muted">
            Everything beyond medications that manages a condition: a CPAP machine used every night, physiotherapy,
            wound care. Each one records its sessions in its own measures, and a device can push its readings itself.
          </p>
        </div>
        {canManage ? (
          <Button className="self-start sm:self-auto" onClick={() => setAddOpen(true)}>Add treatment</Button>
        ) : null}
      </div>

      {treatments.length === 0 ? (
        <div className="card py-8 text-center text-sm text-muted">
          No therapies or devices recorded yet{canManage ? '. Add one to start logging sessions.' : '.'}
        </div>
      ) : (
        <div className="space-y-3">
          {treatments.map((t) => (
            <div key={t.id} className={`card space-y-3 ${t.active ? '' : 'opacity-60'}`}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-ink">{t.name}</span>
                    <span className="badge bg-surface-2 text-ink text-xs">{treatmentCategoryLabel(t.category)}</span>
                    {t.active ? null : <span className="badge bg-surface-2 text-muted text-xs">Inactive</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted space-x-2">
                    {t.condition_name ? <span>For {t.condition_name}</span> : null}
                    {t.frequency ? <span>{t.frequency}</span> : null}
                    {t.as_needed ? <span>Only when needed</span> : null}
                  </div>
                  {t.metrics.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.metrics.map((m) => (
                        <span key={m.id} className="badge bg-surface-2 text-muted text-xs">
                          {m.name}{m.unit ? ` in ${m.unit}` : ''}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-1 text-xs text-muted">
                    {t.last_observed_at
                      ? `Last logged ${formatDistanceToNow(new Date(t.last_observed_at), { addSuffix: true })}`
                      : 'Nothing logged yet'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {canLog && t.active ? <Button size="sm" onClick={() => setLogging(t)}>Log session</Button> : null}
                  <Button size="sm" variant="secondary" onClick={() => setHistoryFor(historyFor === t.id ? null : t.id)}>
                    {historyFor === t.id ? 'Hide history' : 'History'}
                  </Button>
                  {canManage ? <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button> : null}
                </div>
              </div>
              {historyFor === t.id ? (
                <ObservationHistory profileId={profileId} treatment={t} canLog={canLog} onChanged={invalidate} />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {addOpen ? (
        <TreatmentForm profileId={profileId} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); invalidate(); }} />
      ) : null}
      {editing ? (
        <TreatmentForm profileId={profileId} treatment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />
      ) : null}
      {logging ? (
        <LogObservationModal
          profileId={profileId}
          treatment={logging}
          careName={careName}
          onClose={() => setLogging(null)}
          onSaved={() => { setLogging(null); invalidate(); }}
        />
      ) : null}
    </div>
  );
}

/** One reading rendered for a table cell, in the measure's own type. */
function readingCell(o: Observation, metric: TreatmentMetric): string {
  const v = o.values.find((x) => x.treatment_metric_id === metric.id);
  if (!v) return '';
  if (metric.value_type === 'number') return v.value_number != null ? String(v.value_number) : '';
  if (metric.value_type === 'yes_no') return v.value_boolean == null ? '' : v.value_boolean ? 'Yes' : 'No';
  return v.value_text ?? '';
}

/**
 * The session log for one treatment. The treatment's measures are known, so
 * every measure gets its own column, independently readable.
 */
function ObservationHistory({ profileId, treatment, canLog, onChanged }: {
  profileId: string;
  treatment: Treatment;
  canLog: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['observations', profileId, treatment.id],
    queryFn: () => api.get<{ observations: Observation[]; nextCursor: string | null }>(
      `/care-profiles/${profileId}/treatments/observations?treatment_id=${treatment.id}&limit=50`
    ),
  });
  const observations = data?.observations ?? [];

  const remove = useMutation({
    mutationFn: (observationId: string) => api.delete(`/care-profiles/${profileId}/treatments/observations/${observationId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['observations', profileId, treatment.id] });
      onChanged();
    },
  });

  if (observations.length === 0) {
    return <p className="border-t border-border pt-3 text-sm text-muted">No sessions logged yet.</p>;
  }

  return (
    <div className="border-t border-border pt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-border">
            <th className="px-2 py-2 font-medium">When</th>
            {treatment.metrics.map((m) => (
              <th key={m.id} className="px-2 py-2 font-medium">
                <div>{m.name}</div>
                {m.unit ? <div className="font-normal">{m.unit}</div> : null}
              </th>
            ))}
            <th className="px-2 py-2 font-medium">Outcome</th>
            <th className="px-2 py-2 font-medium">Notes</th>
            <th className="px-2 py-2 font-medium">Recorded by</th>
            <th className="px-2 py-2 font-medium">Source</th>
            {canLog ? <th className="px-2 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {observations.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-0 align-top">
              <td className="px-2 py-2 whitespace-nowrap text-ink">{format(new Date(o.observed_at), 'd MMM yyyy h:mm a')}</td>
              {treatment.metrics.map((m) => (
                <td key={m.id} className="px-2 py-2 text-ink">{readingCell(o, m) || <span className="text-muted">&mdash;</span>}</td>
              ))}
              <td className="px-2 py-2">
                <span title={observationStatusDescription(o.status)}>{observationStatusLabel(o.status)}</span>
              </td>
              <td className="px-2 py-2 text-muted max-w-56">{o.notes || ''}</td>
              <td className="px-2 py-2 text-muted">{o.recorded_by_name || ''}</td>
              <td className="px-2 py-2 text-muted">{o.source === 'device' ? 'Device' : 'Logged by hand'}</td>
              {canLog ? (
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    aria-label="Remove this session"
                    className="text-muted hover:text-red-600 text-sm px-1"
                    onClick={() => remove.mutate(o.id)}
                  >
                    ✕
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {data?.nextCursor ? <p className="mt-2 text-xs text-muted">Showing the most recent 50 sessions.</p> : null}
    </div>
  );
}

/** Log one session: when, one input per measure, how it went, and notes. */
function LogObservationModal({ profileId, treatment, careName, onClose, onSaved }: {
  profileId: string;
  treatment: Treatment;
  careName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [when, setWhen] = useState(localNow());
  const [status, setStatus] = useState('completed');
  const [notes, setNotes] = useState('');
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const notesRequired = status !== 'completed';
  const setReading = (metricId: string, value: string) => setReadings((prev) => ({ ...prev, [metricId]: value }));

  const mutation = useMutation({
    mutationFn: () => {
      const values = treatment.metrics
        .map((m) => {
          const raw = (readings[m.id] ?? '').trim();
          if (raw === '') return null;
          if (m.value_type === 'number') {
            const n = Number(raw);
            return Number.isFinite(n) ? { treatment_metric_id: m.id, value_number: n } : null;
          }
          if (m.value_type === 'yes_no') return { treatment_metric_id: m.id, value_boolean: raw === 'yes' };
          return { treatment_metric_id: m.id, value_text: raw };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
      return api.post(`/care-profiles/${profileId}/treatments/${treatment.id}/observations`, {
        observed_at: new Date(when).toISOString(),
        status,
        notes: notes.trim() || null,
        values,
      });
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to record'),
  });

  const submit = () => {
    if (when > localNow()) {
      setError('You cannot log a session in the future.');
      return;
    }
    if (notesRequired && !notes.trim()) {
      setError(`A note is required when the outcome is "${observationStatusLabel(status)}".`);
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title={`${careName} · ${format(new Date(when), 'd MMM yyyy')}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="border-b border-border pb-3">
          <p className="text-base font-semibold text-ink">{treatment.name}</p>
        </div>

        <div>
          <label htmlFor="obs-when" className="block text-sm font-medium text-ink mb-1">Time</label>
          <input id="obs-when" type="datetime-local" className={`${SELECT} w-full`} value={when} max={localNow()} onChange={(e) => setWhen(e.target.value)} required />
        </div>

        {treatment.metrics.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {treatment.metrics.map((m) => {
              const label = m.unit ? `${m.name}, in ${m.unit}` : m.name;
              if (m.value_type === 'yes_no') {
                return (
                  <div key={m.id}>
                    <label htmlFor={`reading-${m.id}`} className="block text-sm font-medium text-ink mb-1">{label}</label>
                    <select id={`reading-${m.id}`} className={`${SELECT} w-full`} value={readings[m.id] ?? ''} onChange={(e) => setReading(m.id, e.target.value)}>
                      <option value="">Not recorded</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                );
              }
              return (
                <Input
                  key={m.id}
                  id={`reading-${m.id}`}
                  label={label}
                  type={m.value_type === 'number' ? 'number' : 'text'}
                  step={m.value_type === 'number' ? 'any' : undefined}
                  value={readings[m.id] ?? ''}
                  onChange={(e) => setReading(m.id, e.target.value)}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">This treatment has no measures set up, so only the session itself is logged.</p>
        )}

        <div>
          <label htmlFor="obs-status" className="block text-sm font-medium text-ink mb-1">Outcome</label>
          <select id="obs-status" className={`${SELECT} w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {OBSERVATION_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">{observationStatusDescription(status)}</p>
        </div>

        <Textarea
          label={notesRequired ? 'Notes, required' : 'Notes'}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder={notesRequired ? 'Explain why the session was not completed' : 'Anything worth recording'}
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Log session</Button>
        </div>
      </form>
    </Modal>
  );
}

/** One measure row in the editor: name, unit and value type, each its own field. */
interface MetricDraft {
  id: string | null;
  name: string;
  unit: string;
  value_type: 'number' | 'text' | 'yes_no';
}

/**
 * The treatment editor. Adding offers ready-made set-ups; everything stays
 * editable. Editing also manages the treatment's device keys.
 */
function TreatmentForm({ profileId, treatment, onClose, onSaved }: {
  profileId: string;
  treatment?: Treatment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(treatment?.name ?? '');
  const [category, setCategory] = useState(treatment?.category ?? 'other');
  const [condition, setCondition] = useState(treatment?.condition_name ?? '');
  const [frequency, setFrequency] = useState(treatment?.frequency ?? '');
  const [asNeeded, setAsNeeded] = useState(treatment?.as_needed ?? false);
  const [instructions, setInstructions] = useState(treatment?.instructions ?? '');
  const [active, setActive] = useState(treatment?.active ?? true);
  const [metrics, setMetrics] = useState<MetricDraft[]>(
    (treatment?.metrics ?? []).map((m) => ({ id: m.id, name: m.name, unit: m.unit ?? '', value_type: m.value_type }))
  );
  const [removedMetricIds, setRemovedMetricIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = conditionData?.conditions ?? [];

  const applyTemplate = (templateName: string) => {
    const tpl = TREATMENT_TEMPLATES.find((t) => t.name === templateName);
    if (!tpl) return;
    setName(tpl.name);
    setCategory(tpl.category);
    setFrequency(tpl.frequency);
    setMetrics(tpl.metrics.map((m) => ({ id: null, name: m.name, unit: m.unit ?? '', value_type: m.value_type })));
  };

  const setMetric = (i: number, patch: Partial<MetricDraft>) =>
    setMetrics((prev) => prev.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const removeMetric = (i: number) => {
    const m = metrics[i];
    if (m.id) setRemovedMetricIds((prev) => [...prev, m.id!]);
    setMetrics((prev) => prev.filter((_, j) => j !== i));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        category,
        medical_condition_name: condition.trim() || '',
        frequency: frequency.trim() || null,
        as_needed: asNeeded,
        instructions: instructions.trim() || null,
        active,
      };
      const cleanMetrics = metrics
        .map((m, i) => ({ ...m, name: m.name.trim(), unit: m.unit.trim(), sort_order: i }))
        .filter((m) => m.name);
      if (!treatment) {
        await api.post(`/care-profiles/${profileId}/treatments`, {
          ...body,
          metrics: cleanMetrics.map((m) => ({ name: m.name, unit: m.unit || null, value_type: m.value_type, sort_order: m.sort_order })),
        });
        return;
      }
      await api.patch(`/care-profiles/${profileId}/treatments/${treatment.id}`, body);
      // Measures are synced one by one: removed, changed, then added.
      for (const id of removedMetricIds) {
        await api.delete(`/care-profiles/${profileId}/treatments/${treatment.id}/metrics/${id}`);
      }
      for (const m of cleanMetrics) {
        const payload = { name: m.name, unit: m.unit || null, value_type: m.value_type, sort_order: m.sort_order };
        if (m.id) {
          const original = treatment.metrics.find((x) => x.id === m.id);
          const unchanged = original && original.name === m.name && (original.unit ?? '') === m.unit
            && original.value_type === m.value_type && original.sort_order === m.sort_order;
          if (!unchanged) await api.patch(`/care-profiles/${profileId}/treatments/${treatment.id}/metrics/${m.id}`, payload);
        } else {
          await api.post(`/care-profiles/${profileId}/treatments/${treatment.id}/metrics`, payload);
        }
      }
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profileId}/treatments/${treatment!.id}`),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to delete'),
  });

  return (
    <Modal open onClose={onClose} title={treatment ? 'Edit treatment' : 'Add treatment'} wide>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }}>
        {!treatment ? (
          <div>
            <label htmlFor="treatment-template" className="block text-sm font-medium text-ink mb-1">Start from a ready-made set-up</label>
            <select id="treatment-template" className={`${SELECT} w-full`} defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Set up from scratch</option>
              {TREATMENT_TEMPLATES.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">A set-up fills in the name and measures; everything stays editable.</p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. CPAP therapy" />
          <div>
            <label htmlFor="treatment-category" className="block text-sm font-medium text-ink mb-1">Kind of treatment</label>
            <select id="treatment-category" className={`${SELECT} w-full`} value={category} onChange={(e) => setCategory(e.target.value)}>
              {TREATMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">{TREATMENT_CATEGORIES.find((c) => c.value === category)?.description}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input label="Manages the condition" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. Sleep apnoea" list="treatment-condition-options" hint="A condition that isn't already recorded is added to this person's conditions." />
            <datalist id="treatment-condition-options">
              {conditions.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
          </div>
          <Input label="How often" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. Every night" />
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-1.5 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={asNeeded} onChange={(e) => setAsNeeded(e.target.checked)} />
            Only when needed
          </label>
          {treatment ? (
            <label className="inline-flex items-center gap-1.5 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active
            </label>
          ) : null}
        </div>

        <Textarea label="Instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} placeholder="Anything a carer should know when doing this" />

        <section>
          <h3 className="text-sm font-semibold text-ink">What each session records</h3>
          <p className="text-xs text-muted mb-2">
            One row per measure, in the unit the device or therapy reports. A CPAP machine reports hours used and
            events per hour, not tablets taken.
          </p>
          <div className="space-y-2">
            {metrics.map((m, i) => (
              <div key={m.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2">
                <input
                  className={`${SELECT} flex-1 min-w-40`}
                  aria-label="Measure name"
                  placeholder="e.g. Hours used"
                  value={m.name}
                  onChange={(e) => setMetric(i, { name: e.target.value })}
                />
                <input
                  className={`${SELECT} w-40`}
                  aria-label="Unit"
                  placeholder="e.g. hours"
                  value={m.unit}
                  onChange={(e) => setMetric(i, { unit: e.target.value })}
                />
                <select
                  className={SELECT}
                  aria-label="Kind of value"
                  value={m.value_type}
                  onChange={(e) => setMetric(i, { value_type: e.target.value as MetricDraft['value_type'] })}
                >
                  {METRIC_VALUE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <button type="button" aria-label="Remove measure" className="text-muted hover:text-red-600 text-sm px-1" onClick={() => removeMetric(i)}>✕</button>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => setMetrics((prev) => [...prev, { id: null, name: '', unit: '', value_type: 'number' }])}>
            Add measure
          </Button>
          {removedMetricIds.length > 0 ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Removing a measure also removes its past readings when you save.</p>
          ) : null}
        </section>

        {treatment ? <DeviceKeysSection profileId={profileId} treatmentId={treatment.id} /> : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex items-center justify-between gap-2">
          {treatment ? (
            <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete treatment</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>Save</Button>
          </div>
        </div>
      </form>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete treatment">
        <p className="text-sm text-muted mb-4">
          Permanently delete <span className="font-medium text-ink">{treatment?.name}</span>? Its session history and
          device keys are removed too. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>Delete</Button>
        </div>
      </Modal>
    </Modal>
  );
}

/**
 * The treatment's device keys: credentials a machine uses to push its own
 * readings through the device API. The secret shows once, at creation.
 */
function DeviceKeysSection({ profileId, treatmentId }: { profileId: string; treatmentId: string }) {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [freshToken, setFreshToken] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const base = `/care-profiles/${profileId}/treatments/${treatmentId}/device-keys`;
  const { data } = useQuery({
    queryKey: ['device-keys', profileId, treatmentId],
    queryFn: () => api.get<{ device_keys: DeviceKey[] }>(base),
  });
  const keys = data?.device_keys ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['device-keys', profileId, treatmentId] });

  const create = useMutation({
    mutationFn: () => api.post<{ device_key: DeviceKey; token: string }>(base, { name: newKeyName.trim() }),
    onSuccess: (res) => {
      setFreshToken({ name: res.device_key.name, token: res.token });
      setNewKeyName('');
      setCopied(false);
      invalidate();
    },
  });
  const revoke = useMutation({
    mutationFn: (keyId: string) => api.delete(`${base}/${keyId}`),
    onSuccess: invalidate,
  });

  const copyToken = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-ink">Device access</h3>
      <p className="text-xs text-muted mb-2">
        A device key lets a machine, like the CPAP unit itself or a bridge app, push its readings straight into the
        session log through the device API. Each key works for this treatment only.
      </p>
      {keys.length > 0 ? (
        <ul className="space-y-1.5 mb-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-2 text-sm">
              <span className="font-medium text-ink">{k.name}</span>
              <span className="text-xs text-muted">{k.token_prefix}…</span>
              <span className="text-xs text-muted flex-1">
                {k.last_used_at ? `Last used ${formatDistanceToNow(new Date(k.last_used_at), { addSuffix: true })}` : 'Never used'}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => revoke.mutate(k.id)}>Revoke</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {freshToken ? (
        <div className="mb-2 rounded-md border border-border bg-surface-2 p-3 space-y-1">
          <p className="text-xs font-medium text-ink">Key for {freshToken.name}. Copy it now; it is only shown once.</p>
          <div className="flex items-center gap-2">
            <code className="text-xs break-all flex-1">{freshToken.token}</code>
            <Button type="button" variant="secondary" size="sm" onClick={() => void copyToken()}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
      ) : null}
      <div className="flex gap-2">
        <div className="flex-1">
          <Input aria-label="Device name" placeholder="e.g. Bedroom CPAP machine" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={!newKeyName.trim()} loading={create.isPending} onClick={() => create.mutate()}>
          Create key
        </Button>
      </div>
    </section>
  );
}
