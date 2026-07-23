import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { IngestModal } from '../../../components/IngestModal';
import { CIRCLE_ROLES, circleRoleLabel, DOCUMENT_CATEGORIES, documentCategoryLabel, type CareDocument, type CircleMember } from '../../../lib/care';
import { PagePurpose } from '../../../components/PagePurpose';
import { useProfile } from './ProfileLayout';

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A member's name, flagged while their invite is still pending. */
const memberName = (m: CircleMember): string =>
  m.invite_accepted ? m.display_name : `${m.display_name} (invite pending)`;

const membersWithRole = (members: CircleMember[], role: string): CircleMember[] =>
  members.filter((m) => m.role === role);

function restrictedVisibilityTitle(roles: string[], members: CircleMember[]): string {
  const names = members.filter((m) => roles.includes(m.role)).map(memberName);
  return names.length > 0
    ? `Only the profile owner and these people can see it: ${names.join(', ')}`
    : 'Only the profile owner can see it. Nobody in the care circle has the selected roles yet.';
}

const sizeValue = (d: CareDocument): number => d.file_size_bytes ?? 0;
const byName = (a: CareDocument, b: CareDocument) => a.label.localeCompare(b.label);

const DOC_SORTS: DataSort<CareDocument>[] = [
  { key: 'name', label: 'By name', compare: byName },
  { key: 'date', label: 'By date', defaultDir: 'desc', compare: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || byName(a, b) },
  { key: 'category', label: 'By category', compare: (a, b) => documentCategoryLabel(a.category).localeCompare(documentCategoryLabel(b.category)) || byName(a, b) },
  { key: 'size', label: 'By size', defaultDir: 'desc', compare: (a, b) => sizeValue(a) - sizeValue(b) || byName(a, b) },
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
  const [viewing, setViewing] = useState<CareDocument | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkEditQueue, setBulkEditQueue] = useState<CareDocument[]>([]);
  const [ingesting, setIngesting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', profile.id],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profile.id}/documents`),
  });
  const documents = data?.documents ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['documents', profile.id] });

  const { data: circleData } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });
  const members = circleData?.members ?? [];

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

  // Deep link: ?doc=<id> arrives from links elsewhere in the profile
  // (e.g. a diagnosis document on the overview). Filter the table to that
  // document and highlight its row.
  const [searchParams] = useSearchParams();
  const linkedDocId = searchParams.get('doc');
  const { setSearch } = dv;
  useEffect(() => {
    if (!linkedDocId) return;
    const doc = documents.find((d) => d.id === linkedDocId);
    if (doc) setSearch(doc.label);
  }, [linkedDocId, documents, setSearch]);

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
          {canEdit ? (
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setIngesting(true)}>Upload and file with Pare</Button>
          ) : null}
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
                  <SortableHeader label="Name" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableHeader label="Category" sortKey="category" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableHeader label="Size" sortKey="size" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableHeader label="Date" sortKey="date" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <th className="px-4 py-3 font-medium">Visibility</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dv.view.map((doc) => (
                  <tr
                    key={doc.id}
                    className={`border-b border-border last:border-0 ${doc.id === linkedDocId ? 'bg-primary-50' : ''}`}
                  >
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
                          title={restrictedVisibilityTitle(doc.visible_to_roles!, members)}
                        >
                          {doc.visible_to_roles!.map(circleRoleLabel).join(', ')}
                        </span>
                      ) : (
                        <span className="text-xs text-muted" title="Everyone in the care circle can see it.">
                          Everyone
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setViewing(doc)}>
                          View
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => void download(doc)}>
                          Download
                        </Button>
                        {canEdit ? (
                          <>
                            <Button size="xs" variant="ghost" aria-label={`Edit ${doc.label}`} title="Edit" onClick={() => setEditing(doc)}>
                              <PencilIcon />
                            </Button>
                            <Button size="xs" variant="ghost-danger" aria-label={`Delete ${doc.label}`} title="Delete" onClick={() => setDeleting(doc)}>
                              <TrashIcon />
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
              {CIRCLE_ROLES.map(({ value, label: roleLabel }) => (
                <label key={value} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={restrictedRoles.includes(value)}
                    onChange={(e) =>
                      setRestrictedRoles((prev) =>
                        e.target.checked ? [...prev, value] : prev.filter((r) => r !== value)
                      )
                    }
                  />
                  {roleLabel}
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

      {viewing ? (
        <DocumentViewerModal
          key={viewing.id}
          profileId={profile.id}
          doc={viewing}
          onClose={() => setViewing(null)}
          onDownload={() => void download(viewing)}
        />
      ) : null}

      {editing ? (
        <EditDocumentModal
          key={editing.id}
          profileId={profile.id}
          doc={editing}
          members={members}
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
      {ingesting ? <IngestModal profileId={profile.id} onClose={() => setIngesting(false)} /> : null}
    </div>
  );
}

/**
 * A column header that sorts the table: first click sorts by the column,
 * clicking again flips between ascending and descending. The arrow marks
 * the active column and direction.
 */
function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
}: {
  label: string;
  sortKey: string;
  activeKey: string;
  dir: 'asc' | 'desc';
  onToggle: (key: string) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <th className="px-4 py-3 font-medium" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        className={`flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}
        onClick={() => onToggle(sortKey)}
        title={active ? `Sorted ${dir === 'asc' ? 'ascending' : 'descending'}. Click to reverse.` : `Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span aria-hidden="true" className={active ? '' : 'opacity-0'}>
          {active && dir === 'desc' ? '▼' : '▲'}
        </span>
      </button>
    </th>
  );
}

type PreviewKind = 'image' | 'pdf' | 'html' | 'video' | 'audio' | 'text' | 'unsupported';

const EXTENSION_KINDS: Record<string, PreviewKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image',
  pdf: 'pdf',
  html: 'html', htm: 'html', xhtml: 'html',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio',
  txt: 'text', md: 'text', csv: 'text', json: 'text', log: 'text',
};

/** What kind of inline preview a document supports, from its MIME type
 * with the file extension as a fallback. */
function previewKind(doc: CareDocument): PreviewKind {
  const mime = doc.mime_type ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  const ext = doc.file_url.includes('.') ? doc.file_url.slice(doc.file_url.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXTENSION_KINDS[ext] ?? 'unsupported';
}

/**
 * Views a document inline: images, PDFs, video, audio and plain text
 * render right in the dialog. Anything else, such as Word files, offers
 * a download instead. The file is fetched with the authenticated API
 * client and shown from a local object URL, which is revoked on close.
 */
function DocumentViewerModal({
  profileId,
  doc,
  onClose,
  onDownload,
}: {
  profileId: string;
  doc: CareDocument;
  onClose: () => void;
  onDownload: () => void;
}) {
  const kind = previewKind(doc);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(kind !== 'unsupported');
  const [viewError, setViewError] = useState('');

  useEffect(() => {
    if (kind === 'unsupported') return;
    let objectUrl = '';
    let cancelled = false;
    (async () => {
      try {
        const blob = await api.blob(`/care-profiles/${profileId}/documents/${doc.id}/file`);
        if (cancelled) return;
        if (kind === 'text') {
          setText(await blob.text());
        } else {
          // The browser picks the renderer from the blob's type, so make
          // sure it carries the document's recorded MIME type. HTML files
          // whose stored type is missing or generic still need text/html
          // to render as a page rather than download.
          const desiredType =
            kind === 'html' && doc.mime_type !== 'application/xhtml+xml' ? 'text/html' : doc.mime_type;
          const typed = desiredType && blob.type !== desiredType ? new Blob([blob], { type: desiredType }) : blob;
          objectUrl = URL.createObjectURL(typed);
          setUrl(objectUrl);
        }
      } catch (err) {
        if (!cancelled) setViewError(err instanceof Error ? err.message : 'Could not load the file.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profileId, doc.id, doc.mime_type, kind]);

  return (
    <Modal open onClose={onClose} title={doc.label} wide>
      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : viewError ? (
          <p className="text-sm text-red-600">{viewError}</p>
        ) : kind === 'image' ? (
          <img src={url} alt={doc.label} className="max-w-full max-h-[70vh] mx-auto rounded-md" />
        ) : kind === 'pdf' ? (
          <iframe src={url} title={doc.label} className="w-full h-[70vh] rounded-md border border-border" />
        ) : kind === 'html' ? (
          // Fully sandboxed: an uploaded page renders with its own styling,
          // but its scripts, forms and navigation stay disabled so it can
          // never act on the app or the viewer's session.
          <iframe
            src={url}
            title={doc.label}
            sandbox=""
            className="w-full h-[70vh] rounded-md border border-border bg-white"
          />
        ) : kind === 'video' ? (
          <video src={url} controls className="max-w-full max-h-[70vh] mx-auto rounded-md" />
        ) : kind === 'audio' ? (
          <audio src={url} controls className="w-full" />
        ) : kind === 'text' ? (
          <pre className="max-h-[70vh] overflow-auto rounded-md border border-border bg-surface-2 p-3 text-xs text-ink whitespace-pre-wrap">
            {text}
          </pre>
        ) : (
          <p className="text-sm text-muted">
            This file type cannot be viewed here. Download it to open it on your device.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="secondary" onClick={onDownload}>Download</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditDocumentModal({ profileId, doc, members, onClose, onSaved }: { profileId: string; doc: CareDocument; members: CircleMember[]; onClose: () => void; onSaved: () => void }) {
  const [editLabel, setEditLabel] = useState(doc.label);
  const [editCategory, setEditCategory] = useState(doc.category);
  const [restricted, setRestricted] = useState((doc.visible_to_roles?.length ?? 0) > 0);
  const [roles, setRoles] = useState<string[]>(doc.visible_to_roles ?? []);
  const [editError, setEditError] = useState('');

  // Standard roles plus any custom roles already in use in this circle.
  const knownRoles = [...new Set([...CIRCLE_ROLES.map((r) => r.value), ...members.map((m) => m.role)])];
  const addableRoles = knownRoles.filter((r) => !roles.includes(r));
  const everyoneNames = members.map(memberName);

  const mutation = useMutation({
    mutationFn: () => api.patch(`/care-profiles/${profileId}/documents/${doc.id}`, {
      label: editLabel.trim(),
      category: editCategory,
      visible_to_roles: restricted ? roles : [],
    }),
    onSuccess: onSaved,
    onError: (err) => setEditError(err instanceof Error ? err.message : 'Failed to save'),
  });

  const canSave = !!editLabel.trim() && (!restricted || roles.length > 0);

  return (
    <Modal open onClose={onClose} title="Edit document">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSave) mutation.mutate(); }}>
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
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Who can see it</span>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={restricted}
              onChange={(e) => {
                setRestricted(e.target.checked);
                if (!e.target.checked) setRoles([]);
              }}
            />
            Restrict to selected roles
          </label>
          {restricted ? (
            <div className="mt-2 space-y-2 pl-6">
              {roles.length > 0 ? (
                <ul className="space-y-1">
                  {roles.map((role) => {
                    const names = membersWithRole(members, role).map(memberName);
                    return (
                      <li key={role} className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2">
                        <div className="min-w-0">
                          <span className="text-sm text-ink">{circleRoleLabel(role)}</span>
                          <p className="text-xs text-muted break-words">
                            {names.length > 0 ? names.join(', ') : 'Nobody in the care circle has this role yet.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove access for ${circleRoleLabel(role)}`}
                          title={`Remove access for ${circleRoleLabel(role)}`}
                          className="text-muted hover:text-red-600 text-sm px-1 shrink-0"
                          onClick={() => setRoles((prev) => prev.filter((r) => r !== role))}
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-red-600">
                  No roles selected: only the profile owner would keep access, which is not supported yet. Add a role, or untick the box to let everyone in the circle see it.
                </p>
              )}
              {addableRoles.length > 0 ? (
                <select
                  aria-label="Add a role"
                  className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  value=""
                  onChange={(e) => {
                    const role = e.target.value;
                    if (role) setRoles((prev) => [...prev, role]);
                  }}
                >
                  <option value="">Add a role…</option>
                  {addableRoles.map((r) => (
                    <option key={r} value={r}>{circleRoleLabel(r)}</option>
                  ))}
                </select>
              ) : null}
              <p className="text-xs text-muted">The profile owner always has access.</p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted pl-6">
              {everyoneNames.length > 0
                ? `Everyone in the care circle can see it: the profile owner and ${everyoneNames.join(', ')}.`
                : 'Everyone in the care circle can see it. Right now that is only the profile owner.'}
            </p>
          )}
        </div>
        {editError ? <p className="text-sm text-red-600">{editError}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!canSave}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
