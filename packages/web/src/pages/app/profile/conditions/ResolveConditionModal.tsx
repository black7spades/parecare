import { useState } from 'react';
import { format } from '../../../../lib/dateFormat';
import { Button } from '../../../../components/ui/Button';
import { Input, Textarea } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import { CONDITION_RESOLUTION_REASONS } from '../../../../lib/care';
import { inputClass } from './shared';

export interface ResolutionDetails {
  resolved_on?: string;
  resolution_reason?: string;
  resolution_notes?: string;
}

/**
 * Why a condition resolved, as two inputs. Shared by the Resolve step and the
 * condition editor so both ask the same way.
 */
export function ResolutionFields({
  reason,
  onReason,
  notes,
  onNotes,
}: {
  reason: string;
  onReason: (v: string) => void;
  notes: string;
  onNotes: (v: string) => void;
}) {
  return (
    <>
      <label className="block">
        <span className="block text-sm font-medium text-ink mb-1">Why it resolved</span>
        <select className={inputClass} value={reason} onChange={(e) => onReason(e.target.value)}>
          <option value="">Not set</option>
          {CONDITION_RESOLUTION_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-2">
        <Textarea
          label="What happened"
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="For example: cleared up after the second course of antibiotics, confirmed by Dr Lee at the follow-up"
        />
      </div>
    </>
  );
}

/**
 * Mark one or more conditions resolved. Every field is optional: pressing
 * Mark resolved straight away just stops tracking them, and nothing is
 * guessed. A carer who wants the full story records when, why and what
 * happened.
 */
export function ResolveConditionModal({
  names,
  onClose,
  onConfirm,
}: {
  names: string[];
  onClose: () => void;
  onConfirm: (details: ResolutionDetails) => void;
}) {
  const [resolvedOn, setResolvedOn] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const title = names.length === 1 ? `Resolve ${names[0]}` : `Resolve ${names.length} conditions`;

  return (
    <Modal open onClose={onClose} title={title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm({
            ...(resolvedOn ? { resolved_on: resolvedOn } : {}),
            ...(reason ? { resolution_reason: reason } : {}),
            ...(notes.trim() ? { resolution_notes: notes.trim() } : {}),
          });
        }}
      >
        <p className="text-sm text-muted">
          Everything here is optional. Leave it blank to stop tracking{' '}
          {names.length === 1 ? 'it' : 'them'}, or add the detail for the record.
        </p>
        <Input
          label="When it resolved"
          type="date"
          value={resolvedOn}
          max={format(new Date(), 'yyyy-MM-dd')}
          onChange={(e) => setResolvedOn(e.target.value)}
          hint="Leave blank if you are not sure."
        />
        <ResolutionFields reason={reason} onReason={setReason} notes={notes} onNotes={setNotes} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Mark resolved</Button>
        </div>
      </form>
    </Modal>
  );
}
