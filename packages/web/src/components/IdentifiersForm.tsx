import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { CatalogueCombo } from './CatalogueCombo';
import { type IdentifierField, type Identifiers } from '../lib/care';
import { useProfileCountry } from '../lib/country';

type Draft = Partial<Record<IdentifierField, string>>;

/** The month on the card, MM/YYYY, from the last day of that month. */
const toCardMonth = (d: string | null) => (d && /^\d{4}-\d{2}/.test(d) ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : '');

/** Every number on file as its box shows it; the boxes shown come from the person's country. */
const fromSaved = (ids: Identifiers): Draft =>
  Object.fromEntries(
    (Object.keys(ids) as IdentifierField[]).map((k) => {
      const v = ids[k];
      if (k === 'medicare_valid_to') return [k, toCardMonth(v as string | null)];
      return [k, v === null || v === undefined ? '' : String(v)];
    })
  ) as Draft;

const differs = (a: Draft, b: Draft) =>
  Object.fromEntries((Object.keys(a) as IdentifierField[]).filter((k) => (a[k] ?? '') !== (b[k] ?? '')).map((k) => [k, a[k] ?? '']));

const SELECT = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * A person's ID numbers, each in its own box. Each number is checked as it is
 * saved; one that does not look right is kept in its box with what it should
 * look like, and every other number still saves.
 */
export function IdentifiersForm({
  profileId,
  canEdit,
  onSaved,
  onDraft,
  initialDraft,
}: {
  profileId: string;
  canEdit: boolean;
  onSaved?: () => void;
  /**
   * For a form that saves everything together, such as first setup: the
   * boxes that changed are handed up as they are typed, and this form has no
   * Save of its own.
   */
  onDraft?: (changed: Partial<Record<IdentifierField, string>>) => void;
  /** What was typed before this form was last shown, laid over the saved numbers. */
  initialDraft?: Partial<Record<IdentifierField, string>>;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['identifiers', profileId],
    queryFn: () => api.get<{ identifiers: Identifiers }>(`/care-profiles/${profileId}/identifiers`),
  });
  const { config } = useProfileCountry(profileId);
  const [draft, setDraft] = useState<Draft>({});
  const [problems, setProblems] = useState<Partial<Record<IdentifierField, string>>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  // The boxes show once the saved numbers are in them.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (data?.identifiers && !ready) {
      setDraft({ ...fromSaved(data.identifiers), ...(initialDraft ?? {}) });
      setReady(true);
    }
  }, [data, ready]);

  const set = (k: IdentifierField) => (v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setNote('');
  };

  useEffect(() => {
    if (!onDraft || !ready) return;
    const before = data?.identifiers ? fromSaved(data.identifiers) : {};
    onDraft(differs(draft, before));
    // onDraft is the caller's setter; only the boxes matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, ready]);

  const save = useMutation({
    // Only the boxes that changed go, so nothing on file is cleared by accident.
    mutationFn: () => {
      const before = data?.identifiers ? fromSaved(data.identifiers) : {};
      const changed = differs(draft, before);
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

  const field = (f: (typeof config.id_groups)[number]['fields'][number]) => {
    const k = f.key as IdentifierField;
    const id = `id-${k}-${profileId}`;
    if (f.kind === 'select') {
      return (
        <div key={k}>
          <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">{f.label}</label>
          <select id={id} className={SELECT} value={draft[k] ?? ''} disabled={!canEdit} onChange={(e) => set(k)(e.target.value)}>
            <option value="">{k === 'dva_card_colour' ? 'No DVA card' : 'Not recorded'}</option>
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {problems[k] ? <p className="mt-1 text-xs text-red-600">{problems[k]}</p> : null}
        </div>
      );
    }
    if (k === 'health_fund_name') {
      return (
        <div key={k}>
          <span className="block text-sm font-medium text-ink mb-1">{f.label}</span>
          {canEdit ? (
            <CatalogueCombo
              endpoint="/option-catalogue?category=health_fund"
              ariaLabel={f.label}
              placeholder={config.words.health_fund_example ? `e.g. ${config.words.health_fund_example}` : undefined}
              initial={draft[k] ?? ''}
              keepValue
              onPick={set(k)}
              widthClass="w-full"
            />
          ) : (
            <p className="text-sm text-ink">{draft[k] || 'Not recorded'}</p>
          )}
          {problems[k] ? <p className="mt-1 text-xs text-red-600">{problems[k]}</p> : null}
        </div>
      );
    }
    return (
      <Input
        key={k}
        label={f.label}
        value={draft[k] ?? ''}
        onChange={(e) => set(k)(e.target.value)}
        error={problems[k]}
        hint={f.hint ?? undefined}
        placeholder={f.placeholder ?? undefined}
        inputMode={f.numeric || f.kind === 'position' ? 'numeric' : 'text'}
        disabled={!canEdit}
        autoComplete="off"
      />
    );
  };

  const cols = (n: number) => (n >= 3 ? 'sm:grid-cols-3' : n === 2 ? 'sm:grid-cols-2' : '');

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!onDraft) save.mutate();
      }}
    >
      {config.id_groups.map((g) => (
        <fieldset key={g.legend} className="space-y-3">
          <legend className="text-sm font-semibold text-ink mb-1">{g.legend}</legend>
          <div className={`grid gap-3 ${cols(g.fields.length)}`}>{g.fields.map(field)}</div>
        </fieldset>
      ))}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {canEdit && !onDraft ? (
        <div className="flex items-center justify-end gap-3">
          {note ? <p className="text-sm text-muted" role="status">{note}</p> : null}
          <Button type="submit" loading={save.isPending}>Save ID numbers</Button>
        </div>
      ) : null}
    </form>
  );
}
