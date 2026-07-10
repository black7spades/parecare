import { useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { describeAiError } from '../../lib/aiErrors';
import { useAssistantStore } from '../../stores/assistant';
import { useAuthStore } from '../../stores/auth';
import type { CareProfile } from '../../lib/care';

/**
 * Pare, the care assistant, present on every signed-in screen. Two modes,
 * decided by the route:
 *
 * - Profile mode inside /app/:profileId: scoped to that person's full
 *   record.
 * - Dashboard mode everywhere else (the dashboard itself, account
 *   settings, the system screens): one account-wide conversation that
 *   sees a summary of everyone in the user's care, can create profiles,
 *   log across profiles, and navigate the user to the right screen.
 *
 * The bubble never disappears between pages; only its scope changes.
 * Conversations persist on the server and are kept per day: opening Pare
 * resumes today's chat for the current scope on any device, and each new
 * day starts a fresh chat log.
 */

interface ConversationDetail {
  id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
}

interface ClientAction {
  action: 'navigate_to_profile' | 'profile_created';
  profile_id: string;
  section?: string;
  name?: string;
}

interface SendResponse {
  reply: string;
  client_actions?: ClientAction[];
}

/** Where each of Pare's navigation sections lives in the app. */
const SECTION_PATHS: Record<string, string> = {
  overview: '',
  log: '', // the care log lives on the profile overview
  medications: 'medications',
  tasks: 'tasks',
  questions: 'questions',
  documents: 'documents',
  circle: 'circle',
  plan: 'plan',
  calendar: 'calendar',
  ask: 'ai',
  'memory-book': 'memory-book',
};

export function AssistantWidget() {
  const profileMatch = useMatch('/app/:profileId/*');
  const routeProfileId =
    profileMatch?.params.profileId && profileMatch.params.profileId !== 'profiles'
      ? profileMatch.params.profileId
      : null;
  const mode: 'dashboard' | 'profile' = routeProfileId ? 'profile' : 'dashboard';

  return <AssistantPanel mode={mode} profileId={routeProfileId} />;
}

function AssistantPanel({ mode, profileId }: { mode: 'dashboard' | 'profile'; profileId: string | null }) {
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const pendingMessage = useAssistantStore((s) => s.pendingMessage);
  const consumePendingMessage = useAssistantStore((s) => s.consumePendingMessage);

  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pendingReply, setPendingReply] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Dashboard talk is one account-wide thread (keyed by account, so a
  // login switch in the same tab never reuses someone else's thread);
  // each profile has its own.
  const accountId = useAuthStore((s) => s.account?.id);
  const convScope = mode === 'dashboard' ? `dashboard-${accountId ?? 'anon'}` : profileId!;
  const apiBase = mode === 'dashboard' ? '/ai/dashboard' : `/care-profiles/${profileId}/ai`;

  // Follow the route: switching between dashboard and a profile resumes
  // today's conversation for that scope, kept on the server so it
  // survives closing the browser.
  // "New chat" sets today's conversation aside; a refetch of the current
  // conversation must not bring it back.
  const [dismissedConvId, setDismissedConvId] = useState<string | null>(null);

  useEffect(() => {
    setError('');
    setConvId(null);
    setDismissedConvId(null);
  }, [convScope]);

  const currentQuery = useQuery({
    queryKey: ['assistant-current', convScope],
    queryFn: () => api.get<{ conversation: { id: string } | null }>(`${apiBase}/conversations/current`),
    enabled: open,
  });
  useEffect(() => {
    if (currentQuery.data) {
      const id = currentQuery.data.conversation?.id ?? null;
      setConvId(id && id !== dismissedConvId ? id : null);
    }
  }, [currentQuery.data, dismissedConvId]);
  // Hold sends until we know whether today's chat already exists, so a
  // quick first message continues it instead of forking a second one.
  const resumeReady = currentQuery.isFetched || currentQuery.isError;

  const { data: profileData } = useQuery({
    queryKey: ['care-profile', profileId],
    queryFn: () => api.get<{ profile: CareProfile }>(`/care-profiles/${profileId}`),
    enabled: mode === 'profile' && !!profileId && open,
  });
  const profile = profileData?.profile;
  const personName = profile?.preferred_name ?? profile?.first_name ?? profile?.full_name ?? null;

  const { data: convData, error: convError } = useQuery({
    queryKey: ['assistant-conversation', convId],
    queryFn: () => api.get<{ conversation: ConversationDetail }>(`${apiBase}/conversations/${convId}`),
    enabled: !!convId && open,
    retry: false,
  });
  const messages = convData?.conversation.messages ?? [];

  // A resumed conversation can go stale (different login, deleted profile);
  // drop it and start fresh instead of showing an error.
  useEffect(() => {
    if (convError) {
      queryClient.setQueryData(['assistant-current', convScope], { conversation: null });
      setConvId(null);
    }
  }, [convError, convScope, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pendingReply, open]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const startConversation = async () => {
        const created = await api.post<{ conversation: { id: string } }>(`${apiBase}/conversations`);
        queryClient.setQueryData(['assistant-current', convScope], { conversation: created.conversation });
        setConvId(created.conversation.id);
        return created.conversation.id;
      };
      const conversation = convId ?? (await startConversation());
      try {
        return await api.post<SendResponse>(`${apiBase}/conversations/${conversation}/messages`, { content });
      } catch (err) {
        // A resumed conversation can go stale (different login, deleted
        // record); start a fresh one instead of losing the message.
        if (err instanceof ApiError && err.status === 404 && conversation === convId) {
          const fresh = await startConversation();
          return api.post<SendResponse>(`${apiBase}/conversations/${fresh}/messages`, { content });
        }
        throw err;
      }
    },
    onMutate: (content) => {
      setPendingReply(content);
      setError('');
    },
    onSettled: () => setPendingReply(null),
    onSuccess: (data) => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['assistant-conversation'] });
      // Anything Pare logged or created should show up in the open pages too.
      void queryClient.invalidateQueries({ queryKey: ['care-profile', profileId] });
      for (const action of data.client_actions ?? []) {
        if (action.action === 'profile_created') {
          void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
          void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
          void queryClient.invalidateQueries({ queryKey: ['pare-attention'] });
        } else if (action.action === 'navigate_to_profile') {
          const sectionPath = SECTION_PATHS[action.section ?? 'overview'] ?? '';
          navigate(`/app/${action.profile_id}${sectionPath ? `/${sectionPath}` : ''}`);
        }
      }
    },
    onError: (err) => setError(describeAiError(err)),
  });

  // A message queued from elsewhere (the dashboard welcome card or the
  // attention prompt) is sent as soon as we are open, resumed and idle.
  useEffect(() => {
    if (open && pendingMessage && resumeReady && !sendMutation.isPending) {
      const message = consumePendingMessage();
      if (message) sendMutation.mutate(message);
    }
  }, [open, pendingMessage, resumeReady, sendMutation, consumePendingMessage]);

  function startNewConversation() {
    setDismissedConvId(convId);
    queryClient.setQueryData(['assistant-current', convScope], { conversation: null });
    setConvId(null);
    setError('');
  }

  function send() {
    const content = draft.trim();
    if (content && resumeReady && !sendMutation.isPending) sendMutation.mutate(content);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Pare"
        className="fixed bottom-4 right-4 z-50 rounded-full bg-primary text-white shadow-lg hover:opacity-90 transition-opacity px-5 py-3 text-sm font-semibold tracking-wide"
      >
        Pare
      </button>
    );
  }

  return (
    <div className="fixed z-50 flex flex-col overflow-hidden bg-card border-border shadow-2xl inset-x-0 bottom-0 h-[75vh] rounded-t-2xl border-t sm:inset-x-auto sm:right-0 sm:top-14 sm:bottom-0 sm:h-auto sm:w-[24rem] sm:rounded-none sm:border-t-0 sm:border-l">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-surface-2 shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink truncate">Pare</p>
          <p className="text-xs text-muted truncate">
            {mode === 'dashboard'
              ? 'Everyone in your care'
              : personName
                ? `About ${personName} only`
                : 'About this person only'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={startNewConversation}
              className="text-xs text-muted hover:text-ink px-2 py-1 rounded-md hover:bg-surface transition-colors"
            >
              New chat
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close Pare"
            className="p-1 rounded-md text-muted hover:text-ink hover:bg-surface transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !pendingReply ? (
          <p className="text-sm text-muted text-center mt-6 px-4">
            {mode === 'dashboard'
              ? 'Ask what needs attention, tell me what happened so I can log it for everyone involved, or ask me to take you anywhere in the app.'
              : `Ask anything about ${personName ?? 'this person'}, or tell me something to log, like the medications you took, a seizure, an appointment or a task.`}
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
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
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-primary text-white whitespace-pre-wrap">{pendingReply}</div>
            </div>
            <div className="flex justify-start">
              <div className="rounded-lg px-3 py-2 text-sm bg-surface-2 text-muted">Thinking…</div>
            </div>
          </>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="text-xs text-red-600 px-3 pb-1">{error}</p> : null}

      <form
        className="flex gap-2 items-end border-t border-border p-3 shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="Talk to Pare"
          placeholder="Talk to Pare"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="submit"
          disabled={!draft.trim() || sendMutation.isPending}
          className="rounded-md bg-primary text-white px-3 py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          Send
        </button>
      </form>
    </div>
  );
}
