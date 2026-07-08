import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { describeAiError } from '../../lib/aiErrors';
import type { CareProfile } from '../../lib/care';

/**
 * The PareCare Assistant as a floating chat widget, available on every
 * screen. It is scoped to the care profile that is currently open: inside
 * Person01's profile it only knows about Person01, and outside any profile
 * it knows nothing and says so. Each profile gets its own running
 * conversation, kept for the browser session.
 */

interface ConversationDetail {
  id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
}

const convStorageKey = (profileId: string) => `parecare-assistant-conv-${profileId}`;

export function AssistantWidget({ profileId }: { profileId: string | null }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pendingReply, setPendingReply] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Follow the open profile; each person has their own conversation.
  useEffect(() => {
    setError('');
    setConvId(profileId ? sessionStorage.getItem(convStorageKey(profileId)) : null);
  }, [profileId]);

  const { data: profileData } = useQuery({
    queryKey: ['care-profile', profileId],
    queryFn: () => api.get<{ profile: CareProfile }>(`/care-profiles/${profileId}`),
    enabled: !!profileId && open,
  });
  const profile = profileData?.profile;
  const personName = profile?.preferred_name ?? profile?.first_name ?? profile?.full_name ?? null;

  const { data: convData, error: convError } = useQuery({
    queryKey: ['assistant-conversation', convId],
    queryFn: () => api.get<{ conversation: ConversationDetail }>(`/care-profiles/${profileId}/ai/conversations/${convId}`),
    enabled: !!profileId && !!convId && open,
    retry: false,
  });
  const messages = convData?.conversation.messages ?? [];

  // A stored conversation can go stale (different login, deleted profile);
  // drop it and start fresh instead of showing an error.
  useEffect(() => {
    if (convError && profileId) {
      sessionStorage.removeItem(convStorageKey(profileId));
      setConvId(null);
    }
  }, [convError, profileId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pendingReply, open]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!profileId) throw new Error('Open a profile first.');
      let conversation = convId;
      if (!conversation) {
        const created = await api.post<{ conversation: { id: string } }>(`/care-profiles/${profileId}/ai/conversations`);
        conversation = created.conversation.id;
        sessionStorage.setItem(convStorageKey(profileId), conversation);
        setConvId(conversation);
      }
      return api.post<{ reply: string }>(`/care-profiles/${profileId}/ai/conversations/${conversation}/messages`, { content });
    },
    onMutate: (content) => {
      setPendingReply(content);
      setError('');
    },
    onSettled: () => setPendingReply(null),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['assistant-conversation'] });
      // Anything the assistant logged should show up in the open pages too.
      void queryClient.invalidateQueries({ queryKey: ['care-profile', profileId] });
    },
    onError: (err) => setError(describeAiError(err)),
  });

  function startNewConversation() {
    if (!profileId) return;
    sessionStorage.removeItem(convStorageKey(profileId));
    setConvId(null);
    setError('');
  }

  function send() {
    const content = draft.trim();
    if (content && !sendMutation.isPending) sendMutation.mutate(content);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {open ? (
        <div className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden" style={{ height: 'min(30rem, calc(100vh - 8rem))' }}>
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-surface-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink truncate">PareCare Assistant</p>
              <p className="text-xs text-muted truncate">
                {profileId ? (personName ? `About ${personName} only` : 'About this person only') : 'No profile open'}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {profileId && messages.length > 0 ? (
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
                aria-label="Close assistant"
                className="p-1 rounded-md text-muted hover:text-ink hover:bg-surface transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {!profileId ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <p className="text-sm text-muted text-center">
                Open someone's profile to ask about their care. The assistant only sees the person whose profile is open.
              </p>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.length === 0 && !pendingReply ? (
                  <p className="text-sm text-muted text-center mt-6 px-4">
                    Ask anything about {personName ?? 'this person'}, or tell me something to log, like a dose taken, a
                    seizure, an appointment or a task.
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
                className="flex gap-2 items-end border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <textarea
                  aria-label="Message the assistant"
                  placeholder={personName ? `Ask about ${personName}…` : 'Ask about this person…'}
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
            </>
          )}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close the PareCare Assistant' : 'Open the PareCare Assistant'}
        className="rounded-full bg-primary text-white shadow-lg hover:opacity-90 transition-opacity flex items-center justify-center"
        style={{ height: '3.25rem', width: '3.25rem' }}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}
