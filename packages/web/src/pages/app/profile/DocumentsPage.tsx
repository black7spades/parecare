import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { DOCUMENT_CATEGORIES, documentCategoryLabel, type CareDocument } from '../../../lib/care';
import { PagePurpose } from '../../../components/PagePurpose';
import { useProfile } from './ProfileLayout';

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const sizeValue = (d: CareDocument): number => d.file_size_bytes ?? 0;
const byName = (a: CareDocument, b: CareDocument) => a.label.localeCompare(b.label);

const DOC_SORTS: DataSort<CareDocument>[] = [
  { key: 'name', label: 'By name (A–Z)', compare: byName },
  { key: 'date', label: 'By date (newest first)', compare: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || byName(a, b) },
  { key: 'category', label: 'By category', compare: (a, b) => documentCategoryLabel(a.category).localeCompare(documentCategoryLabel(b.category)) || byName(a, b) },
  { key: 'size', label: 'By size (largest first)', compare: (a, b) => sizeValue(b) - sizeValue(a) || byName(a, b) },
];

export function DocumentsPage() {
  const { profile, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('medical_record');
  const [restrictedRoles, setRestrictedRoles] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<CareDocument | null>(null);
  const [editing, setEditing] = useState<CareDocument | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkEditQueue, setBulkEditQueue] = useState<CareDocument[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', profile.id],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profile.id}/documents`),
  });
  const documents = data?.documents ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['documents', profile.id] });

  const uploadMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      form.append('category', category);
      form.append('label', label.trim() || file!.name);
      for (const role of restrictedRoles) form.append('visible_to_roles', role);
      return api.upload(`/care-profiles/${profile.id}/documents`, form);
    },
    onSuccess: () => {
      setFile(null);
      setLabel('');
      setRestrictedRoles([]);
      setError('');
      if (fileInput.current) fileInput.current.value = '';
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Upload failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/documents/${id}`),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.delete(`/care-profiles/${profile.id}/documents/${id}`))),
    onSuccess: () => {
      setConfirmBulk(false);
      dv.clearSelection();
      invalidate();
    },
  });

  // Build category filter dynamically from existing documents.
  const categoryFilter: DataFilter<CareDocument> = {
    key: 'category',
    label: 'Category',
    options: [...new Set(documents.map((d) => d.category))].map((c) => ({ value: c, label: documentCategoryLabel(c) })),
    match: (d, v) => d.category === v,
  };

  const dv = useDataView<CareDocument>({
    rows: documents,
    getId: (d) => d.id,
    searchText: (d) => [d.label, documentCategoryLabel(d.category)].join(' '),
    sorts: DOC_SORTS,
    filters: [categoryFilter],
  });

  const bulkActions: ToolbarBulkAction[] = canEdit
    ? [
        { key: 'edit', label: 'Edit selected', onRun: () => { const q = [...dv.selectedRows]; setBulkEditQueue(q); setEditing(q[0] ?? null); } },
        { key: 'delete', label: 'Delete selected', destructive: true, onRun: () => setConfirmBulk(true) },
      ]
    : [];

  async function download(doc: CareDocument) {
    const blob = await api.blob(`/care-profiles/${profile.id}/documents/${doc.id}/file`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ext = doc.file_url.includes('.') ? doc.file_url.slice(doc.file_url.lastIndexOf('.')) : '';
    a.download = `${doc.label}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-semibold text-ink">Document repository</h2>
          <PagePurpose kind="entry" />
        </div>

        <DataToolbar
          search={dv.search}
          onSearch={dv.setSearch}
          searchPlaceholder="Search documents…"
          sorts={DOC_SORTS.map((s) => ({ key: s.key, label: s.label }))}
          sortKey={dv.sortKey}
          onSort={dv.setSortKey}
          filters={[categoryFilter].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
          filterValues={dv.filterValues}
          onFilter={dv.setFilter}
          selectedCount={dv.selectedRows.length}
          bulkActions={bulkActions}
          onClearSelection={dv.clearSelection}
          page={dv.page}
          totalPages={dv.totalPages}
          pageSize={dv.pageSize}
          totalFiltered={dv.totalFiltered}
          onPageChange={dv.setPage}
          onPageSizeChange={dv.setPageSize}
        />

        {isLoading ? (
          <p className="text-sm text-muted mt-4">Loading…</p>
        ) : dv.view.length === 0 ? (
          <p className="text-sm text-muted mt-4">
            {documents.length === 0
              ? 'No documents yet. Keep medical certificates, the will, POA papers and care plans here so nobody hunts through email chains.'
              : 'No documents match your search or filters.'}
          </p>
        ) : (
          <div className="card p-0 overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={dv.allSelected}
                      onChange={dv.toggleAll}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Visibility</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dv.view.map((doc) => (
                  <tr key={doc.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${doc.label}`}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={dv.selected.has(doc.id)}
                        onChange={() => dv.toggle(doc.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink break-words">{doc.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge bg-surface-2 text-muted text-xs">{documentCategoryLabel(doc.category)}</span>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatSize(doc.file_size_bytes)}</td>
                    <td className="px-4 py-3 text-muted">{format(new Date(doc.created_at), 'd MMM yyyy')}</td>
                    <td className="px-4 py-3">
                      {(doc.visible_to_roles?.length ?? 0) > 0 ? (
                        <span
                          className="badge bg-amber-50 text-amber-700 text-xs"
                          title={`Visible to the owner and: ${doc.visible_to_roles!.join(', ')}`}
                        >
                          Restricted
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Everyone</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void download(doc)}>
                          Download
                        </Button>
                        {canEdit ? (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => setEditing(doc)}>
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleting(doc)}>
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (file) uploadMutation.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-ink">Upload a document</h2>
        <div>
          <label htmlFor="doc-file" className="block text-sm font-medium text-ink mb-1">
            File
          </label>
          <input
            id="doc-file"
            ref={fileInput}
            type="file"
            className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:text-primary hover:file:bg-primary-100"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          <p className="mt-1 text-xs text-muted">Up to 50 MB.</p>
        </div>
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Medical certificate, March" />
        <div>
          <label htmlFor="doc-category" className="block text-sm font-medium text-ink mb-1">
            Category
          </label>
          <select
            id="doc-category"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Who can see it</span>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={restrictedRoles.length > 0}
              onChange={(e) => setRestrictedRoles(e.target.checked ? ['family'] : [])}
            />
            Restrict to selected roles
          </label>
          {restrictedRoles.length > 0 ? (
            <div className="mt-2 space-y-1 pl-6">
              {['family', 'carer', 'legal', 'organisation'].map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm text-ink capitalize">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={restrictedRoles.includes(role)}
                    onChange={(e) =>
                      setRestrictedRoles((prev) =>
                        e.target.checked ? [...prev, role] : prev.filter((r) => r !== role)
                      )
                    }
                  />
                  {role}
                </label>
              ))}
              <p className="text-xs text-muted">The profile owner always has access.</p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted pl-6">Everyone in the care circle can see it.</p>
          )}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" className="w-full" loading={uploadMutation.isPending} disabled={!file}>
          Upload
        </Button>
      </form>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete document">
        <p className="text-sm text-muted mb-4">
          Permanently delete <span className="font-medium text-ink">{deleting?.label}</span>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() => deleting && deleteMutation.mutate(deleting.id)}
          >
            Delete
          </Button>
        </div>
      </Modal>

      <Modal open={confirmBulk} onClose={() => setConfirmBulk(false)} title="Delete documents">
        <p className="text-sm text-muted mb-4">
          Permanently delete <span className="font-medium text-ink">{dv.selectedRows.length}</span> selected
          document{dv.selectedRows.length === 1 ? '' : 's'}? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulk(false)}>Cancel</Button>
          <Button
            variant="danger"
            loading={bulkDeleteMutation.isPending}
            onClick={() => bulkDeleteMutation.mutate(dv.selectedRows.map((d) => d.id))}
          >
            Delete {dv.selectedRows.length}
          </Button>
        </div>
      </Modal>

      {editing ? (
        <EditDocumentModal
          profileId={profile.id}
          doc={editing}
          onClose={() => { setEditing(null); setBulkEditQueue([]); }}
          onSaved={() => {
            invalidate();
            const next = bulkEditQueue.slice(1);
            if (next.length > 0) {
              setBulkEditQueue(next);
              setEditing(next[0]);
            } else {
              setBulkEditQueue([]);
              setEditing(null);
              dv.clearSelection();
            }
          }}
        />
      ) : null}
    </div>
  );
}

function EditDocumentModal({ profileId, doc, onClose, onSaved }: { profileId: string; doc: CareDocument; onClose: () => void; onSaved: () => void }) {
  const [editLabel, setEditLabel] = useState(doc.label);
  const [editCategory, setEditCategory] = useState(doc.category);
  const [editError, setEditError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.patch(`/care-profiles/${profileId}/documents/${doc.id}`, {
      label: editLabel.trim(),
      category: editCategory,
    }),
    onSuccess: onSaved,
    onError: (err) => setEditError(err instanceof Error ? err.message : 'Failed to save'),
  });

  return (
    <Modal open onClose={onClose} title="Edit document">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (editLabel.trim()) mutation.mutate(); }}>
        <Input label="Label" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} required />
        <div>
          <label htmlFor="edit-doc-category" className="block text-sm font-medium text-ink mb-1">Category</label>
          <select
            id="edit-doc-category"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={editCategory}
            onChange={(e) => setEditCategory(e.target.value)}
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        {editError ? <p className="text-sm text-red-600">{editError}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!editLabel.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
