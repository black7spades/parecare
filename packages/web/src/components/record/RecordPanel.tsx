import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../api/client';
import { useAssistantStore } from '../../stores/assistant';
import { useAuthStore } from '../../stores/auth';
import type { CareDocument, CircleMember } from '../../lib/care';
import { UploadDocumentModal } from '../../pages/app/profile/DocumentsPage';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';
import { TrashIcon } from '../ui/icons';
import { ForwardedFromTag, ForwardTags, type ForwardedFrom, type SentForward } from '../ForwardNotes';

export interface RecordField {
  label: string;
  /** Left out when empty, so a record only shows what it actually has. */
  value: ReactNode;
}

export interface RecordLink {
  /** What kind of link it is, e.g. "Condition" or "Came from". */
  label: string;
  /** What it points at, e.g. "Sore ankle". */
  value: string;
  /** A page inside PareCare. */
  to?: string;
  /** A page elsewhere, such as a map, opened in a new tab. */
  href?: string;
}

export interface RecordAction {
  label: string;
  onRun: () => void;
  pending?: boolean;
  /** Shown even to someone who cannot edit, e.g. logging a session they are allowed to log. */
  always?: boolean;
}

interface RecordExtras {
  notes: Array<{
    id: string;
    body: string;
    created_at: string;
    author_account_id: string | null;
    author_name: string | null;
    /** Where this note was forwarded to, on an appointment. */
    forwarded_to?: SentForward[];
    /** Who this note came from, when it is a forwarded copy. */
    forwarded_from?: ForwardedFrom | null;
  }>;
  documents: CareDocument[];
  history: Array<{ id: string; action: string; summary: string | null; source: string | null; created_at: string; actor_name: string | null }>;
}

const VERBS: Record<string, string> = { created: 'Added', updated: 'Changed', deleted: 'Removed' };

const isEmpty = (v: ReactNode) => v === null || v === undefined || v === '' || v === false;

/**
 * One record, opened from any list: every detail on its own line, what it is
 * linked to, and the same row of buttons whatever the record is. Edit, Done
 * where it applies, Add a note, Attach a document, Ask Pare about this, Print,
 * Copy link and Delete. Notes, attached documents and history appear for
 * records that belong to a person.
 *
 * Slides in from the right on a wide screen, so the list stays in view, and
 * fills the screen on a phone.
 */
export function RecordPanel({
  kindLabel,
  title,
  subtitle,
  kind,
  recordId,
  profileId,
  fields,
  links = [],
  canEdit,
  onEdit,
  done,
  extra = [],
  onDelete,
  deleteLabel = 'Delete',
  onClose,
  onForwardNote,
  children,
}: {
  /** What this is, in a word or two: "Appointment", "Medication". */
  kindLabel: string;
  title: string;
  subtitle?: string;
  /** The record's kind as the activity trail names it, e.g. "appointments". */
  kind?: string;
  recordId: string;
  /** The person it belongs to; leave out for shared directory records. */
  profileId?: string;
  fields: RecordField[];
  links?: RecordLink[];
  canEdit: boolean;
  onEdit?: () => void;
  /** Marks it done, for records that can be: a task, a next step, an appointment. */
  done?: RecordAction | null;
  /** Buttons only this kind of record has, e.g. Record a dose. */
  extra?: RecordAction[];
  onDelete?: () => void;
  /** "Remove" where the record is only unlinked from this person, not destroyed. */
  deleteLabel?: 'Delete' | 'Remove';
  onClose: () => void;
  /** Offers Forward on each note, for records whose notes can be passed on. */
  onForwardNote?: (noteId: string) => void;
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const myId = useAuthStore((s) => s.account?.id);
  const askPare = useAssistantStore((s) => s.openWithMessage);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [attachId, setAttachId] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const personal = !!profileId && !!kind;
  const extrasKey = ['record-extras', profileId, kind, recordId];
  const base = personal ? `/care-profiles/${profileId}/records/${kind}/${recordId}` : '';

  const { data: extras } = useQuery({
    queryKey: extrasKey,
    queryFn: () => api.get<RecordExtras>(base),
    enabled: personal,
  });
  const { data: docData } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
    enabled: personal && canEdit,
  });
  const { data: circleData } = useQuery({
    queryKey: ['circle', profileId],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profileId}/circle`),
    enabled: personal && canEdit,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: extrasKey });

  const addNote = useMutation({
    mutationFn: () => api.post(`${base}/notes`, { body: note.trim() }),
    onSuccess: () => { setNote(''); setError(''); refresh(); },
    onError: (err) => setError(err instanceof Error ? err.message : 'The note did not save. Try again in a moment.'),
  });
  const removeNote = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/records/notes/${id}`),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not remove the note.'),
  });
  const attach = useMutation({
    mutationFn: (documentId: string) => api.post(`${base}/documents`, { document_id: documentId }),
    onSuccess: () => { setAttachId(''); setError(''); refresh(); },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not attach the document.'),
  });
  const detach = useMutation({
    mutationFn: (documentId: string) => api.delete(`${base}/documents/${documentId}`),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not take the document off.'),
  });

  // Escape closes, and the panel takes focus so the keyboard starts inside it.
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, uploading]);

  const shown = fields.filter((f) => !isEmpty(f.value));
  const attachedIds = new Set((extras?.documents ?? []).map((d) => d.id));
  const attachable = (docData?.documents ?? []).filter((d) => !attachedIds.has(d.id));

  const plainText = () =>
    [`${kindLabel}: ${title}`, subtitle, ...shown.map((f) => `${f.label}: ${typeof f.value === 'string' || typeof f.value === 'number' ? f.value : ''}`)]
      .filter(Boolean)
      .join('\n');

  const print = () => {
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) {
      setError('Your browser blocked the print window. Allow pop-ups for PareCare and try again.');
      return;
    }
    const body = panelRef.current?.querySelector('[data-print]')?.innerHTML ?? '';
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>` +
        '<style>body{font:14px/1.5 system-ui,sans-serif;color:#111;margin:32px}h2{font-size:20px;margin:0 0 4px}h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#555;margin:20px 0 6px}dl{display:grid;grid-template-columns:10rem 1fr;gap:4px 12px;margin:0}dt{color:#555}dd{margin:0}ul{padding-left:18px;margin:0}button{display:none}</style>' +
        `</head><body>${body}</body></html>`
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const copyLink = async () => {
    const url = window.location.href;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Could not copy the link. Copy it from the address bar instead.');
    }
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="record-panel-title">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute right-0 top-0 h-full w-full sm:max-w-lg overflow-y-auto bg-card shadow-xl focus:outline-none"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">{kindLabel}</p>
              <h2 id="record-panel-title" className="text-lg font-semibold text-ink break-words">{title}</h2>
              {subtitle ? <p className="text-sm text-muted break-words">{subtitle}</p> : null}
            </div>
            <Button size="sm" variant="ghost" aria-label="Close" title="Close" onClick={onClose}>✕</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {canEdit && done ? <Button size="sm" loading={done.pending} onClick={done.onRun}>{done.label}</Button> : null}
            {canEdit && onEdit ? <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button> : null}
            {extra.filter((a) => canEdit || a.always).map((a) => (
              <Button key={a.label} size="sm" variant="secondary" loading={a.pending} onClick={a.onRun}>{a.label}</Button>
            ))}
            {canEdit && personal ? (
              <Button size="sm" variant="ghost" onClick={() => document.getElementById('record-note')?.focus()}>Add a note</Button>
            ) : null}
            {canEdit && personal ? (
              <Button size="sm" variant="ghost" onClick={() => setUploading(true)}>Attach a document</Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                askPare(`About this ${kindLabel.toLowerCase()}:\n${plainText()}\n\nWhat should I know about it, and is there anything I should do next?`, profileId ?? null);
                onClose();
              }}
            >
              Ask Pare about this
            </Button>
            <Button size="sm" variant="ghost" onClick={print}>Print</Button>
            <Button size="sm" variant="ghost" onClick={() => void copyLink()}>{copied ? 'Link copied' : 'Copy link'}</Button>
            {canEdit && onDelete ? <Button size="sm" variant="ghost-danger" onClick={onDelete}>{deleteLabel}</Button> : null}
          </div>
        </div>

        <div className="space-y-6 px-5 py-4" data-print>
          <h2 className="hidden print:block">{title}</h2>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Details</h3>
            {shown.length === 0 ? (
              <p className="text-sm text-muted">Nothing more recorded.</p>
            ) : (
              <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                {shown.map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="text-muted">{f.label}</dt>
                    <dd className="text-ink break-words whitespace-pre-wrap">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {links.length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Linked to</h3>
              <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                {links.map((l) => (
                  <div key={`${l.label}-${l.value}`} className="contents">
                    <dt className="text-muted">{l.label}</dt>
                    <dd className="break-words">
                      {l.to ? (
                        <Link to={l.to} className="text-primary hover:underline">{l.value}</Link>
                      ) : l.href ? (
                        <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{l.value}</a>
                      ) : (
                        <span className="text-ink">{l.value}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {children}

          {personal ? (
            <>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Notes added</h3>
                {canEdit ? (
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (note.trim()) addNote.mutate();
                    }}
                  >
                    <Textarea
                      id="record-note"
                      aria-label="Add a note"
                      placeholder="Add a note, e.g. Pharmacy will call when it arrives"
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <Button type="submit" size="sm" variant="secondary" loading={addNote.isPending} disabled={!note.trim()}>Add note</Button>
                    </div>
                  </form>
                ) : null}
                {(extras?.notes ?? []).length === 0 ? (
                  <p className="text-sm text-muted mt-1">No notes yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {extras!.notes.map((n) => (
                      <li key={n.id} className="rounded-md border border-border px-3 py-2">
                        <div className="flex items-start gap-2">
                          <p className={`flex-1 text-sm whitespace-pre-wrap break-words ${(n.forwarded_to ?? []).length ? 'text-muted' : 'text-ink'}`}>{n.body}</p>
                          {canEdit && onForwardNote ? (
                            <Button size="xs" variant="ghost" onClick={() => onForwardNote(n.id)}>Forward</Button>
                          ) : null}
                          {canEdit && n.author_account_id === myId ? (
                            <Button size="xs" variant="ghost-danger" aria-label="Remove this note" title="Remove" onClick={() => removeNote.mutate(n.id)}>
                              <TrashIcon />
                            </Button>
                          ) : null}
                        </div>
                        {n.forwarded_from && profileId ? (
                          <ForwardedFromTag profileId={profileId} from={n.forwarded_from} />
                        ) : (
                          <p className="text-xs text-muted">
                            {n.author_name ?? 'Someone'}, {format(new Date(n.created_at), 'd MMM yyyy, HH:mm')}
                          </p>
                        )}
                        {profileId && (n.forwarded_to ?? []).length ? (
                          <ForwardTags profileId={profileId} forwards={n.forwarded_to!} canEdit={canEdit} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Documents</h3>
                {(extras?.documents ?? []).length === 0 ? (
                  <p className="text-sm text-muted">None attached.</p>
                ) : (
                  <ul className="space-y-1">
                    {extras!.documents.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 text-sm">
                        <Link to={`/app/${profileId}/documents?doc=${d.id}`} className="flex-1 text-primary hover:underline break-words">{d.label}</Link>
                        <span className="text-xs text-muted">{format(new Date(d.created_at), 'd MMM yyyy')}</span>
                        {canEdit ? (
                          <Button size="xs" variant="ghost" aria-label={`Take ${d.label} off this record`} title="Take off this record" onClick={() => detach.mutate(d.id)}>✕</Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && attachable.length > 0 ? (
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      aria-label="Attach a document already on file"
                      className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      value={attachId}
                      onChange={(e) => setAttachId(e.target.value)}
                    >
                      <option value="">Attach one already on file…</option>
                      {attachable.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                    </select>
                    <Button size="sm" variant="secondary" disabled={!attachId} loading={attach.isPending} onClick={() => attach.mutate(attachId)}>Attach</Button>
                  </div>
                ) : null}
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">History</h3>
                {(extras?.history ?? []).length === 0 ? (
                  <p className="text-sm text-muted">No changes recorded yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {extras!.history.map((h) => (
                      <li key={h.id} className="text-sm">
                        <span className="text-ink">{VERBS[h.action] ?? 'Changed'}</span>
                        <span className="text-muted">
                          {' '}by {h.source === 'pare' ? 'Pare' : h.actor_name ?? 'someone'}, {format(new Date(h.created_at), 'd MMM yyyy, HH:mm')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>

      {uploading && profileId && kind ? (
        <UploadDocumentModal
          profileId={profileId}
          members={circleData?.members ?? []}
          initialFile={null}
          link={{ kind, id: recordId }}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            refresh();
            void queryClient.invalidateQueries({ queryKey: ['documents', profileId] });
          }}
        />
      ) : null}
    </div>
  );
}
