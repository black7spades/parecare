import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { HelpCircleIcon, PencilIcon, TrashIcon } from './ui/icons';
import { nextStepTypesKey, useNextStepTypes, type NextStepType } from '../lib/nextSteps';

/**
 * The account owner's one window for the kinds of next step: add, rename,
 * combine and delete, the same as document categories. Renaming onto a name
 * already in use asks once whether to combine the two. Deleting takes a kind
 * off the list but leaves next steps already recorded untouched, and offers
 * Undo straight away.
 */
export function EditNextStepsModal({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useNextStepTypes(profileId);
  const types = data?.types ?? [];
  const base = `/care-profiles/${profileId}/next-step-types`;

  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [combine, setCombine] = useState<{ from: NextStepType; into: NextStepType } | null>(null);
  const [undo, setUndo] = useState<NextStepType | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: nextStepTypesKey(profileId) });
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };
  const fail = (err: unknown, fallback: string) => setError(err instanceof Error ? err.message : fallback);

  const addMutation = useMutation({
    mutationFn: () => api.post(base, { name: newName.trim() }),
    onSuccess: () => { setNewName(''); setError(''); refresh(); },
    onError: (err) => fail(err, 'Could not add it.'),
  });

  const renameMutation = useMutation({
    mutationFn: (r: { id: string; name: string }) => api.patch(`${base}/${r.id}`, { name: r.name.trim() }),
    onSuccess: () => { setRenaming(null); setError(''); refresh(); },
    onError: (err, r) => {
      if (err instanceof ApiError && err.code === 'CATEGORY_EXISTS' && err.data?.['existing']) {
        const from = types.find((t) => t.id === r.id);
        const into = types.find((t) => t.id === (err.data!['existing'] as { id: string }).id);
        if (from && into) {
          setCombine({ from, into });
          setError('');
          return;
        }
      }
      fail(err, 'Could not rename it.');
    },
  });

  const combineMutation = useMutation({
    mutationFn: (c: { from: NextStepType; into: NextStepType }) => api.post(`${base}/${c.from.id}/combine`, { into_id: c.into.id }),
    onSuccess: () => { setCombine(null); setRenaming(null); setError(''); refresh(); },
    onError: (err) => { setCombine(null); fail(err, 'Could not combine them.'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (t: NextStepType) => api.delete(`${base}/${t.id}`),
    onSuccess: (_r, t) => { setUndo(t); setError(''); refresh(); },
    onError: (err) => fail(err, 'Could not delete it.'),
  });

  const restoreMutation = useMutation({
    mutationFn: (t: NextStepType) => api.post(`${base}/${t.id}/restore`, {}),
    onSuccess: () => { setUndo(null); setError(''); refresh(); },
    onError: (err) => fail(err, 'Could not bring it back.'),
  });

  const combineTarget = combine ? (combine.from.kept ? combine.from : combine.into) : null;
  const combineSource = combine ? (combine.from.kept ? combine.into : combine.from) : null;
  const countText = (n: number | undefined) => `${n ?? 0} next step${n === 1 ? '' : 's'}`;

  return (
    <Modal open onClose={onClose} title="Edit kinds of next step">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          This list is shared by everyone you care for. Renaming one changes it on every next step already recorded.
        </p>

        {undo ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2" role="status">
            <span className="text-sm text-ink">Deleted {undo.name}. Next steps already recorded keep it.</span>
            <Button size="sm" variant="secondary" className="ml-auto" loading={restoreMutation.isPending} onClick={() => restoreMutation.mutate(undo)}>
              Undo
            </Button>
          </div>
        ) : null}

        {combine && combineTarget && combineSource ? (
          <div className="rounded-md border border-primary-100 bg-primary-50 p-3 space-y-2">
            <p className="text-sm text-ink">
              There is already one called {combine.into.name}. Combine {combineSource.name} with {combineTarget.name}?{' '}
              {combineSource.task_count
                ? `${countText(combineSource.task_count)} move to ${combineTarget.name}.`
                : `${combineSource.name} has no next steps, so nothing moves.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCombine(null)}>Cancel</Button>
              <Button size="sm" variant="secondary" loading={combineMutation.isPending} onClick={() => combineMutation.mutate(combine)}>Combine</Button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border max-h-[50vh] overflow-y-auto">
            {types.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                {renaming?.id === t.id ? (
                  <form
                    className="flex flex-1 items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renaming.name.trim()) renameMutation.mutate(renaming);
                    }}
                  >
                    <div className="flex-1">
                      <Input
                        aria-label={`New name for ${t.name}`}
                        autoFocus
                        maxLength={100}
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                      />
                    </div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                    <Button type="submit" size="sm" variant="secondary" loading={renameMutation.isPending} disabled={!renaming.name.trim()}>Save</Button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-ink break-words">{t.name}</span>
                    <span className="text-xs text-muted whitespace-nowrap">{countText(t.task_count)}</span>
                    <Button size="xs" variant="ghost" aria-label={`Rename ${t.name}`} title="Rename" onClick={() => { setRenaming({ id: t.id, name: t.name }); setCombine(null); }}>
                      <PencilIcon />
                    </Button>
                    {t.kept ? (
                      <span className="inline-flex w-7 justify-center text-muted cursor-help" title={t.kept_reason ?? 'Always kept.'} role="img" aria-label={t.kept_reason ?? 'Always kept.'}>
                        <HelpCircleIcon size={14} />
                      </span>
                    ) : (
                      <Button
                        size="xs"
                        variant="ghost-danger"
                        aria-label={`Delete ${t.name}`}
                        title="Delete"
                        loading={deleteMutation.isPending && deleteMutation.variables?.id === t.id}
                        onClick={() => deleteMutation.mutate(t)}
                      >
                        <TrashIcon />
                      </Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) addMutation.mutate();
          }}
        >
          <div className="flex-1">
            <Input label="Add a kind of next step" placeholder="e.g. Allergy skin test" maxLength={100} value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" loading={addMutation.isPending} disabled={!newName.trim()}>Add</Button>
        </form>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
