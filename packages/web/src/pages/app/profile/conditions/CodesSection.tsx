import { Input } from '../../../../components/ui/Input';
import { CrossIcon } from '../../../../components/ui/icons';
import { CODE_SYSTEMS, codeSystemLabel } from '../../../../lib/care';
import { inputClass } from './shared';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import type { ConditionCode, MedicalCondition } from '../../../../lib/care';


export function CodesSection({ profileId, condition }: { profileId: string; condition: MedicalCondition }) {
  const queryClient = useQueryClient();
  const [codes, setCodes] = useState<ConditionCode[]>(condition.codes ?? []);
  const [system, setSystem] = useState<'icd10' | 'snomed'>('icd10');
  const [code, setCode] = useState('');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });

  const addMutation = useMutation({
    mutationFn: () =>
      api.post<{ code: ConditionCode }>(`/care-profiles/${profileId}/conditions/${condition.id}/codes`, {
        system,
        code: code.trim(),
      }),
    onSuccess: (res) => {
      if (res.code && !codes.some((c) => c.id === res.code.id)) setCodes([...codes, res.code]);
      setCode('');
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (codeId: string) =>
      api.delete(`/care-profiles/${profileId}/conditions/${condition.id}/codes/${codeId}`),
    onSuccess: (_res, codeId) => {
      setCodes(codes.filter((c) => c.id !== codeId));
      invalidate();
    },
  });

  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-ink mb-1">Standard codes</h3>
      <p className="text-xs text-muted mb-2">
        ICD-10 and SNOMED CT codes let this record work with hospital and clinic systems.
      </p>
      <div className="space-y-1.5">
        {codes.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-sm">
            <span className="badge bg-surface-2 text-muted text-xs w-24 justify-center">{codeSystemLabel(c.system)}</span>
            <span className="font-mono text-ink">{c.code}</span>
            <Button size="xs" variant="ghost-danger" className="ml-auto" aria-label={`Remove code ${c.code}`} title="Remove" onClick={() => removeMutation.mutate(c.id)}>
              <CrossIcon />
            </Button>
          </div>
        ))}
        {codes.length === 0 ? <p className="text-sm text-muted">No codes recorded.</p> : null}
      </div>
      <div className="flex items-end gap-2 mt-2">
        <label className="block">
          <span className="block text-xs text-muted mb-1">System</span>
          <select
            className={inputClass}
            value={system}
            onChange={(e) => setSystem(e.target.value as 'icd10' | 'snomed')}
          >
            {CODE_SYSTEMS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <div className="flex-1">
          <Input
            label="Code"
            placeholder={system === 'icd10' ? 'e.g. E11.9' : 'e.g. 44054006'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <Button size="sm" variant="secondary" disabled={!code.trim()} loading={addMutation.isPending} onClick={() => addMutation.mutate()}>
          Add code
        </Button>
      </div>
    </div>
  );
}
