import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { DownloadIcon, PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { IngestModal } from '../../../components/IngestModal';
import { CIRCLE_ROLES, EXPIRING_CATEGORY_KEYS, circleRoleLabel, type CareDocument, type CircleMember } from '../../../lib/care';
import { categoryNameOf, documentCategoriesKey, useDocumentCategories } from '../../../lib/documentCategories';
import { SortableTh } from '../../../components/data/SortableTh';
import { ContactPicker, changedContactFieldsAs, contactFieldsAs, emptyContact, pickedFrom, type PickedContact } from '../../../components/ContactPicker';
import { ContactStrip } from '../../../components/ContactStrip';
import { formatDateOnly } from '../../../lib/datetime';
import { DocumentCategoryField } from '../../../components/DocumentCategoryField';
import { EditCategoriesModal } from '../../../components/EditCategoriesModal';
import { PagePurpose } from '../../../components/PagePurpose';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { useProfile } from './ProfileLayout';
import { SecretsSection } from './SecretsSection';

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
const visibilityText = (d: CareDocument): string =>
  (d.visible_to_roles?.length ?? 0) > 0 ? d.visible_to_roles!.map(circleRoleLabel).join(', ') : 'Everyone';
const byName = (a: CareDocument, b: CareDocument) => a.label.localeCompare(b.label);
const attachedText = (d: CareDocument): string => (d.attached_to ?? []).map((a) => a.label).join(', ');
// Missing dates sort last; "does not expire" sorts after every date.
const untilValue = (d: CareDocument): string => (d.no_expiry ? '9999-12-30' : d.valid_until ?? '9999-12-31');

const DOC_SORTS: DataSort<CareDocument>[] = [
  { key: 'name', label: 'By name', compare: byName },
  { key: 'date', label: 'By date added', defaultDir: 'desc', compare: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || byName(a, b) },
  { key: 'category', label: 'By category', compare: (a, b) => categoryNameOf(a).localeCompare(categoryNameOf(b)) || byName(a, b) },
  { key: 'written', label: 'By date written', defaultDir: 'desc', compare: (a, b) => (a.issued_on ?? '0000').localeCompare(b.issued_on ?? '0000') || byName(a, b) },
  { key: 'until', label: 'By valid until', compare: (a, b) => untilValue(a).localeCompare(untilValue(b)) || byName(a, b) },
  { key: 'attached', label: 'By attached to', compare: (a, b) => (attachedText(a) || '￿').localeCompare(attachedText(b) || '￿') || byName(a, b) },
  { key: 'size', label: 'By size', defaultDir: 'desc', compare: (a, b) => sizeValue(a) - sizeValue(b) || byName(a, b) },
  { key: 'visibility', label: 'By who can see it', compare: (a, b) => visibilityText(a).localeCompare(visibilityText(b)) || byName(a, b) },
];

const todayYmd = () => format(new Date(), 'yyyy-MM-dd');

/** Valid until, in words: a date, "Does not expire", or nothing. A date gone by says so. */
function ValidUntil({ doc }: { doc: CareDocument }) {
  if (doc.no_expiry) return <span className="text-muted">Does not expire</span>;
  if (!doc.valid_until) return <span className="text-xs text-muted">Not given</span>;
  const gone = doc.valid_until < todayYmd();
  return (
    <span className={gone ? 'text-red-700 dark:text-red-300' : 'text-ink'}>
      {formatDateOnly(doc.valid_until, 'd MMM yyyy')}
      {gone ? <span className="block text-xs">Ran out</span> : null}
    </span>
  );
}

/** What a document is attached to: each record by name, opening it. */
function AttachedList({ doc, limit }: { doc: CareDocument; limit?: number }) {
  const all = doc.attached_to ?? [];
  if (all.length === 0) return <span className="text-xs text-muted">Nothing yet</span>;
  const shown = limit ? all.slice(0, limit) : all;
  return (
    <span className="flex flex-col gap-0.5">
      {shown.map((a) => (
        <Link key={`${a.kind}-${a.id}`} to={a.path} className={`text-primary hover:underline ${limit ? 'block truncate max-w-[11rem]' : 'break-words'}`} title={`Open the ${a.kind_label.toLowerCase()}: ${a.label}`}>
          {a.label}
        </Link>
      ))}
      {limit && all.length > limit ? <span className="text-xs text-muted">and {all.length - limit} more</span> : null}
    </span>
  );
}

export function DocumentsPage() {
  const { profile, canEdit, isOwner } = useProfile();
  const queryClient = useQueryClient();
  // The upload dialog: closed, open with nothing picked, or open with a
  // file someone dropped onto the list.
  const [uploading, setUploading] = useState<{ file: File | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  // The document just uploaded, lit up in the list for a few seconds so
  // people see where it went.
  const [justAdded, setJustAdded] = useState<CareDocument | null>(null);
  const [editing, setEditing] = useState<CareDocument | null>(null);
  const [viewing, setViewing] = useState<CareDocument | null>(null);
  const [bulkEditQueue, setBulkEditQueue] = useState<CareDocument[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const [reading, setReading] = useState<CareDocument | null>(null);
  const [editingCategories, setEditingCategories] = useState(false);
  const [recategorising, setRecategorising] = useState<CareDocument[] | null>(null);
  // Said when a file saved but one of its details could not be used.
  const [uploadWarning, setUploadWarning] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['documents', profile.id],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profile.id}/documents`),
  });
  const documents = data?.documents ?? [];
  // Filing can add a category, so the category list refreshes with the documents.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['documents', profile.id] });
    void queryClient.invalidateQueries({ queryKey: documentCategoriesKey(profile.id) });
  };

  const { data: circleData } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });
  const members = circleData?.members ?? [];

  useEffect(() => {
    if (!justAdded) return;
    const timer = window.setTimeout(() => setJustAdded(null), 6000);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  // Dropping a file anywhere on the list opens the upload dialog with it
  // already picked. The depth counter stops the outline flickering as the
  // pointer crosses child elements.
  const isFileDrag = (e: DragEvent) => canEdit && e.dataTransfer.types.includes('Files');
  const dropHandlers = canEdit
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (isFileDrag(e)) e.preventDefault();
        },
        onDragLeave: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) setUploading({ file: dropped });
        },
      }
    : {};

  // The condition a document was filed against, by name, for its record.
  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profile.id],
    queryFn: () => api.get<{ conditions: { id: string; name: string }[] }>(`/care-profiles/${profile.id}/conditions`),
  });
  const conditionName = (id: string | null | undefined) =>
    id ? conditionData?.conditions.find((c) => c.id === id)?.name ?? null : null;

  // Deleting is held back a few seconds with Undo, never a "sure?" box.
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const hidden = useHiddenIds();
  const deleteDocuments = (items: CareDocument[]) => {
    if (items.length === 0) return;
    deferDelete({
      message: items.length === 1 ? `Deleted ${items[0].label}.` : `Deleted ${items.length} documents.`,
      ids: items.map((d) => d.id),
      commit: () => Promise.all(items.map((d) => api.delete(`/care-profiles/${profile.id}/documents/${d.id}`))),
      onCommitted: invalidate,
    });
  };

  // Build category filter dynamically from existing documents.
  const categoryFilter: DataFilter<CareDocument> = {
    key: 'category',
    label: 'Category',
    options: [...new Map(documents.map((d) => [d.category_id ?? '', categoryNameOf(d)])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
    match: (d, v) => (d.category_id ?? '') === v,
  };

  const visible = documents.filter((d) => !hidden.has(d.id));
  const panel = useRecordPanel(visible, (d) => d.id);
  const dv = useDataView<CareDocument>({
    rows: visible,
    getId: (d) => d.id,
    searchText: (d) => [d.label, categoryNameOf(d), attachedText(d), d.from?.name, d.to?.name].filter(Boolean).join(' '),
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
        { key: 'category', label: 'Change category', onRun: () => setRecategorising([...dv.selectedRows]) },
        { key: 'edit', label: 'Edit selected', onRun: () => { const q = [...dv.selectedRows]; setBulkEditQueue(q); setEditing(q[0] ?? null); } },
        { key: 'delete', label: 'Delete selected', destructive: true, onRun: () => { deleteDocuments([...dv.selectedRows]); dv.clearSelection(); } },
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
    <div className="space-y-6">
      <div className="card relative" {...dropHandlers}>
        {dragging ? (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary-50 opacity-95"
            aria-hidden="true"
          >
            <p className="text-base font-semibold text-primary">Drop the file to upload it</p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h2 className="text-base font-semibold text-ink">Document repository</h2>
          <PagePurpose kind="entry" />
          {canEdit ? (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setIngesting(true)}>Upload and file with Pare</Button>
              {/* The empty state carries its own Upload button, so this one
                  waits until there is a list to sit above. */}
              {documents.length > 0 ? (
                <Button size="sm" onClick={() => setUploading({ file: null })}>Upload</Button>
              ) : null}
            </div>
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
          extra={isOwner ? (
            <Button size="sm" variant="ghost" onClick={() => setEditingCategories(true)}>Edit categories</Button>
          ) : undefined}
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

        <p className="sr-only" aria-live="polite">{justAdded ? `${justAdded.label} uploaded.` : ''}</p>
        {uploadWarning ? (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-md border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200" role="status">
            <span>{uploadWarning}</span>
            <Button size="xs" variant="ghost" onClick={() => setUploadWarning('')}>Dismiss</Button>
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted mt-4">Loading…</p>
        ) : documents.length === 0 ? (
          <div className="mt-4 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center">
            <p className="text-sm text-ink">
              Keep medical certificates, the will, power of attorney papers and care plans here, so nobody hunts through email chains.
            </p>
            {canEdit ? (
              <>
                <Button className="mt-4" onClick={() => setUploading({ file: null })}>Upload a document</Button>
                <p className="mt-2 text-xs text-muted">Or drop a file here.</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-muted">No documents yet.</p>
            )}
          </div>
        ) : dv.view.length === 0 ? (
          <p className="text-sm text-muted mt-4">No documents match your search or filters.</p>
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
                  <SortableTh label="Name" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-3 py-3 whitespace-nowrap" />
                  <SortableTh label="Category" sortKey="category" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-3 py-3 whitespace-nowrap" />
                  <SortableTh label="Date written" sortKey="written" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-3 py-3 whitespace-nowrap" />
                  <SortableTh label="Valid until" sortKey="until" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-3 py-3 whitespace-nowrap" />
                  <SortableTh label="Attached to" sortKey="attached" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-3 py-3 whitespace-nowrap" />
                  <SortableTh label="Size" sortKey="size" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-3 py-3 whitespace-nowrap" />
                  <SortableTh label="Added" sortKey="date" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-3 py-3 whitespace-nowrap" />
                  <SortableTh label="Who can see it" sortKey="visibility" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-3 py-3 whitespace-nowrap" />
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dv.view.map((doc) => (
                  <tr
                    key={doc.id}
                    {...panel.rowProps(doc.id)}
                    className={`border-b border-border last:border-0 transition-colors duration-700 ${RECORD_ROW_CLASS} ${doc.id === linkedDocId || doc.id === justAdded?.id ? 'bg-primary-50' : ''}`}
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
                      <span className="badge bg-surface-2 text-muted text-xs">{categoryNameOf(doc)}</span>
                    </td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">{doc.issued_on ? formatDateOnly(doc.issued_on, 'd MMM yyyy') : <span className="text-xs">Not given</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap"><ValidUntil doc={doc} /></td>
                    <td className="px-3 py-3 text-sm"><AttachedList doc={doc} limit={2} /></td>
                    <td className="px-4 py-3 text-muted">{formatSize(doc.file_size_bytes)}</td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">{format(new Date(doc.created_at), 'd MMM yyyy')}</td>
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
                        {canEdit ? (
                          <Button size="sm" variant="secondary" title="Pare reads it and proposes what to file from it" onClick={() => setReading(doc)}>
                            Read with Pare
                          </Button>
                        ) : null}
                        <Button size="xs" variant="ghost" aria-label={`Download ${doc.label}`} title="Download" onClick={() => void download(doc)}>
                          <DownloadIcon />
                        </Button>
                        {canEdit ? (
                          <>
                            <Button size="xs" variant="ghost" aria-label={`Edit ${doc.label}`} title="Edit" onClick={() => setEditing(doc)}>
                              <PencilIcon />
                            </Button>
                            <Button size="xs" variant="ghost-danger" aria-label={`Delete ${doc.label}`} title="Delete" onClick={() => deleteDocuments([doc])}>
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
        {canEdit && documents.length > 0 ? (
          <p className="mt-3 text-xs text-muted">Drop a file anywhere on the list to upload it.</p>
        ) : null}
      </div>

      {panel.current ? (() => {
        const doc = panel.current;
        const condition = conditionName(doc.medical_condition_id);
        return (
          <RecordPanel
            key={doc.id}
            kindLabel="Document"
            title={doc.label}
            subtitle={categoryNameOf(doc)}
            kind="documents"
            recordId={doc.id}
            profileId={profile.id}
            canEdit={canEdit}
            fields={[
              { label: 'Name', value: doc.label },
              { label: 'Category', value: categoryNameOf(doc) },
              { label: 'Date written', value: doc.issued_on ? formatDateOnly(doc.issued_on, 'd MMM yyyy') : null },
              {
                label: 'Valid until',
                value: doc.no_expiry || doc.valid_until ? (
                  <span>
                    <ValidUntil doc={doc} />
                    {doc.validity_note ? <span className="block text-xs text-muted">{doc.validity_note}</span> : null}
                  </span>
                ) : doc.validity_note ? <span className="text-xs text-muted">{doc.validity_note}</span> : null,
              },
              { label: 'Size', value: formatSize(doc.file_size_bytes) },
              { label: 'Added', value: format(new Date(doc.created_at), 'd MMM yyyy') },
              { label: 'Condition', value: condition },
              {
                label: 'Who can see it',
                value: (doc.visible_to_roles?.length ?? 0) > 0
                  ? restrictedVisibilityTitle(doc.visible_to_roles!, members)
                  : 'Everyone in the care circle',
              },
            ]}
            links={condition ? [{ label: 'Condition', value: condition, to: `/app/${profile.id}/conditions?record=${doc.medical_condition_id}` }] : []}
            onEdit={() => setEditing(doc)}
            extra={[
              { label: 'View', onRun: () => setViewing(doc) },
              { label: 'Read with Pare', onRun: () => setReading(doc) },
              { label: 'Download', onRun: () => void download(doc) },
            ]}
            onDelete={() => {
              deleteDocuments([doc]);
              panel.close();
            }}
            onClose={panel.close}
          >
            {doc.from ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">From</h3>
                <ContactStrip contact={doc.from} profileId={profile.id} book={false} />
              </section>
            ) : null}
            {doc.to ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">To</h3>
                <ContactStrip
                  contact={doc.to}
                  profileId={profile.id}
                  book={canEdit && doc.category_key === 'referral' ? { title: `${doc.to.role_label ?? 'Specialist'} appointment` } : false}
                />
              </section>
            ) : null}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Attached to</h3>
              {(doc.attached_to ?? []).length ? (
                <ul className="space-y-1 text-sm">
                  {(doc.attached_to ?? []).map((a) => (
                    <li key={`${a.kind}-${a.id}`}>
                      <span className="text-muted">{a.kind_label}: </span>
                      <Link to={a.path} className="font-medium text-primary underline">{a.label}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Not attached to anything yet.</p>
              )}
            </section>
          </RecordPanel>
        );
      })() : null}

      {viewing ? (
        <DocumentViewerModal
          key={`view-${viewing.id}`}
          profileId={profile.id}
          doc={viewing}
          onClose={() => setViewing(null)}
          onDownload={() => void download(viewing)}
          onRead={canEdit ? () => { setReading(viewing); setViewing(null); } : undefined}
        />
      ) : null}

      {editing ? (
        <EditDocumentModal
          key={`edit-${editing.id}`}
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
      {uploading ? (
        <UploadDocumentModal
          profileId={profile.id}
          members={members}
          initialFile={uploading.file}
          onClose={() => setUploading(null)}
          onUploaded={(doc, warning) => {
            setUploading(null);
            setUploadWarning(warning ?? '');
            invalidate();
            // Newest first, so the new document is at the top where its row lights up.
            dv.setSearch('');
            dv.setFilter('category', '');
            dv.setSortKey('date');
            setJustAdded(doc);
          }}
        />
      ) : null}
      {ingesting ? <IngestModal profileId={profile.id} onClose={() => setIngesting(false)} /> : null}
      {editingCategories ? <EditCategoriesModal profileId={profile.id} onClose={() => setEditingCategories(false)} /> : null}
      {recategorising ? (
        <ChangeCategoryModal
          profileId={profile.id}
          docs={recategorising}
          onClose={() => setRecategorising(null)}
          onSaved={() => { setRecategorising(null); dv.clearSelection(); invalidate(); }}
        />
      ) : null}
      {reading ? (
        <IngestModal
          key={`read-${reading.id}`}
          profileId={profile.id}
          document={{ id: reading.id, label: reading.label }}
          title={`Read ${reading.label} with Pare`}
          onClose={() => setReading(null)}
        />
      ) : null}

      {/* The secrets vault. It shows itself only to the account owner, and to
          a power of attorney once a date of death is recorded, so it renders
          nothing at all for everyone else. */}
      <SecretsSection profileId={profile.id} careName={profile.preferred_name || profile.full_name} />
    </div>
  );
}

/** The dates and people a document carries, as the form holds them. */
export interface DocumentDatesValue {
  issuedOn: string;
  validUntil: string;
  noExpiry: boolean;
  from: PickedContact;
  to: PickedContact;
  /** Valid until was worked out and has not been opened to change. */
  workedOut: boolean;
}

export const emptyDocumentDates: DocumentDatesValue = { issuedOn: '', validUntil: '', noExpiry: false, from: emptyContact, to: emptyContact, workedOut: false };

const datesFrom = (doc: CareDocument): DocumentDatesValue => ({
  issuedOn: doc.issued_on ?? '',
  validUntil: doc.valid_until ?? '',
  noExpiry: !!doc.no_expiry,
  from: pickedFrom(doc.from ?? null),
  to: pickedFrom(doc.to ?? null),
  workedOut: !!doc.valid_until_worked_out,
});

/**
 * What the dates and people send to the server. On an edit only what moved
 * is sent, so a worked-out date stays worked out and a contact removed from
 * the person is never linked back by an unrelated save.
 */
function datesBody(now: DocumentDatesValue, before?: DocumentDatesValue): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  if (!before || now.issuedOn !== before.issuedOn) out['issued_on'] = now.issuedOn || null;
  if (!before || now.noExpiry !== before.noExpiry) out['no_expiry'] = now.noExpiry;
  if (!now.noExpiry && !now.workedOut && (!before || now.validUntil !== before.validUntil || before.workedOut)) out['valid_until'] = now.validUntil || null;
  Object.assign(out, before ? changedContactFieldsAs('from', before.from, now.from) : contactFieldsAs('from', now.from));
  Object.assign(out, before ? changedContactFieldsAs('to', before.to, now.to) : contactFieldsAs('to', now.to));
  return out;
}

/**
 * Date written, Valid until with Does not expire, From and To. A referral's
 * Valid until is worked out from who wrote it, and says so, with Change.
 */
function DocumentDatesFields({
  idPrefix,
  profileId,
  category,
  value,
  onChange,
  note,
}: {
  idPrefix: string;
  profileId: string;
  category: string;
  value: DocumentDatesValue;
  onChange: (next: DocumentDatesValue) => void;
  /** How a worked-out date was reached, from the server. */
  note?: string | null;
}) {
  const { data } = useDocumentCategories(profileId);
  const key = (data?.categories ?? []).find((c) => c.name.toLowerCase() === category.trim().toLowerCase())?.system_key ?? null;
  const expires = !!key && EXPIRING_CATEGORY_KEYS.includes(key);
  const referral = key === 'referral';
  const set = (patch: Partial<DocumentDatesValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          id={`${idPrefix}-issued`}
          type="date"
          label="Date written"
          value={value.issuedOn}
          onChange={(e) => set({ issuedOn: e.target.value })}
        />
        <div>
          {value.noExpiry ? (
            <p className="text-sm text-ink pt-7">Does not expire.</p>
          ) : value.workedOut && value.validUntil ? (
            <div>
              <span className="block text-sm font-medium text-ink mb-1">Valid until</span>
              <p className="text-sm text-ink">
                {formatDateOnly(value.validUntil, 'd MMM yyyy')}{' '}
                <Button type="button" size="xs" variant="ghost" onClick={() => set({ workedOut: false })}>Change</Button>
              </p>
            </div>
          ) : (
            <Input
              id={`${idPrefix}-until`}
              type="date"
              label={expires ? 'Valid until' : 'Valid until, if it expires'}
              value={value.validUntil}
              onChange={(e) => set({ validUntil: e.target.value, workedOut: false })}
              hint={referral && !value.validUntil ? 'Leave it empty and it is worked out from who wrote it.' : undefined}
            />
          )}
          <label className="mt-1 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={value.noExpiry}
              onChange={(e) => set({ noExpiry: e.target.checked })}
            />
            Does not expire
          </label>
        </div>
      </div>
      {note && value.workedOut && !value.noExpiry ? <p className="text-xs text-muted">{note}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <ContactPicker
          id={`${idPrefix}-from`}
          label="From"
          profileId={profileId}
          value={value.from}
          onChange={(from) => set({ from })}
          hint="Who wrote it."
          defaultType="gp"
          placeholder="Search Contacts or type their name"
        />
        <ContactPicker
          id={`${idPrefix}-to`}
          label="To"
          profileId={profileId}
          value={value.to}
          onChange={(to) => set({ to })}
          hint="Who it is addressed to."
          defaultType="specialist"
          placeholder="Search Contacts or type their name"
        />
      </div>
    </div>
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
  onRead,
}: {
  profileId: string;
  doc: CareDocument;
  onClose: () => void;
  onDownload: () => void;
  /** Hand this document to Pare to read; absent for those who cannot edit. */
  onRead?: () => void;
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
          {onRead ? <Button variant="secondary" onClick={onRead}>Read with Pare</Button> : null}
          <Button variant="secondary" onClick={onDownload}>Download</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The details every document carries: its name, category and who can see
 * it. Upload and Edit share these, so the two forms never drift apart.
 * Anything only one of them asks, such as the condition a new file is for,
 * comes in as children and sits after the category.
 */
function DocumentDetailsFields({
  idPrefix,
  profileId,
  members,
  label,
  onLabel,
  category,
  onCategory,
  restricted,
  onRestricted,
  roles,
  onRoles,
  children,
}: {
  idPrefix: string;
  profileId: string;
  members: CircleMember[];
  label: string;
  onLabel: (v: string) => void;
  category: string;
  onCategory: (v: string) => void;
  restricted: boolean;
  onRestricted: (v: boolean) => void;
  roles: string[];
  onRoles: (update: (prev: string[]) => string[]) => void;
  children?: ReactNode;
}) {
  // Standard roles plus any custom roles already in use in this circle.
  // Roles match without case, so "Carer" and "carer" are offered once.
  const knownRoles: string[] = [];
  for (const r of [...CIRCLE_ROLES.map((x) => x.value as string), ...members.map((m) => m.role)]) {
    if (r && !knownRoles.some((k) => k.toLowerCase() === r.trim().toLowerCase())) knownRoles.push(r.trim());
  }
  const addableRoles = knownRoles.filter((r) => !roles.some((x) => x.toLowerCase() === r.toLowerCase()));
  const everyoneNames = members.map(memberName);

  return (
    <>
      <Input label="Label" value={label} onChange={(e) => onLabel(e.target.value)} placeholder="e.g. Medical certificate, March" required />
      <DocumentCategoryField id={`${idPrefix}-category`} profileId={profileId} value={category} onChange={onCategory} />
      {children}
      <div>
        <span className="block text-sm font-medium text-ink mb-1">Who can see it</span>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={restricted}
            onChange={(e) => {
              onRestricted(e.target.checked);
              if (!e.target.checked) onRoles(() => []);
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
                        onClick={() => onRoles((prev) => prev.filter((r) => r !== role))}
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
                  if (role) onRoles((prev) => [...prev, role]);
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
    </>
  );
}

const withoutExtension = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * Adds one document. Opens from the Upload button with nothing picked, or
 * from a file dropped onto the list with that file ready to go and its
 * name already filled in as the label.
 */
export function UploadDocumentModal({
  profileId,
  members,
  initialFile,
  initialLabel = '',
  initialConditionId = '',
  link,
  links,
  onClose,
  onUploaded,
}: {
  profileId: string;
  members: CircleMember[];
  initialFile: File | null;
  /** Prefill the name, e.g. from a document an appointment said to file. */
  initialLabel?: string;
  /** Prefill the condition it is for, e.g. the one the appointment was for. */
  initialConditionId?: string;
  /** Attach the new document to a record as it is filed. */
  link?: { kind: string; id: string };
  /** Attach it to several records at once, such as a next step and its appointment. */
  links?: Array<{ kind: string; id: string }>;
  onClose: () => void;
  /** A warning says the file saved but a detail could not be used. */
  onUploaded: (doc: CareDocument, warning?: string) => void;
}) {
  const [tried, setTried] = useState(false);
  const [file, setFile] = useState<File | null>(initialFile);
  const [label, setLabel] = useState(initialLabel || (initialFile ? withoutExtension(initialFile.name) : ''));
  // A category name; one not on the list yet is added when the file is saved.
  const [category, setCategory] = useState('');
  // File this document against a condition, so a scan report joins the
  // tracking thread of the ankle it was taken for.
  const [conditionId, setConditionId] = useState(initialConditionId);
  const [restricted, setRestricted] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [dates, setDates] = useState<DocumentDatesValue>(emptyDocumentDates);
  const [uploadError, setUploadError] = useState('');

  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: { id: string; name: string }[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = conditionData?.conditions ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      form.append('category', category);
      form.append('label', label.trim() || file!.name);
      if (conditionId) form.append('medical_condition_id', conditionId);
      if (restricted) for (const role of roles) form.append('visible_to_roles', role);
      for (const l of [...(link ? [link] : []), ...(links ?? [])]) {
        form.append('link_entity_type', l.kind);
        form.append('link_entity_id', l.id);
      }
      for (const [k, v] of Object.entries(datesBody(dates))) form.append(k, v === null ? '' : String(v));
      return api.upload<{ document: CareDocument; warning?: string }>(`/care-profiles/${profileId}/documents`, form);
    },
    onSuccess: (res) => onUploaded(res.document, res.warning),
    onError: (err) =>
      setUploadError(err instanceof Error ? err.message : 'The file did not upload. Check your connection and try again.'),
  });

  // Upload always answers: what is missing is named beside it.
  const missing = [
    !file ? 'a file' : null,
    !label.trim() ? 'a name' : null,
    restricted && roles.length === 0 ? 'who can see it' : null,
  ].filter(Boolean) as string[];
  const canSave = missing.length === 0;

  return (
    <Modal open onClose={onClose} title="Upload a document">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (canSave) mutation.mutate();
          else if (!file) document.getElementById('upload-doc-file')?.focus();
        }}
      >
        <div>
          <label htmlFor="upload-doc-file" className="block text-sm font-medium text-ink mb-1">File</label>
          {file && file === initialFile ? (
            <p className="text-sm text-ink break-words">{file.name}</p>
          ) : (
            <input
              id="upload-doc-file"
              type="file"
              className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:text-primary hover:file:bg-primary-100"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !label) setLabel(withoutExtension(f.name));
              }}
            />
          )}
          <p className="mt-1 text-xs text-muted">Up to 50 MB.</p>
        </div>
        <DocumentDetailsFields
          idPrefix="upload-doc"
          profileId={profileId}
          members={members}
          label={label}
          onLabel={setLabel}
          category={category}
          onCategory={setCategory}
          restricted={restricted}
          onRestricted={setRestricted}
          roles={roles}
          onRoles={setRoles}
        >
          <div>
            <label htmlFor="upload-doc-condition" className="block text-sm font-medium text-ink mb-1">What is it for</label>
            <select
              id="upload-doc-condition"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={conditionId}
              onChange={(e) => setConditionId(e.target.value)}
            >
              <option value="">Not for a particular condition</option>
              {conditions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <span className="block text-xs text-muted mt-1">Files it under that condition's tracking as well as here.</span>
          </div>
          <DocumentDatesFields idPrefix="upload-doc" profileId={profileId} category={category} value={dates} onChange={setDates} />
        </DocumentDetailsFields>
        {uploadError ? <p className="text-sm text-red-600">{uploadError}</p> : null}
        {tried && !canSave ? (
          <p className="text-sm text-red-600" role="alert">This upload needs {missing.join(' and ')}.</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Upload</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditDocumentModal({ profileId, doc, members, onClose, onSaved }: { profileId: string; doc: CareDocument; members: CircleMember[]; onClose: () => void; onSaved: () => void }) {
  const [editLabel, setEditLabel] = useState(doc.label);
  const [editCategory, setEditCategory] = useState(categoryNameOf(doc));
  const [restricted, setRestricted] = useState((doc.visible_to_roles?.length ?? 0) > 0);
  const [roles, setRoles] = useState<string[]>(doc.visible_to_roles ?? []);
  const [initialDates] = useState(() => datesFrom(doc));
  const [dates, setDates] = useState<DocumentDatesValue>(initialDates);
  const [editError, setEditError] = useState('');
  const [tried, setTried] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.patch(`/care-profiles/${profileId}/documents/${doc.id}`, {
      label: editLabel.trim(),
      category: editCategory.trim() || 'Other',
      visible_to_roles: restricted ? roles : [],
      ...datesBody(dates, initialDates),
    }),
    onSuccess: onSaved,
    onError: (err) => setEditError(err instanceof Error ? err.message : 'The changes did not save. Check your connection and try again.'),
  });

  // Save always answers: what is missing is named beside it.
  const missing = [!editLabel.trim() ? 'a name' : null, restricted && roles.length === 0 ? 'who can see it' : null].filter(Boolean) as string[];
  const canSave = missing.length === 0;

  return (
    <Modal open onClose={onClose} title="Edit document">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setTried(true); if (canSave) mutation.mutate(); }}>
        <DocumentDetailsFields
          idPrefix="edit-doc"
          profileId={profileId}
          members={members}
          label={editLabel}
          onLabel={setEditLabel}
          category={editCategory}
          onCategory={setEditCategory}
          restricted={restricted}
          onRestricted={setRestricted}
          roles={roles}
          onRoles={setRoles}
        >
          <DocumentDatesFields idPrefix="edit-doc" profileId={profileId} category={editCategory} value={dates} onChange={setDates} note={doc.validity_note} />
        </DocumentDetailsFields>
        {editError ? <p className="text-sm text-red-600">{editError}</p> : null}
        {tried && !canSave ? <p className="text-sm text-red-600" role="alert">This document needs {missing.join(' and ')}.</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Move several documents into one category at once. */
function ChangeCategoryModal({
  profileId,
  docs,
  onClose,
  onSaved,
}: {
  profileId: string;
  docs: CareDocument[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const shared = new Set(docs.map(categoryNameOf));
  const [name, setName] = useState(shared.size === 1 ? [...shared][0] : '');
  const [saveError, setSaveError] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      Promise.all(docs.map((d) => api.patch(`/care-profiles/${profileId}/documents/${d.id}`, { category: name.trim() }))),
    onSuccess: onSaved,
    onError: (err) => setSaveError(err instanceof Error ? err.message : 'Could not change the category.'),
  });
  return (
    <Modal open onClose={onClose} title="Change category">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Save always answers: say what is missing.
          if (name.trim()) mutation.mutate();
          else setSaveError('Pick a category or type a new one, then save.');
        }}
      >
        <p className="text-sm text-muted">
          Files the {docs.length} selected document{docs.length === 1 ? '' : 's'} under one category.
        </p>
        <DocumentCategoryField id="bulk-doc-category" profileId={profileId} value={name} onChange={setName} />
        {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
