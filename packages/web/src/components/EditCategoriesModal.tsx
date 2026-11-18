import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { HelpCircleIcon, PencilIcon, TrashIcon } from './ui/icons';
import { documentCategoriesKey, useDocumentCategories, type DocumentCategory } from '../lib/documentCategories';

/**
 * The account owner's one window for document categories: add, rename,
 * combine and delete. Renaming onto a name already in use asks once whether
 * to combine the two. Deleting moves its documents to Other and offers Undo
 * straight away, so nothing is ever one click from lost.
 */
export function EditCategoriesModal({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useDocumentCategories(profileId);
  const categories = data?.categories ?? [];
  const base = `/care-profiles/${profileId}/document-categories`;

  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [combine, setCombine] = useState<{ from: DocumentCategory; into: DocumentCategory } | null>(null);
  const [undo, setUndo] = useState<{ category: DocumentCategory; documentIds: string[] } | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: documentCategoriesKey(profileId) });
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
  };
  const fail = (err: unknown, fallback: string) => setError(err instanceof Error ? err.message : fallback);

  const addMutation = useMutation({
    mutationFn: () => api.post(base, { name: newName.trim() }),
    onSuccess: () => { setNewName(''); setError(''); refresh(); },
    onError: (err) => fail(err, 'Could not add the category.'),
  });

  const renameMutation = useMutation({
    mutationFn: (r: { id: string; name: string }) => api.patch(`${base}/${r.id}`, { name: r.name.trim() }),
    onSuccess: () => { setRenaming(null); setError(''); refresh(); },
    onError: (err, r) => {
      if (err instanceof ApiError && err.code === 'CATEGORY_EXISTS' && err.data?.['existing']) {
        const from = categories.find((c) => c.id === r.id);
        const into = categories.find((c) => c.id === (err.data!['existing'] as { id: string }).id);
        if (from && into) {
          setCombine({ from, into });
          setError('');
          return;
        }
      }
      fail(err, 'Could not rename the category.');
    },
  });

  const combineMutation = useMutation({
    mutationFn: (c: { from: DocumentCategory; into: DocumentCategory }) => api.post(`${base}/${c.from.id}/combine`, { into_id: c.into.id }),
    onSuccess: () => { setCombine(null); setRenaming(null); setError(''); refresh(); },
    onError: (err) => { setCombine(null); fail(err, 'Could not combine the categories.'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (c: DocumentCategory) => api.delete<{ moved_document_ids: string[] }>(`${base}/${c.id}`),
    onSuccess: (r, c) => { setUndo({ category: c, documentIds: r.moved_document_ids }); setError(''); refresh(); },
    onError: (err) => fail(err, 'Could not delete the category.'),
  });

  const restoreMutation = useMutation({
    mutationFn: (u: { category: DocumentCategory; documentIds: string[] }) =>
      api.post(`${base}/${u.category.id}/restore`, { document_ids: u.documentIds }),
    onSuccess: () => { setUndo(null); setError(''); refresh(); },
    onError: (err) => fail(err, 'Could not bring the category back.'),
  });

  // When renaming a kept category onto another name, the other one folds into it.
  const combineTarget = combine ? (combine.from.kept ? combine.from : combine.into) : null;
  const combineSource = combine ? (combine.from.kept ? combine.into : combine.from) : null;
  const countText = (n: number | undefined) => `${n ?? 0} document${n === 1 ? '' : 's'}`;

  return (
    <Modal open onClose={onClose} title="Edit categories">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Categories are shared by everyone you care for. Renaming one changes it on every document filed under it.
        </p>

        {undo ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2" role="status">
            <span className="text-sm text-ink">
              Deleted {undo.category.name}.{' '}
              {undo.documentIds.length > 0 ? `${countText(undo.documentIds.length)} moved to Other.` : ''}
            </span>
            <Button size="sm" variant="secondary" className="ml-auto" loading={restoreMutation.isPending} onClick={() => restoreMutation.mutate(undo)}>
              Undo
            </Button>
          </div>
        ) : null}

        {combine && combineTarget && combineSource ? (
          <div className="rounded-md border border-primary-100 bg-primary-50 p-3 space-y-2">
            <p className="text-sm text-ink">
              There is already a category called {combine.into.name}. Combine {combineSource.name} with {combineTarget.name}?{' '}
              {combineSource.document_count
                ? combineSource.document_count === 1
                  ? `Its 1 document moves to ${combineTarget.name}.`
                  : `All ${countText(combineSource.document_count)} move to ${combineTarget.name}.`
                : `${combineSource.name} has no documents, so nothing moves.`}
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
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                {renaming?.id === c.id ? (
                  <form
                    className="flex flex-1 items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renaming.name.trim()) renameMutation.mutate(renaming);
                    }}
                  >
                    <div className="flex-1">
                      <Input
                        aria-label={`New name for ${c.name}`}
                        autoFocus
                        maxLength={100}
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                      />
                    </div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                    <Button type="submit" size="sm" variant="secondary" loading={renameMutation.isPending} disabled={!renaming.name.trim()}>Save</Button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-ink break-words">{c.name}</span>
                    <span className="text-xs text-muted whitespace-nowrap">{countText(c.document_count)}</span>
                    <Button size="xs" variant="ghost" aria-label={`Rename ${c.name}`} title="Rename" onClick={() => { setRenaming({ id: c.id, name: c.name }); setCombine(null); }}>
                      <PencilIcon />
                    </Button>
                    {c.kept ? (
                      <span className="inline-flex w-7 justify-center text-muted cursor-help" title={c.kept_reason ?? 'Always kept.'} role="img" aria-label={c.kept_reason ?? 'Always kept.'}>
                        <HelpCircleIcon size={14} />
                      </span>
                    ) : (
                      <Button
                        size="xs"
                        variant="ghost-danger"
                        aria-label={`Delete ${c.name}`}
                        title={c.document_count ? `Delete. Its ${countText(c.document_count)} move to Other.` : 'Delete'}
                        loading={deleteMutation.isPending && deleteMutation.variables?.id === c.id}
                        onClick={() => deleteMutation.mutate(c)}
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
            <Input label="Add a category" placeholder="e.g. Tax" maxLength={100} value={newName} onChange={(e) => setNewName(e.target.value)} />
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
