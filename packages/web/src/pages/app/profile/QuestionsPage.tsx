import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useProfile } from './ProfileLayout';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { ToneBlockNotice, extractToneBlock, type ToneBlock } from '../../../components/ToneBlockNotice';
import type { OpenQuestion, QuestionResponse } from '../../../lib/care';

const STATUS_STYLES: Record<OpenQuestion['status'], string> = {
  open: 'bg-amber-50 text-amber-700',
  resolved: 'bg-primary-50 text-primary',
  deferred: 'bg-surface-2 text-muted',
};

const QUESTION_SORTS: DataSort<OpenQuestion>[] = [
  { key: 'newest', label: 'Newest first', compare: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() },
  { key: 'oldest', label: 'Oldest first', compare: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() },
  { key: 'title', label: 'By question (A–Z)', compare: (a, b) => a.title.localeCompare(b.title) },
  { key: 'status', label: 'By status', compare: (a, b) => {
    const order: Record<string, number> = { open: 0, deferred: 1, resolved: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.title.localeCompare(b.title);
  }},
];

const STATUS_FILTER: DataFilter<OpenQuestion> = {
  key: 'status',
  label: 'Status',
  options: [
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'deferred', label: 'Deferred' },
  ],
  match: (q, v) => q.status === v,
};

export function QuestionsPage() {
  const { profile, access, canEdit, careName } = useProfile();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [toneBlock, setToneBlock] = useState<ToneBlock | null>(null);
  const [resolving, setResolving] = useState<OpenQuestion | null>(null);
  const [editing, setEditing] = useState<OpenQuestion | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const canManage = access === 'owner' || access === 'admin';

  const { data, isLoading } = useQuery({
    queryKey: ['questions', profile.id],
    queryFn: () => api.get<{ questions: OpenQuestion[] }>(`/care-profiles/${profile.id}/questions`),
  });
  const questions = data?.questions ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['questions', profile.id] });

  const dv = useDataView<OpenQuestion>({
    rows: questions,
    getId: (q) => q.id,
    searchText: (q) => [q.title, q.body, q.status, q.resolution].filter(Boolean).join(' '),
    sorts: QUESTION_SORTS,
    filters: [STATUS_FILTER],
  });

  const createMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profile.id}/questions`, { title: title.trim(), body: body.trim() || null }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setToneBlock(null);
      invalidate();
    },
    onError: (err) => {
      const block = extractToneBlock(err);
      if (block) setToneBlock(block);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OpenQuestion['status'] }) =>
      api.patch(`/care-profiles/${profile.id}/questions/${id}`, { status }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/questions/${id}`),
    onSuccess: invalidate,
  });

  const bulkResolveMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profile.id}/questions/bulk`, {
      action: 'resolve',
      ids: dv.selectedRows.map((q) => q.id),
    }),
    onSuccess: () => { dv.clearSelection(); invalidate(); },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profile.id}/questions/bulk`, {
      action: 'delete',
      ids: dv.selectedRows.map((q) => q.id),
    }),
    onSuccess: () => { setConfirmBulkDelete(false); dv.clearSelection(); invalidate(); },
  });

  const bulkActions: ToolbarBulkAction[] = [
    ...(canEdit ? [{ key: 'resolve', label: 'Mark resolved', onRun: () => bulkResolveMutation.mutate() }] : []),
    ...(canManage ? [{ key: 'delete', label: 'Delete selected', destructive: true, onRun: () => setConfirmBulkDelete(true) }] : []),
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      {canEdit ? (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) createMutation.mutate();
          }}
        >
          <h2 className="text-base font-semibold text-ink">Raise a question</h2>
          <p className="text-sm text-muted -mt-2">
            Open questions the family needs to settle: "Should mum still be driving?", "Who takes February visits?"
          </p>
          <Input label="Question" value={title} onChange={(e) => { setTitle(e.target.value); if (toneBlock) setToneBlock(null); }} required />
          <Textarea label="Context (optional)" value={body} onChange={(e) => { setBody(e.target.value); if (toneBlock) setToneBlock(null); }} rows={2} />
          {toneBlock ? <ToneBlockNotice careName={careName} block={toneBlock} onDismiss={() => setToneBlock(null)} /> : null}
          <div className="flex justify-end">
            <Button type="submit" loading={createMutation.isPending} disabled={!title.trim()}>
              Raise question
            </Button>
          </div>
        </form>
      ) : null}

      <DataToolbar
        search={dv.search}
        onSearch={dv.setSearch}
        searchPlaceholder="Search questions..."
        sorts={QUESTION_SORTS.map((s) => ({ key: s.key, label: s.label }))}
        sortKey={dv.sortKey}
        onSort={dv.setSortKey}
        filters={[STATUS_FILTER].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
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
        <p className="text-sm text-muted">Loading...</p>
      ) : dv.view.length === 0 ? (
        <p className="text-sm text-muted">
          {questions.length === 0 ? 'No questions raised yet.' : 'No questions match your search or filters.'}
        </p>
      ) : (
        <div className="space-y-4">
          {dv.view.map((q) => (
            <div key={q.id} className="flex items-start gap-3">
              {(canEdit || canManage) ? (
                <div className="pt-4 shrink-0">
                  <input
                    type="checkbox"
                    aria-label={`Select "${q.title}"`}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={dv.selected.has(q.id)}
                    onChange={() => dv.toggle(q.id)}
                  />
                </div>
              ) : null}
              <div className="flex-1 min-w-0">
                <QuestionCard
                  profileId={profile.id}
                  question={q}
                  canManage={canManage}
                  canEdit={canEdit}
                  onResolve={() => setResolving(q)}
                  onReopen={() => statusMutation.mutate({ id: q.id, status: 'open' })}
                  onDefer={() => statusMutation.mutate({ id: q.id, status: 'deferred' })}
                  onEdit={() => setEditing(q)}
                  onDelete={() => deleteMutation.mutate(q.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <ResolveModal
        profileId={profile.id}
        question={resolving}
        onClose={() => setResolving(null)}
        onSaved={() => {
          setResolving(null);
          invalidate();
        }}
      />

      {editing ? (
        <EditQuestionModal
          profileId={profile.id}
          question={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      ) : null}

      <Modal open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} title="Delete questions">
        <p className="text-sm text-muted mb-4">
          Permanently delete <span className="font-medium text-ink">{dv.selectedRows.length}</span> selected
          question{dv.selectedRows.length === 1 ? '' : 's'}? Their responses will be removed too. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
          <Button variant="danger" loading={bulkDeleteMutation.isPending} onClick={() => bulkDeleteMutation.mutate()}>
            Delete {dv.selectedRows.length}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function QuestionCard({
  profileId,
  question,
  canManage,
  canEdit,
  onResolve,
  onReopen,
  onDefer,
  onEdit,
  onDelete,
}: {
  profileId: string;
  question: OpenQuestion;
  canManage: boolean;
  canEdit: boolean;
  onResolve: () => void;
  onReopen: () => void;
  onDefer: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState('');
  const [mediateError, setMediateError] = useState('');

  const { data } = useQuery({
    queryKey: ['question-responses', question.id],
    queryFn: () => api.get<{ responses: QuestionResponse[] }>(`/care-profiles/${profileId}/questions/${question.id}/responses`),
    enabled: expanded,
  });
  const responses = data?.responses ?? [];

  const replyMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/questions/${question.id}/responses`, { body: reply.trim() }),
    onSuccess: () => {
      setReply('');
      void queryClient.invalidateQueries({ queryKey: ['question-responses', question.id] });
    },
  });

  const mediateMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/questions/${question.id}/mediate`),
    onSuccess: () => {
      setMediateError('');
      void queryClient.invalidateQueries({ queryKey: ['question-responses', question.id] });
    },
    onError: (err) => {
      setMediateError(
        err instanceof Error && /api key|not configured/i.test(err.message)
          ? 'Mediation needs the AI assistant configured. Ask the admin to set AI_PROVIDER on the server.'
          : err instanceof Error
            ? err.message
            : 'Mediation failed'
      );
    },
  });

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-ink">{question.title}</h3>
            <span className={`badge text-xs capitalize ${STATUS_STYLES[question.status]}`}>{question.status}</span>
          </div>
          <p className="text-xs text-muted mt-0.5">Raised {format(new Date(question.created_at), 'd MMM yyyy')}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {question.status === 'open' ? (
            <>
              <Button size="sm" variant="secondary" onClick={onResolve}>
                Resolve
              </Button>
              <Button size="sm" variant="ghost" onClick={onDefer}>
                Defer
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={onReopen}>
              Reopen
            </Button>
          )}
          {canEdit ? (
            <Button size="xs" variant="ghost" aria-label="Edit question" title="Edit" onClick={onEdit}>
              <PencilIcon />
            </Button>
          ) : null}
          {canManage ? (
            <Button size="xs" variant="ghost-danger" aria-label="Delete question" title="Delete" onClick={onDelete}>
              <TrashIcon />
            </Button>
          ) : null}
        </div>
      </div>
      {question.body ? <p className="text-sm text-ink mt-2 whitespace-pre-wrap">{question.body}</p> : null}
      {question.resolution ? (
        <p className="text-sm mt-2 rounded-md bg-primary-50 text-primary px-3 py-2">
          <span className="font-medium">Decision:</span> {question.resolution}
        </p>
      ) : null}

      <Button size="xs" variant="ghost" className="mt-3" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Hide discussion' : responses.length ? `Show discussion with ${responses.length} ${responses.length === 1 ? 'response' : 'responses'}` : 'Show discussion'}
      </Button>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {responses.length === 0 ? (
            <p className="text-xs text-muted">No responses yet.</p>
          ) : (
            responses.map((r) =>
              r.is_ai ? (
                <div key={r.id} className="rounded-md border border-primary-100 bg-primary-50/50 px-3 py-2">
                  <p className="text-xs font-medium text-primary mb-1">
                    PareCare mediator · {format(new Date(r.created_at), 'd MMM, HH:mm')}
                  </p>
                  <p className="text-sm text-ink whitespace-pre-wrap">{r.body}</p>
                </div>
              ) : (
                <div key={r.id}>
                  <p className="text-xs text-muted">
                    {r.author_name ?? 'Someone'} · {format(new Date(r.created_at), 'd MMM, HH:mm')}
                  </p>
                  <p className="text-sm text-ink whitespace-pre-wrap">{r.body}</p>
                </div>
              )
            )
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) replyMutation.mutate();
            }}
          >
            <div className="flex-1">
              <Input placeholder="Add a response..." value={reply} onChange={(e) => setReply(e.target.value)} />
            </div>
            <Button type="submit" size="sm" variant="secondary" loading={replyMutation.isPending} disabled={!reply.trim()}>
              Reply
            </Button>
          </form>
          {question.status === 'open' ? (
            <div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                loading={mediateMutation.isPending}
                onClick={() => mediateMutation.mutate()}
              >
                Ask PareCare to mediate
              </Button>
              <p className="text-xs text-muted mt-1">
                Posts a neutral summary into the thread: what everyone agrees on, each person's view stated fairly,
                options, and a suggested next step. It never takes sides.
              </p>
              {mediateError ? <p className="text-xs text-red-600 mt-1">{mediateError}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EditQuestionModal({
  profileId,
  question,
  onClose,
  onSaved,
}: {
  profileId: string;
  question: OpenQuestion;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editTitle, setEditTitle] = useState(question.title);
  const [editBody, setEditBody] = useState(question.body ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/questions/${question.id}`, {
        title: editTitle.trim(),
        body: editBody.trim() || null,
      }),
    onSuccess: onSaved,
  });

  return (
    <Modal open onClose={onClose} title="Edit question">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (editTitle.trim()) mutation.mutate();
        }}
      >
        <Input label="Question" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
        <Textarea label="Context (optional)" value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={3} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!editTitle.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResolveModal({
  profileId,
  question,
  onClose,
  onSaved,
}: {
  profileId: string;
  question: OpenQuestion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [resolution, setResolution] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/questions/${question!.id}`, {
        status: 'resolved',
        resolution: resolution.trim() || null,
        resolved_at: new Date().toISOString(),
      }),
    onSuccess: () => {
      setResolution('');
      onSaved();
    },
  });

  if (!question) return null;
  return (
    <Modal open onClose={onClose} title="Resolve question">
      <p className="text-sm text-ink mb-3 font-medium">{question.title}</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Textarea
          label="What was decided?"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          rows={3}
          placeholder="Record the decision so it isn't re-litigated in six months"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Mark resolved
          </Button>
        </div>
      </form>
    </Modal>
  );
}
