import { CONDITION_CATEGORIES, CONDITION_SEVERITIES, CONDITION_STATUSES, CONDITION_TYPES, EXPECTED_DURATIONS } from '../../../../lib/care';
import { inputClass } from './shared';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import { CatalogueCombo } from '../../../../components/CatalogueCombo';
import { ManagedWithSection, persistManagedRows, type ManagedRow } from '../ManagedWith';
import { SymptomsSection } from '../ConditionSymptoms';
import { CodesSection } from './CodesSection';
import { FunctionsSection } from './FunctionsSection';
import type { MedicalCondition } from '../../../../lib/care';

export function ConditionEditor({
  profileId,
  careName,
  condition,
  onClose,
  onSaved,
}: {
  profileId: string;
  careName: string;
  condition: MedicalCondition | null;
  onClose: () => void;
  onSaved: (saved: MedicalCondition) => void;
}) {
  const isNew = condition === null;
  const queryClient = useQueryClient();
  const [name, setName] = useState(condition?.name ?? '');
  const [category, setCategory] = useState(condition?.category ?? '');
  const [conditionType, setConditionType] = useState(condition?.condition_type ?? '');
  const [severity, setSeverity] = useState(condition?.severity ?? '');
  const [baselineSeverity, setBaselineSeverity] = useState(condition?.baseline_severity != null ? String(condition.baseline_severity) : '');
  const [status, setStatus] = useState(condition?.status ?? 'active');
  const [startedOn, setStartedOn] = useState(condition?.started_on ?? '');
  const [resolvedOn, setResolvedOn] = useState(condition?.resolved_on ?? '');
  const [expectedDuration, setExpectedDuration] = useState(condition?.expected_duration ?? '');
  const [isPermanent, setIsPermanent] = useState(condition?.is_permanent ?? false);
  const [isContagious, setIsContagious] = useState(condition?.is_contagious ?? false);
  const [isolationRequired, setIsolationRequired] = useState(condition?.isolation_required ?? false);
  const [region, setRegion] = useState(condition?.region ?? '');
  const [managedRows, setManagedRows] = useState<ManagedRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!condition) return;
    setName(condition.name);
    setCategory(condition.category ?? '');
    setConditionType(condition.condition_type ?? '');
    setSeverity(condition.severity ?? '');
    setBaselineSeverity(condition.baseline_severity != null ? String(condition.baseline_severity) : '');
    setStatus(condition.status);
    setStartedOn(condition.started_on ?? '');
    setResolvedOn(condition.resolved_on ?? '');
    setExpectedDuration(condition.expected_duration ?? '');
    setIsPermanent(condition.is_permanent ?? false);
    setIsContagious(condition.is_contagious ?? false);
    setIsolationRequired(condition.isolation_required ?? false);
    setRegion(condition.region ?? '');
    setManagedRows([]);
  }, [condition]);

  const showIllnessFields = category === 'illness' || category === 'acute_illness' || category === 'chronic_flare';

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        category: category || null,
        condition_type: conditionType || null,
        severity: severity || null,
        baseline_severity: baselineSeverity ? Number(baselineSeverity) : null,
        status,
        started_on: startedOn || null,
        resolved_on: resolvedOn || null,
        expected_duration: expectedDuration || null,
        is_permanent: conditionType === 'disability' ? isPermanent : null,
        is_contagious: isContagious,
        isolation_required: isolationRequired,
        region: region.trim() || null,
      };
      const res = isNew
        ? await api.post<{ condition: MedicalCondition }>(`/care-profiles/${profileId}/conditions`, body)
        : await api.patch<{ condition: MedicalCondition }>(`/care-profiles/${profileId}/conditions/${condition.id}`, body);
      // Everything managing the condition is saved once the condition exists.
      await persistManagedRows(profileId, res.condition.id, managedRows);
      return res;
    },
    onSuccess: (res) => {
      setManagedRows([]);
      void queryClient.invalidateQueries({ queryKey: ['medications', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['treatments', profileId] });
      onSaved(res.condition);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the condition.'),
  });

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add condition' : `Edit ${condition.name}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
          <span className="font-medium">{careName}</span>
          <span>has</span>
          <CatalogueCombo
            endpoint="/condition-catalogue"
            ariaLabel="Condition name"
            placeholder="Type to search, e.g. Type 2 diabetes"
            initial={name}
            keepValue
            onPick={setName}
            widthClass="w-64"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Category</span>
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Not set</option>
              {CONDITION_CATEGORIES.filter((c) => c.value !== 'neurotype').map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Type</span>
            <select className={inputClass} value={conditionType} onChange={(e) => setConditionType(e.target.value)}>
              <option value="">Work out from the dates</option>
              {CONDITION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted mt-1">
              {CONDITION_TYPES.find((t) => t.value === conditionType)?.description ??
                'Left blank, a resolved condition counts as acute and one running over three months as chronic.'}
            </p>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Severity</span>
            <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Not set</option>
              {CONDITION_SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Normal level</span>
            <select className={inputClass} value={baselineSeverity} onChange={(e) => setBaselineSeverity(e.target.value)}>
              <option value="">Not set</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n} out of 10</option>
              ))}
            </select>
            <p className="text-xs text-muted mt-1">
              This person's usual level on the 1 to 10 symptom scale for a long-term condition. A health alert is raised
              only when a symptom rises above it, so a condition that sits high every day does not alarm at its normal.
            </p>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Status</span>
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {CONDITION_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <Input
            label="Started"
            type="date"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
          />
          <Input
            label="Resolved"
            type="date"
            value={resolvedOn}
            onChange={(e) => setResolvedOn(e.target.value)}
            hint="Filling this marks the condition resolved."
          />
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Expected duration</span>
            <select className={inputClass} value={expectedDuration} onChange={(e) => setExpectedDuration(e.target.value)}>
              <option value="">Not set</option>
              {EXPECTED_DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </label>
          {conditionType === 'disability' ? (
            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                checked={isPermanent}
                onChange={(e) => setIsPermanent(e.target.checked)}
              />
              <span className="text-sm text-ink">Permanent, not expected to improve</span>
            </label>
          ) : null}
          {showIllnessFields ? (
            <>
              <label className="flex items-center gap-2 self-end pb-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={isContagious}
                  onChange={(e) => setIsContagious(e.target.checked)}
                />
                <span className="text-sm text-ink">Contagious</span>
              </label>
              <label className="flex items-center gap-2 self-end pb-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={isolationRequired}
                  onChange={(e) => setIsolationRequired(e.target.checked)}
                />
                <span className="text-sm text-ink">Isolation required</span>
              </label>
            </>
          ) : null}
          {(category === 'injury' || showIllnessFields) ? (
            <Input
              label="Body region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              hint="Where on the body, if applicable"
            />
          ) : null}
        </div>

        <ManagedWithSection
          profileId={profileId}
          careName={careName}
          conditionName={name}
          condition={condition}
          rows={managedRows}
          onRowsChange={setManagedRows}
        />

        {!isNew ? (
          <>
            <CodesSection profileId={profileId} condition={condition} />
            <FunctionsSection profileId={profileId} condition={condition} />
          </>
        ) : null}

        {showIllnessFields && !isNew ? (
          <SymptomsSection profileId={profileId} conditionId={condition.id} />
        ) : null}

        {isNew && showIllnessFields ? (
          <p className="text-xs text-muted">
            Symptoms can be added straight after saving.
          </p>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={saveMutation.isPending} disabled={!name.trim()} onClick={() => saveMutation.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
