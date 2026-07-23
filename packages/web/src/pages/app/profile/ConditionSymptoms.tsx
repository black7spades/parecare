import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { CrossIcon } from '../../../components/ui/icons';
import { SymptomCourseChart } from './SymptomCourseChart';
import type { ConditionSymptom } from '../../../lib/care';

/** The word for a point on the 1 to 10 severity scale. */
export const severityLabel = (v: number): string =>
  v <= 2 ? 'Mild' : v <= 4 ? 'Low' : v <= 6 ? 'Moderate' : v <= 8 ? 'High' : 'Severe';

/**
 * The symptom tracker for one condition: each symptom with its severity
 * slider, its dated course of readings, and the add form. Shared between
 * the Conditions editor and the Current Health card on the overview, so
 * a symptom change logged in either place lands on the same record.
 */
export function SymptomsSection({
  profileId,
  conditionId,
  canEdit = true,
  showIntro = true,
}: {
  profileId: string;
  conditionId: string;
  canEdit?: boolean;
  showIntro?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['symptoms', conditionId],
    queryFn: () =>
      api.get<{ symptoms: ConditionSymptom[] }>(
        `/care-profiles/${profileId}/conditions/${conditionId}/symptoms`
      ),
  });
  const symptoms = data?.symptoms ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['symptoms', conditionId] });
    void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
  };

  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-ink mb-1">Symptoms</h3>
      {showIntro ? (
        <p className="text-xs text-muted mb-2">
          Track how this condition feels over time. Severity runs from 1 (mild) to 10 (severe); slide it up
          or down as things progress and every change is kept as a dated reading.
        </p>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : symptoms.length === 0 ? (
        <p className="text-sm text-muted">No symptoms recorded yet.</p>
      ) : (
        <>
          <div className="space-y-1">
            {symptoms.map((sym) => (
              <SymptomRow
                key={sym.id}
                symptom={sym}
                profileId={profileId}
                conditionId={conditionId}
                canEdit={canEdit}
                onChanged={invalidate}
              />
            ))}
          </div>
          <SymptomCourseChart symptoms={symptoms} />
        </>
      )}
      {canEdit ? <SymptomForm profileId={profileId} conditionId={conditionId} onSaved={invalidate} /> : null}
    </div>
  );
}

export function SymptomRow({
  symptom,
  profileId,
  conditionId,
  canEdit = true,
  onChanged,
}: {
  symptom: ConditionSymptom;
  profileId: string;
  conditionId: string;
  canEdit?: boolean;
  onChanged: () => void;
}) {
  // The slider holds a pending value; nothing is logged until Save. Cancel
  // returns it to the last saved severity, so a stray drag records nothing.
  const [severity, setSeverity] = useState(symptom.severity);
  useEffect(() => setSeverity(symptom.severity), [symptom.severity]);
  const dirty = severity !== symptom.severity;

  const severityMutation = useMutation({
    mutationFn: (value: number) =>
      api.patch(`/care-profiles/${profileId}/conditions/${conditionId}/symptoms/${symptom.id}`, {
        severity: value,
      }),
    onSuccess: onChanged,
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/conditions/${conditionId}/symptoms/${symptom.id}`, {
        resolved_at: symptom.resolved_at ? null : new Date().toISOString(),
      }),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api.delete(`/care-profiles/${profileId}/conditions/${conditionId}/symptoms/${symptom.id}`),
    onSuccess: onChanged,
  });

  return (
    <div className="py-2 border-b border-border last:border-0">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={`font-medium ${symptom.resolved_at ? 'line-through text-muted' : 'text-ink'}`}>
          {symptom.name}
        </span>
        <span className="text-xs text-muted whitespace-nowrap">
          since {format(new Date(symptom.noted_at), 'd MMM')}
        </span>
        {symptom.resolved_at ? null : canEdit ? (
          <span className="flex items-center gap-2 flex-1 min-w-[10rem] max-w-xs">
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={severity}
              aria-label={`Severity of ${symptom.name}`}
              className="flex-1 accent-primary"
              onChange={(e) => setSeverity(Number(e.target.value))}
            />
            <span className={`text-xs whitespace-nowrap w-24 ${dirty ? 'text-ink font-medium' : 'text-muted'}`}>
              {severity}/10 {severityLabel(severity)}
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted whitespace-nowrap">
            {symptom.severity}/10 {severityLabel(symptom.severity)}
          </span>
        )}
        {canEdit ? (
          <span className="flex items-center gap-1 ml-auto">
            {dirty && !symptom.resolved_at ? (
              <>
                <Button size="xs" variant="ghost" onClick={() => setSeverity(symptom.severity)}>
                  Cancel
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  loading={severityMutation.isPending}
                  onClick={() => severityMutation.mutate(severity)}
                >
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button size="xs" variant="ghost" onClick={() => resolveMutation.mutate()}>
                  {symptom.resolved_at ? 'Reopen' : 'Resolve'}
                </Button>
                <Button size="xs" variant="ghost-danger" aria-label="Remove symptom" title="Remove" onClick={() => deleteMutation.mutate()}>
                  <CrossIcon />
                </Button>
              </>
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function SymptomForm({
  profileId,
  conditionId,
  onSaved,
}: {
  profileId: string;
  conditionId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [severity, setSeverity] = useState(5);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data: suggestionData } = useQuery({
    queryKey: ['symptom-catalogue', name],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>(`/symptom-catalogue?search=${encodeURIComponent(name)}`),
    enabled: name.trim().length > 0,
  });
  const suggestions = (suggestionData?.items ?? []).slice(0, 8);
  const trimmed = name.trim();
  const exactMatch = suggestions.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  const options = [...suggestions.map((s) => s.name), ...(trimmed && !exactMatch ? [trimmed] : [])];

  useEffect(() => { setHighlight(0); }, [name]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const mutation = useMutation({
    mutationFn: (symptomName: string) =>
      api.post(`/care-profiles/${profileId}/conditions/${conditionId}/symptoms`, {
        name: symptomName,
        severity,
      }),
    onSuccess: () => {
      setName('');
      setSeverity(5);
      setOpen(false);
      onSaved();
    },
  });

  const submit = (n: string) => {
    if (!n.trim() || mutation.isPending) return;
    mutation.mutate(n.trim());
  };

  return (
    <div className="flex flex-wrap items-end gap-2 mt-3">
      <div className="flex-1 min-w-[12rem] relative" ref={boxRef}>
        <label className="block text-sm font-medium text-ink mb-1">Symptom</label>
        <input
          type="text"
          role="combobox"
          aria-expanded={open && options.length > 0}
          placeholder="Type to search symptoms..."
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          value={name}
          onChange={(e) => { setName(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, options.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (options[highlight]) submit(options[highlight]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {open && options.length > 0 ? (
          <ul className="absolute left-0 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg z-20">
            {options.map((n, i) => {
              const isNew = i >= suggestions.length;
              return (
                <li key={`${n}-${isNew}`}>
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-1.5 text-sm ${i === highlight ? 'bg-primary-50 text-primary' : 'text-ink hover:bg-surface-2'}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => submit(n)}
                  >
                    {isNew ? <>Add &ldquo;{n}&rdquo; as a new symptom</> : n}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div className="w-56">
        <label htmlFor="new-symptom-severity" className="block text-sm font-medium text-ink mb-1">
          Severity
        </label>
        <span className="flex items-center gap-2 pb-2">
          <input
            id="new-symptom-severity"
            type="range"
            min={1}
            max={10}
            step={1}
            value={severity}
            className="flex-1 accent-primary"
            onChange={(e) => setSeverity(Number(e.target.value))}
          />
          <span className="text-xs text-muted whitespace-nowrap w-24">
            {severity}/10 {severityLabel(severity)}
          </span>
        </span>
      </div>
      <Button size="sm" loading={mutation.isPending} disabled={!name.trim()} onClick={() => submit(name)}>
        Add symptom
      </Button>
    </div>
  );
}
