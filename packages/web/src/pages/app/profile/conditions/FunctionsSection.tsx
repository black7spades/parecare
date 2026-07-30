import { CrossIcon } from '../../../../components/ui/icons';
import { Input } from '../../../../components/ui/Input';
import { FUNCTION_DOMAINS, LIMITATION_LEVELS, TEMPORAL_PATTERNS, functionDomainLabel, temporalPatternLabel } from '../../../../lib/care';
import { inputClass } from './shared';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import type { ConditionFunction, MedicalCondition } from '../../../../lib/care';


export function FunctionsSection({ profileId, condition }: { profileId: string; condition: MedicalCondition }) {
  const queryClient = useQueryClient();
  const [functions, setFunctions] = useState<ConditionFunction[]>(condition.functions ?? []);
  const [domain, setDomain] = useState('mobility');
  const [level, setLevel] = useState('moderate');
  const [pattern, setPattern] = useState('');
  const [impact, setImpact] = useState('');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });

  const addMutation = useMutation({
    mutationFn: () =>
      api.post<{ function: ConditionFunction }>(`/care-profiles/${profileId}/conditions/${condition.id}/functions`, {
        domain,
        limitation_level: level,
        temporal_pattern: pattern || null,
        impact_on_activities: impact.trim() || null,
      }),
    onSuccess: (res) => {
      setFunctions([...functions, res.function]);
      setImpact('');
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (fnId: string) =>
      api.delete(`/care-profiles/${profileId}/conditions/${condition.id}/functions/${fnId}`),
    onSuccess: (_res, fnId) => {
      setFunctions(functions.filter((f) => f.id !== fnId));
      invalidate();
    },
  });

  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-ink mb-1">Functional impact</h3>
      <p className="text-xs text-muted mb-2">
        Which parts of daily life this limits, how much, and whether that is changing.
      </p>
      <div className="space-y-1.5">
        {functions.map((f) => (
          <div key={f.id} className="flex items-start gap-2 text-sm">
            <span className="badge bg-surface-2 text-ink text-xs">{functionDomainLabel(f.domain)}</span>
            <span className="text-ink capitalize">{f.limitation_level}</span>
            {f.temporal_pattern ? <span className="text-muted">{temporalPatternLabel(f.temporal_pattern)}</span> : null}
            {f.impact_on_activities ? <span className="text-muted flex-1">{f.impact_on_activities}</span> : null}
            <Button size="xs" variant="ghost-danger" className="ml-auto" aria-label={`Remove ${functionDomainLabel(f.domain)} limitation`} title="Remove" onClick={() => removeMutation.mutate(f.id)}>
              <CrossIcon />
            </Button>
          </div>
        ))}
        {functions.length === 0 ? <p className="text-sm text-muted">No functional impact recorded.</p> : null}
      </div>
      <div className="grid sm:grid-cols-2 gap-2 mt-2">
        <label className="block">
          <span className="block text-xs text-muted mb-1">Affected area</span>
          <select className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value)}>
            {FUNCTION_DOMAINS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">How limited</span>
          <select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LIMITATION_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Pattern</span>
          <select className={inputClass} value={pattern} onChange={(e) => setPattern(e.target.value)}>
            <option value="">Not set</option>
            {TEMPORAL_PATTERNS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        <div>
          <Input
            label="What it means day to day"
            placeholder="e.g. Cannot stand longer than 10 minutes"
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end mt-2">
        <Button size="sm" variant="secondary" loading={addMutation.isPending} onClick={() => addMutation.mutate()}>
          Add impact
        </Button>
      </div>
    </div>
  );
}
