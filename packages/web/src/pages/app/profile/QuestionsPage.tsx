import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useProfile } from './ProfileLayout';
import type { OpenQuestion, QuestionResponse } from '../../../lib/care';

const STATUS_STYLES: Record<OpenQuestion['status'], string> = {
  open: 'bg-amber-50 text-amber-700',
  resolved: 'bg-primary-50 text-primary',
  deferred: 'bg-surface-2 text-muted',
};

export function QuestionsPage() {
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [resolving, setResolving] = useState<OpenQuestion | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['questions', profile.id],
    queryFn: () => api.get<{ questions: OpenQuestion[] }>(`/care-profiles/${profile.id}/questions`),
  });
  const questions = data?.questions ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['questions', profile.id] });

  const createMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profile.id}/questions`, { title: title.trim(), body: body.trim() || null }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      invalidate();
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OpenQuestion['status'] }) =>
      api.patch(`/care-profiles/${profile.id}/questions/${id}`, { status }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) createMutation.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-ink">Raise a question</h2>
        <p className="text-sm text-muted -mt-2">
          Open questions the family needs to settle — "Should mum still be driving?", "Who takes February visits?"
        </p>
        <Input label="Question" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <Textarea label="Context (optional)" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
        <div className="flex justify-end">
          <Button type="submit" loading={createMutation.isPending} disabled={!title.trim()}>
            Raise question
          </Button>
        </div>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : questions.length === 0 ? (
        <p className="text-sm text-muted">No questions raised yet.</p>
      ) : (
        <div className="space-y-4">
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              profileId={profile.id}
              question={q}
              onResolve={() => setResolving(q)}
              onReopen={() => statusMutation.mutate({ id: q.id, status: 'open' })}
              onDefer={() => statusMutation.mutate({ id: q.id, status: 'deferred' })}
            />
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
    </div>
  );
}

function QuestionCard({
  profileId,
  question,
  onResolve,
  onReopen,
  onDefer,
}: {
  profileId: string;
  question: OpenQuestion;
  onResolve: () => void;
  onReopen: () => void;
  onDefer: () => void;
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
          ? 'Mediation needs the AI assistant configured — set ANTHROPIC_API_KEY on the server.'
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
        </div>
      </div>
      {question.body ? <p className="text-sm text-ink mt-2 whitespace-pre-wrap">{question.body}</p> : null}
      {question.resolution ? (
        <p className="text-sm mt-2 rounded-md bg-primary-50 text-primary px-3 py-2">
          <span className="font-medium">Decision:</span> {question.resolution}
        </p>
      ) : null}

      <button type="button" className="text-xs text-primary hover:underline mt-3" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Hide discussion' : `Discussion${responses.length ? ` (${responses.length})` : ''}`}
      </button>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {responses.length === 0 ? (
            <p className="text-xs text-muted">No responses yet.</p>
          ) : (
            responses.map((r) =>
              r.is_ai ? (
                <div key={r.id} className="rounded-md border border-primary-100 bg-primary-50/50 px-3 py-2">
                  <p className="text-xs font-medium text-primary mb-1">
                    ⚖ PareCare mediator · {format(new Date(r.created_at), 'd MMM, HH:mm')}
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
              <Input placeholder="Add a response…" value={reply} onChange={(e) => setReply(e.target.value)} />
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
                ⚖ Ask PareCare to mediate
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
