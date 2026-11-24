import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useProfile } from './ProfileLayout';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { ToneBlockNotice, extractToneBlock, type ToneBlock } from '../../../components/ToneBlockNotice';
import type { OpenQuestion, QuestionResponse } from '../../../lib/care';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { Link } from 'react-router-dom';
import { ContactPicker, contactProblem, emptyContact, pickedFrom, type PickedContact } from '../../../components/ContactPicker';
import { CONTACT_LINK } from '../../../components/ContactStrip';
import { EmptyState } from '../../../components/EmptyState';
import { usePareOn } from '../../../lib/aiStatus';
import { noticeFiled } from '../../../stores/notice';

const STATUS_LABELS: Record<OpenQuestion['status'], string> = {
  open: 'Open',
  resolved: 'Resolved',
  deferred: 'Deferred',
};

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
  const { profile, access, canEdit, careName, voice } = useProfile();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ask, setAsk] = useState<AskValue>({ who: emptyContact, askAt: '' });
  const pareOn = usePareOn();
  const [toneBlock, setToneBlock] = useState<ToneBlock | null>(null);
  const [resolving, setResolving] = useState<OpenQuestion | null>(null);
  const [editing, setEditing] = useState<OpenQuestion | null>(null);

  const canManage = access === 'owner' || access === 'admin';

  const { data, isLoading } = useQuery({
    queryKey: ['questions', profile.id],
    queryFn: () => api.get<{ questions: OpenQuestion[] }>(`/care-profiles/${profile.id}/questions`),
  });
  const questions = data?.questions ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['questions', profile.id] });

  // Deleting is held back a few seconds with Undo, never a "sure?" box.
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const hidden = useHiddenIds();
  const deleteQuestions = (items: OpenQuestion[]) => {
    if (items.length === 0) return;
    deferDelete({
      message: items.length === 1 ? `Deleted ${items[0].title}.` : `Deleted ${items.length} questions.`,
      ids: items.map((q) => q.id),
      commit: () =>
        items.length === 1
          ? api.delete(`/care-profiles/${profile.id}/questions/${items[0].id}`)
          : api.post(`/care-profiles/${profile.id}/questions/bulk`, { action: 'delete', ids: items.map((q) => q.id) }),
      onCommitted: invalidate,
    });
  };

  const visible = questions.filter((q) => !hidden.has(q.id));
  const panel = useRecordPanel(visible, (q) => q.id);
  const dv = useDataView<OpenQuestion>({
    rows: visible,
    getId: (q) => q.id,
    searchText: (q) => [q.title, q.body, q.status, q.resolution].filter(Boolean).join(' '),
    sorts: QUESTION_SORTS,
    filters: [STATUS_FILTER],
  });

  // Raise question always answers: an empty question says what to write.
  const [raiseError, setRaiseError] = useState('');
  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ filed?: Array<{ id: string; name: string }> }>(`/care-profiles/${profile.id}/questions`, { title: title.trim(), body: body.trim() || null, ...askBody(ask) }),
    onSuccess: (res) => {
      noticeFiled(profile.id, res?.filed ?? []);
      void queryClient.invalidateQueries({ queryKey: ['appointments', profile.id] });
      setTitle('');
      setBody('');
      setAsk({ who: emptyContact, askAt: '' });
      setToneBlock(null);
      setRaiseError('');
      invalidate();
    },
    onError: (err) => {
      const block = extractToneBlock(err);
      if (block) setToneBlock(block);
      else setRaiseError(err instanceof Error ? err.message : 'The question was not saved. Try again in a moment.');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OpenQuestion['status'] }) =>
      api.patch(`/care-profiles/${profile.id}/questions/${id}`, { status }),
    onSuccess: invalidate,
  });

  const bulkResolveMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profile.id}/questions/bulk`, {
      action: 'resolve',
      ids: dv.selectedRows.map((q) => q.id),
    }),
    onSuccess: () => { dv.clearSelection(); invalidate(); },
  });

  const bulkActions: ToolbarBulkAction[] = [
    ...(canEdit ? [{ key: 'resolve', label: 'Mark resolved', onRun: () => bulkResolveMutation.mutate() }] : []),
    ...(canManage ? [{ key: 'delete', label: 'Delete selected', destructive: true, onRun: () => { deleteQuestions([...dv.selectedRows]); dv.clearSelection(); } }] : []),
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      {canEdit ? (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) {
              setRaiseError('Write the question first, then raise it. For example: Who takes the visits next month?');
              document.getElementById('question-title')?.focus();
              return;
            }
            const unpicked = contactProblem(ask.who, 'who to ask');
            if (unpicked) {
              setRaiseError(unpicked);
              document.getElementById('question-ask')?.focus();
              return;
            }
            setRaiseError('');
            createMutation.mutate();
          }}
        >
          <h2 className="text-sm font-semibold text-ink">Ask a question</h2>
          <EditableSubheader copyKey="profile.questions.subheader" voice={voice} className="-mt-2" />
          <Input id="question-title" label="Question" value={title} onChange={(e) => { setTitle(e.target.value); if (toneBlock) setToneBlock(null); if (raiseError) setRaiseError(''); }} />
          <Textarea label="More about it" hint="Optional." value={body} onChange={(e) => { setBody(e.target.value); if (toneBlock) setToneBlock(null); }} rows={2} />
          <AskFields idPrefix="question" profileId={profile.id} value={ask} onChange={(v) => { setAsk(v); if (raiseError) setRaiseError(''); }} />
          {toneBlock ? <ToneBlockNotice careName={careName} block={toneBlock} onDismiss={() => setToneBlock(null)} /> : null}
          {raiseError ? <p className="text-sm text-red-600" role="alert">{raiseError}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" loading={createMutation.isPending}>
              Save the question
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
      ) : questions.length === 0 ? (
        <EmptyState
          says="Write down what to ask a doctor or the family, and it shows at the next visit."
          actionLabel="Ask a question"
          onAction={() => document.getElementById('question-title')?.focus()}
          canAdd={canEdit}
          access={access}
          name={careName}
          page="Questions page"
          managerName={profile.manager_name}
        />
      ) : dv.view.length === 0 ? (
        <p className="text-sm text-muted">No questions match your search or filters.</p>
      ) : (
        <div className="space-y-4">
          {dv.view.map((q) => (
            <div key={q.id} {...panel.rowProps(q.id)} className={`flex items-start gap-3 rounded-lg ${RECORD_ROW_CLASS}`}>
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
                  pareOn={pareOn}
                  canManage={canManage}
                  canEdit={canEdit}
                  onResolve={() => setResolving(q)}
                  onReopen={() => statusMutation.mutate({ id: q.id, status: 'open' })}
                  onDefer={() => statusMutation.mutate({ id: q.id, status: 'deferred' })}
                  onEdit={() => setEditing(q)}
                  onDelete={() => deleteQuestions([q])}
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

      {panel.current ? (() => {
        const q = panel.current;
        return (
          <RecordPanel
            key={q.id}
            kindLabel="Question"
            title={q.title}
            subtitle={`Raised ${format(new Date(q.created_at), 'd MMM yyyy')}`}
            kind="questions"
            recordId={q.id}
            profileId={profile.id}
            canEdit={canEdit}
            fields={[
              { label: 'Question', value: q.title },
              { label: 'More about it', value: q.body },
              { label: 'Who to ask', value: q.ask?.name ?? null },
              { label: 'Ask at', value: q.ask_at ? visitLabel(q.ask_at) : null },
              { label: 'Raised by', value: q.raised_by_name ?? null },
              { label: 'Status', value: STATUS_LABELS[q.status] },
              { label: 'Raised', value: format(new Date(q.created_at), 'd MMM yyyy') },
              { label: 'What was decided', value: q.resolution },
            ]}
            links={q.ask_at ? [{ label: 'Ask at', value: q.ask_at.title, to: `/app/${profile.id}/appointments?record=${q.ask_at.id}` }] : []}
            onEdit={() => setEditing(q)}
            done={q.status === 'open' ? { label: 'Resolve', onRun: () => setResolving(q) } : null}
            extra={
              q.status === 'open'
                ? [{ label: 'Defer', onRun: () => statusMutation.mutate({ id: q.id, status: 'deferred' }), pending: statusMutation.isPending }]
                : [{ label: 'Reopen', onRun: () => statusMutation.mutate({ id: q.id, status: 'open' }), pending: statusMutation.isPending }]
            }
            onDelete={canManage ? () => {
              deleteQuestions([q]);
              panel.close();
            } : undefined}
            onClose={panel.close}
          >
            <QuestionDiscussion profileId={profile.id} questionId={q.id} />
          </RecordPanel>
        );
      })() : null}
    </div>
  );
}

interface UpcomingVisit { id: string; title: string; starts_at: string | null; all_day?: boolean; provider_id: string | null; provider_name: string | null; status: string }

/** Visits still to come, soonest first, for Ask at. */
function useUpcomingVisits(profileId: string) {
  const { data } = useQuery({
    queryKey: ['appointments', profileId],
    queryFn: () => api.get<{ appointments: UpcomingVisit[] }>(`/care-profiles/${profileId}/appointments`),
  });
  const soon = Date.now() - 2 * 3600 * 1000;
  return (data?.appointments ?? [])
    .filter((a) => a.status === 'scheduled' && (!a.starts_at || new Date(a.starts_at).getTime() >= soon))
    .sort((a, b) => (a.starts_at ? new Date(a.starts_at).getTime() : Infinity) - (b.starts_at ? new Date(b.starts_at).getTime() : Infinity));
}

const visitLabel = (a: { title: string; starts_at: string | null; all_day?: boolean }) =>
  a.starts_at ? `${a.title}, ${format(new Date(a.starts_at), 'EEE d MMM')}${a.all_day ? '' : `, ${format(new Date(a.starts_at), 'HH:mm')}`}` : `${a.title}, not booked yet`;

/** What a question carries: who to ask and the visit to ask at. */
interface AskValue {
  who: PickedContact;
  /** '' the next visit with whoever it is for, worked out; else the visit chosen. */
  askAt: string;
}

/**
 * Who to ask and the visit to ask at. Picking someone puts the question on
 * the next visit with them, and says so; any visit can be picked instead.
 */
function AskFields({ idPrefix, profileId, value, onChange }: { idPrefix: string; profileId: string; value: AskValue; onChange: (v: AskValue) => void }) {
  const visits = useUpcomingVisits(profileId);
  const worked = !value.askAt && value.who.providerId ? visits.find((v) => v.provider_id === value.who.providerId && v.starts_at) ?? null : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ContactPicker
        id={`${idPrefix}-ask`}
        label="Who to ask"
        profileId={profileId}
        value={value.who}
        onChange={(who) => onChange({ ...value, who })}
        hint="A doctor or anyone in Contacts. Leave it empty for a question for the family."
      />
      <div>
        <label htmlFor={`${idPrefix}-at`} className="block text-sm font-medium text-ink mb-1">Ask at</label>
        <select
          id={`${idPrefix}-at`}
          className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          value={value.askAt}
          onChange={(e) => onChange({ ...value, askAt: e.target.value })}
        >
          <option value="">{worked ? `The next visit with them: ${visitLabel(worked)}` : value.who.name.trim() ? 'The next visit with them' : 'No particular visit'}</option>
          {visits.map((v) => (
            <option key={v.id} value={v.id}>{visitLabel(v)}{v.provider_name ? `, ${v.provider_name}` : ''}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">
          {worked
            ? `Worked out from who to ask: it shows on ${worked.title}, so it is there at the visit. Change it here.`
            : 'It shows on that appointment, so it is on screen at the visit.'}
        </p>
      </div>
    </div>
  );
}

/** What the question form sends for who to ask and when. */
function askBody(v: AskValue, before?: AskValue): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const whoMoved = !before || before.who.providerId !== v.who.providerId || (!v.who.providerId && before.who.name.trim() !== v.who.name.trim());
  if (whoMoved) {
    if (v.who.providerId) Object.assign(out, { provider_id: v.who.providerId, ...(v.who.phone.trim() ? { provider_phone: v.who.phone.trim() } : {}) });
    else if (v.who.name.trim() && v.who.isNew) Object.assign(out, { provider_name: v.who.name.trim(), provider_type: v.who.providerType.trim() || null, provider_phone: v.who.phone.trim() || null });
    else if (before) out['provider_id'] = null;
  }
  // A new question left on the next visit is placed by the server; a change
  // back to it clears the visit chosen before.
  if (!before) {
    if (v.askAt) out['appointment_id'] = v.askAt;
  } else if (before.askAt !== v.askAt) {
    out['appointment_id'] = v.askAt || null;
  }
  return out;
}

const askFrom = (q: OpenQuestion): AskValue => ({
  who: pickedFrom(q.ask ?? null),
  askAt: q.appointment_id && !q.inferred_fields?.includes('appointment_id') ? q.appointment_id : '',
});

/** Who to ask and the visit, under the question. */
function AskLine({ profileId, question }: { profileId: string; question: OpenQuestion }) {
  if (!question.ask && !question.ask_at) return null;
  const worked = (question.inferred_fields ?? []).length > 0;
  return (
    <p className="text-xs text-muted mt-0.5">
      {question.ask ? <>Ask {question.ask.name}</> : null}
      {question.ask && question.ask_at ? ', at ' : question.ask_at ? 'At ' : ''}
      {question.ask_at ? (
        <Link to={`/app/${profileId}/appointments?record=${question.ask_at.id}`} className={CONTACT_LINK}>
          {visitLabel(question.ask_at)}
        </Link>
      ) : null}
      {question.inferred_fields?.includes('provider_id') ? '. Worked out from the question.' : worked ? '. Worked out from who to ask.' : ''}
    </p>
  );
}

function QuestionCard({
  profileId,
  question,
  pareOn,
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
  pareOn: boolean;
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
  const [replyError, setReplyError] = useState('');
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
          ? 'Pare is switched off here, so it cannot write a summary. Everything else on this question still works.'
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
          <p className="text-xs text-muted mt-0.5">
            Raised {format(new Date(question.created_at), 'd MMM yyyy')}{question.raised_by_name ? ` by ${question.raised_by_name}` : ''}
          </p>
          <AskLine profileId={profileId} question={question} />
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
        <div className="mt-3 space-y-3 border-t border-border pt-3" data-no-open>
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
              // Reply always answers: an empty box says what to write.
              if (reply.trim()) replyMutation.mutate();
              else {
                setReplyError('Write the reply first, then send it.');
                document.getElementById(`reply-${question.id}`)?.focus();
              }
            }}
          >
            <div className="flex-1">
              <Input id={`reply-${question.id}`} aria-label="Reply" placeholder="Add a reply" value={reply} onChange={(e) => { setReply(e.target.value); setReplyError(''); }} />
            </div>
            <Button type="submit" size="sm" variant="secondary" loading={replyMutation.isPending}>
              Reply
            </Button>
          </form>
          {replyError ? <p className="text-xs text-red-600" role="alert">{replyError}</p> : null}
          {question.status === 'open' && pareOn ? (
            <div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                loading={mediateMutation.isPending}
                onClick={() => mediateMutation.mutate()}
              >
                Ask Pare for a fair summary
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

/** The discussion so far, read-only, for the question's own view. */
function QuestionDiscussion({ profileId, questionId }: { profileId: string; questionId: string }) {
  const { data } = useQuery({
    queryKey: ['question-responses', questionId],
    queryFn: () => api.get<{ responses: QuestionResponse[] }>(`/care-profiles/${profileId}/questions/${questionId}/responses`),
  });
  const responses = data?.responses ?? [];
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Discussion</h3>
      {responses.length === 0 ? (
        <p className="text-sm text-muted">No responses yet. Reply from the question in the list.</p>
      ) : (
        <ul className="space-y-2">
          {responses.map((r) => (
            <li key={r.id} className="rounded-md border border-border px-3 py-2">
              <p className="text-xs text-muted">
                {r.is_ai ? 'PareCare mediator' : r.author_name ?? 'Someone'}, {format(new Date(r.created_at), 'd MMM, HH:mm')}
              </p>
              <p className="text-sm text-ink whitespace-pre-wrap">{r.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  const [before] = useState(() => askFrom(question));
  const [ask, setAsk] = useState<AskValue>(before);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/questions/${question.id}`, {
        title: editTitle.trim(),
        body: editBody.trim() || null,
        ...askBody(ask, before),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['appointments', profileId] });
      onSaved();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The question did not save. Try again in a moment.'),
  });

  return (
    <Modal open onClose={onClose} title="Edit question" wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Save always answers: say what is missing.
          if (!editTitle.trim()) {
            setError('Write the question first, then save it.');
            document.getElementById('edit-question-title')?.focus();
            return;
          }
          const unpicked = contactProblem(ask.who, 'who to ask');
          if (unpicked) {
            setError(unpicked);
            document.getElementById('edit-question-ask')?.focus();
            return;
          }
          setError('');
          mutation.mutate();
        }}
      >
        <Input id="edit-question-title" label="Question" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
        <Textarea label="More about it" hint="Optional." value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={3} />
        <AskFields idPrefix="edit-question" profileId={profileId} value={ask} onChange={setAsk} />
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
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
