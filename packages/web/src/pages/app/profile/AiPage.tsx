import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { describeAiError } from '../../../lib/aiErrors';
import { ASSISTANT_COMMANDS, commandHelpText, expandSlashCommand } from '../../../lib/assistantCommands';
import { browserTimeZone } from '../../../lib/datetime';
import { Button } from '../../../components/ui/Button';
import { Textarea } from '../../../components/ui/Input';
import { useProfile } from './ProfileLayout';

interface ConversationSummary {
  id: string;
  account_id: string;
  account_display_name: string;
  is_own: boolean;
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
  const [showHelp, setShowHelp] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Typing "/" offers the quick commands; picking one fills the draft.
  const commandMatches = draft.startsWith('/')
    ? ASSISTANT_COMMANDS.filter((c) => `/${c.name}`.startsWith(draft.trim().split(/\s/)[0].toLowerCase()))
    : [];

  const submitDraft = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const cmd = expandSlashCommand(text);
    if (cmd?.kind === 'help') {
      setShowHelp(true);
      setDraft('');
      return;
    }
    if (cmd?.kind === 'needs-args') {
      setError(`Add the details after the command, e.g. "${cmd.command!.description.split('e.g. ')[1] ?? `/${cmd.command!.name} ...`}".`);
      return;
    }
    sendMutation.mutate(cmd?.kind === 'send' ? cmd.message! : text);
  };

  const { data: listData } = useQuery({
    queryKey: ['ai-conversations', profile.id],
    queryFn: () => api.get<{ conversations: ConversationSummary[] }>(`/care-profiles/${profile.id}/ai/conversations`),
  });
  const conversations = listData?.conversations ?? [];
  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

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
      api.post<{ reply: string }>(`/care-profiles/${profile.id}/ai/conversations/${activeId}/messages`, {
        content,
        timezone: browserTimeZone(),
      }),
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
                  <span className="block">{format(new Date(c.updated_at), 'd MMM yyyy, HH:mm')}</span>
                  {!c.is_own ? <span className="block opacity-75">{c.account_display_name}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card flex flex-col" style={{ minHeight: '26rem' }}>
        <h2 className="text-base font-semibold text-ink mb-1">Ask PareCare</h2>
        <p className="text-sm text-muted mb-1">
          An assistant that knows {careName}'s situation. Ask about next steps,
          entitlements, or how to approach hard conversations.
        </p>
        <p className="text-xs text-muted mb-4">
          Quick commands: type <span className="font-mono text-ink">/</span> to see them, or{' '}
          <span className="font-mono text-ink">/help</span> for the full list, e.g.{' '}
          <span className="font-mono text-ink">/dose took all my morning meds at 8</span>.
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
            {showHelp ? (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-surface-2 text-ink whitespace-pre-wrap">
                  {commandHelpText()}
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}

        {error ? <p className="text-sm text-red-600 mb-2">{error}</p> : null}

        {activeConversation && !activeConversation.is_own ? (
          <p className="text-xs text-muted mb-2">
            This chat belongs to {activeConversation.account_display_name}. You can read it but not add to it.
          </p>
        ) : null}

        {activeId && (!activeConversation || activeConversation.is_own) ? (
          <div>
            {commandMatches.length > 0 ? (
              <ul className="mb-2 rounded-md border border-border bg-card divide-y divide-border max-h-48 overflow-y-auto">
                {commandMatches.map((c) => (
                  <li key={c.name}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2"
                      onClick={() => setDraft(`/${c.name} `)}
                    >
                      <span className="font-mono text-ink">/{c.name}</span>{' '}
                      <span className="text-muted">{c.hint}</span>
                      <span className="block text-xs text-muted">{c.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <form
              className="flex gap-2 items-end"
              onSubmit={(e) => {
                e.preventDefault();
                submitDraft(draft);
              }}
            >
              <div className="flex-1">
                <Textarea
                  aria-label="Ask a question"
                  placeholder="Ask anything, or type / for quick commands…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitDraft(draft);
                    }
                  }}
                />
              </div>
              <Button type="submit" loading={sendMutation.isPending} disabled={!draft.trim()}>
                Send
              </Button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
