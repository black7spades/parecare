import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Textarea } from '../../../components/ui/Input';
import { useProfile } from './ProfileLayout';

interface ConversationSummary {
  id: string;
  tokens_used: number;
  created_at: string;
  updated_at: string;
}

interface ConversationDetail {
  id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
}

export function AiPage() {
  const { profile, careName } = useProfile();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pendingReply, setPendingReply] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: listData } = useQuery({
    queryKey: ['ai-conversations', profile.id],
    queryFn: () => api.get<{ conversations: ConversationSummary[] }>(`/care-profiles/${profile.id}/ai/conversations`),
  });
  const conversations = listData?.conversations ?? [];

  const { data: convData } = useQuery({
    queryKey: ['ai-conversation', activeId],
    queryFn: () => api.get<{ conversation: ConversationDetail }>(`/care-profiles/${profile.id}/ai/conversations/${activeId}`),
    enabled: !!activeId,
  });
  const messages = convData?.conversation.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pendingReply]);

  const newConvMutation = useMutation({
    mutationFn: () => api.post<{ conversation: { id: string } }>(`/care-profiles/${profile.id}/ai/conversations`),
    onSuccess: (data) => {
      setActiveId(data.conversation.id);
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations', profile.id] });
    },
    onError: (err) => setError(describeAiError(err)),
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      api.post<{ reply: string }>(`/care-profiles/${profile.id}/ai/conversations/${activeId}/messages`, { content }),
    onMutate: (content) => setPendingReply(content),
    onSettled: () => setPendingReply(null),
    onSuccess: () => {
      setDraft('');
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['ai-conversation', activeId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations', profile.id] });
    },
    onError: (err) => setError(describeAiError(err)),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr] items-start">
      <div className="card">
        <Button className="w-full mb-3" loading={newConvMutation.isPending} onClick={() => newConvMutation.mutate()}>
          New conversation
        </Button>
        {conversations.length === 0 ? (
          <p className="text-xs text-muted">No conversations yet.</p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors ${
                    activeId === c.id ? 'bg-primary-50 text-primary font-medium' : 'text-muted hover:bg-surface-2'
                  }`}
                >
                  {format(new Date(c.updated_at), 'd MMM yyyy, HH:mm')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card flex flex-col" style={{ minHeight: '26rem' }}>
        <h2 className="text-base font-semibold text-ink mb-1">Ask PareCare</h2>
        <p className="text-sm text-muted mb-4">
          An assistant that knows {careName}'s situation. Ask about next steps,
          entitlements, or how to approach hard conversations.
        </p>

        {!activeId ? (
          <p className="text-sm text-muted my-auto text-center">Start a new conversation or pick one from the left.</p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 mb-4 max-h-96 pr-1">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === 'user' ? 'bg-primary text-white' : 'bg-surface-2 text-ink'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {pendingReply ? (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-primary text-white whitespace-pre-wrap">
                    {pendingReply}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="rounded-lg px-3 py-2 text-sm bg-surface-2 text-muted">Thinking…</div>
                </div>
              </>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}

        {error ? <p className="text-sm text-red-600 mb-2">{error}</p> : null}

        {activeId ? (
          <form
            className="flex gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) sendMutation.mutate(draft.trim());
            }}
          >
            <div className="flex-1">
              <Textarea
                aria-label="Ask a question"
                placeholder="Ask anything about the care journey…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (draft.trim()) sendMutation.mutate(draft.trim());
                  }
                }}
              />
            </div>
            <Button type="submit" loading={sendMutation.isPending} disabled={!draft.trim()}>
              Send
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function describeAiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 402) return 'The AI assistant requires an upgraded plan.';
    if (err.code === 'AI_NOT_CONFIGURED' || /api key/i.test(err.message)) {
      return 'The AI assistant is not configured on this server. Ask the admin to set AI_PROVIDER (Anthropic, OpenAI, Gemini, Ollama, or LM Studio).';
    }
    return err.message;
  }
  return 'Something went wrong talking to the assistant.';
}
