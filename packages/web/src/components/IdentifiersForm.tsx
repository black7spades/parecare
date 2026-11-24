import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { CatalogueCombo } from './CatalogueCombo';
import { DVA_CARD_COLOURS, type IdentifierField, type Identifiers } from '../lib/care';

type Draft = Record<IdentifierField, string>;

const EMPTY: Draft = {
  medicare_number: '', medicare_irn: '', medicare_valid_to: '', ihi_number: '', dva_number: '', dva_card_colour: '',
  ndis_number: '', health_fund_name: '', health_fund_member_number: '', my_aged_care_number: '',
};

/** The month on the card, MM/YYYY, from the last day of that month. */
const toCardMonth = (d: string | null) => (d && /^\d{4}-\d{2}/.test(d) ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : '');

const fromSaved = (ids: Identifiers): Draft => ({
  medicare_number: ids.medicare_number ?? '',
  medicare_irn: ids.medicare_irn ? String(ids.medicare_irn) : '',
  medicare_valid_to: toCardMonth(ids.medicare_valid_to),
  ihi_number: ids.ihi_number ?? '',
  dva_number: ids.dva_number ?? '',
  dva_card_colour: ids.dva_card_colour ?? '',
  ndis_number: ids.ndis_number ?? '',
  health_fund_name: ids.health_fund_name ?? '',
  health_fund_member_number: ids.health_fund_member_number ?? '',
  my_aged_care_number: ids.my_aged_care_number ?? '',
});

const SELECT = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * A person's ID numbers, each in its own box. Each number is checked as it is
 * saved; one that does not look right is kept in its box with what it should
 * look like, and every other number still saves.
 */
export function IdentifiersForm({ profileId, canEdit, onSaved }: { profileId: string; canEdit: boolean; onSaved?: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['identifiers', profileId],
    queryFn: () => api.get<{ identifiers: Identifiers }>(`/care-profiles/${profileId}/identifiers`),
  });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problems, setProblems] = useState<Partial<Record<IdentifierField, string>>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  // The boxes show once the saved numbers are in them.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (data?.identifiers && !ready) {
      setDraft(fromSaved(data.identifiers));
      setReady(true);
    }
  }, [data, ready]);

  const set = (k: IdentifierField) => (v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setNote('');
  };

  const save = useMutation({
    // Only the boxes that changed go, so nothing on file is cleared by accident.
    mutationFn: () => {
      const before = data?.identifiers ? fromSaved(data.identifiers) : EMPTY;
      const changed = Object.fromEntries((Object.keys(draft) as IdentifierField[]).filter((k) => draft[k] !== before[k]).map((k) => [k, draft[k]]));
      return api.put<{ identifiers: Identifiers; problems: Partial<Record<IdentifierField, string>>; saved: IdentifierField[] }>(`/care-profiles/${profileId}/identifiers`, changed);
    },
    onSuccess: (res) => {
      setError('');
      setProblems(res.problems ?? {});
      // Keep what was typed in a box that did not save, so nothing is lost.
      const kept = Object.keys(res.problems ?? {}) as IdentifierField[];
      setDraft((d) => {
        const next = fromSaved(res.identifiers);
        for (const k of kept) next[k] = d[k];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['identifiers', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['emergency-sheet', profileId] });
      if (kept.length) {
        setNote(`${kept.length === 1 ? 'One number' : `${kept.length} numbers`} did not save. The rest are saved.`);
      } else {
        setNote('Saved.');
        onSaved?.();
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The ID numbers could not be saved. Try again in a moment.'),
  });

  if (isLoading || (data && !ready)) return <p className="text-sm text-muted">Loading…</p>;
  if (isError || !data) {
    // Never show empty boxes that could be saved over the numbers on file.
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600" role="alert">The ID numbers on file could not be loaded just now, so they cannot be changed yet. Check the connection and try again.</p>
        <Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }

  const box = (k: IdentifierField, label: string, extra: { hint?: string; placeholder?: string; inputMode?: 'numeric' | 'text' } = {}) => (
    <Input
      label={label}
      value={draft[k]}
      onChange={(e) => set(k)(e.target.value)}
      error={problems[k]}
      hint={extra.hint}
      placeholder={extra.placeholder}
      inputMode={extra.inputMode}
      disabled={!canEdit}
      autoComplete="off"
    />
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink mb-1">Medicare</legend>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem]">
          {box('medicare_number', 'Medicare number', { placeholder: '2123 45670 1', inputMode: 'numeric' })}
          {box('medicare_irn', 'Position on the card', { placeholder: '1', inputMode: 'numeric', hint: 'The number beside their name.' })}
          {box('medicare_valid_to', 'Valid to', { placeholder: 'MM/YYYY' })}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink mb-1">My Health Record</legend>
        {box('ihi_number', 'Individual Healthcare Identifier', { hint: '16 digits, starts with 8003. It is on My Health Record.', inputMode: 'numeric' })}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink mb-1">Veterans</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {box('dva_number', 'DVA file number', { placeholder: 'NX123456' })}
          <div>
            <label htmlFor={`dva-colour-${profileId}`} className="block text-sm font-medium text-ink mb-1">DVA card colour</label>
            <select id={`dva-colour-${profileId}`} className={SELECT} value={draft.dva_card_colour} disabled={!canEdit} onChange={(e) => set('dva_card_colour')(e.target.value)}>
              <option value="">No DVA card</option>
              {DVA_CARD_COLOURS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            {problems.dva_card_colour ? <p className="mt-1 text-xs text-red-600">{problems.dva_card_colour}</p> : null}
          </div>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink mb-1">NDIS</legend>
        {box('ndis_number', 'NDIS number', { hint: '9 digits, starts with 43.', inputMode: 'numeric' })}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink mb-1">Private health</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="block text-sm font-medium text-ink mb-1">Health fund</span>
            {canEdit ? (
              <CatalogueCombo
                endpoint="/option-catalogue?category=health_fund"
                ariaLabel="Health fund"
                placeholder="e.g. Medibank"
                initial={draft.health_fund_name}
                keepValue
                onPick={set('health_fund_name')}
                widthClass="w-full"
              />
            ) : (
              <p className="text-sm text-ink">{draft.health_fund_name || 'Not recorded'}</p>
            )}
            {problems.health_fund_name ? <p className="mt-1 text-xs text-red-600">{problems.health_fund_name}</p> : null}
          </div>
          {box('health_fund_member_number', 'Member number')}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink mb-1">Aged care</legend>
        {box('my_aged_care_number', 'My Aged Care number', { hint: 'Starts with AC.', placeholder: 'AC12345678' })}
      </fieldset>
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {canEdit ? (
        <div className="flex items-center justify-end gap-3">
          {note ? <p className="text-sm text-muted" role="status">{note}</p> : null}
          <Button type="submit" loading={save.isPending}>Save ID numbers</Button>
        </div>
      ) : null}
    </form>
  );
}
