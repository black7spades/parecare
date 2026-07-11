import { useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { describeAiError } from '../../lib/aiErrors';
import { browserTimeZone } from '../../lib/datetime';
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

/**
 * Where the user keeps Pare on screen: position, size and how see-through
 * the window is. Saved per browser, so the window opens where they left
 * it and never hides what they need to read behind it.
 */
interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WINDOW_PREFS_KEY = 'parecare-pare-window';
const MIN_WIDTH = 300;
const MIN_HEIGHT = 360;
const MIN_OPACITY = 40;
/** Keep at least this much of the window header reachable on screen. */
const EDGE_MARGIN = 48;

function loadWindowPrefs(): { rect: WindowRect | null; opacity: number } {
  try {
    const raw = localStorage.getItem(WINDOW_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { rect?: WindowRect | null; opacity?: number };
      const rect =
        parsed.rect && [parsed.rect.x, parsed.rect.y, parsed.rect.width, parsed.rect.height].every((n) => typeof n === 'number' && Number.isFinite(n))
          ? parsed.rect
          : null;
      const opacity =
        typeof parsed.opacity === 'number' ? Math.min(100, Math.max(MIN_OPACITY, Math.round(parsed.opacity))) : 100;
      return { rect, opacity };
    }
  } catch {
    // Unreadable preferences fall back to the defaults.
  }
  return { rect: null, opacity: 100 };
}

function persistWindowPrefs(rect: WindowRect | null, opacity: number): void {
  try {
    localStorage.setItem(WINDOW_PREFS_KEY, JSON.stringify({ rect, opacity }));
  } catch {
    // Storage full or blocked; the window still works, it just will not remember.
  }
}

/** The docked position the window starts in: right edge, below the top bar. */
function defaultWindowRect(): WindowRect {
  const width = Math.min(384, window.innerWidth - 16);
  return { x: window.innerWidth - width, y: 56, width, height: window.innerHeight - 56 };
}

function clampWindowRect(r: WindowRect): WindowRect {
  const width = Math.min(Math.max(r.width, MIN_WIDTH), window.innerWidth);
  const height = Math.min(Math.max(r.height, MIN_HEIGHT), window.innerHeight);
  const x = Math.min(Math.max(r.x, EDGE_MARGIN - width), window.innerWidth - EDGE_MARGIN);
  const y = Math.min(Math.max(r.y, 0), window.innerHeight - EDGE_MARGIN);
  return { x, y, width, height };
}

export function AssistantWidget() {
  const profileMatch = useMatch('/app/:profileId/*');
  const routeProfileId =
    profileMatch?.params.profileId && profileMatch.params.profileId !== 'profiles'
      ? profileMatch.params.profileId
      : null;

  return <AssistantPanel profileId={routeProfileId} />;
}

/**
 * One Pare, one conversation. It follows the user everywhere: the same
 * thread on the Homeboard and inside any profile, so a chat never goes
 * blank when they move around. When a profile is open Pare is handed that
 * person's full record and can act on them directly, while still seeing
 * everyone in the account's care.
 */
function AssistantPanel({ profileId }: { profileId: string | null }) {
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

  // The window is movable, resizable and can be made see-through on
  // larger screens; on phones it stays a fixed bottom sheet. Preferences
  // persist per browser.
  const [rect, setRect] = useState<WindowRect | null>(() => loadWindowPrefs().rect);
  const [opacity, setOpacity] = useState<number>(() => loadWindowPrefs().opacity);
  const [typing, setTyping] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const dragRef = useRef<{ pointerX: number; pointerY: number; rect: WindowRect } | null>(null);
  const resizeRef = useRef<{ pointerX: number; pointerY: number; rect: WindowRect } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Keep the window reachable when the browser window shrinks.
  useEffect(() => {
    const onResize = () => setRect((r) => (r ? clampWindowRect(r) : r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function beginDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDesktop || (e.target as HTMLElement).closest('button, input')) return;
    const current = rect ?? clampWindowRect(defaultWindowRect());
    if (!rect) setRect(current);
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, rect: current };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function moveDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    setRect(clampWindowRect({ ...d.rect, x: d.rect.x + e.clientX - d.pointerX, y: d.rect.y + e.clientY - d.pointerY }));
  }
  function endDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    persistWindowPrefs(rectRef.current, opacity);
  }

  function beginResize(e: React.PointerEvent<HTMLDivElement>) {
    const current = rect ?? clampWindowRect(defaultWindowRect());
    if (!rect) setRect(current);
    resizeRef.current = { pointerX: e.clientX, pointerY: e.clientY, rect: current };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }
  function moveResize(e: React.PointerEvent<HTMLDivElement>) {
    const d = resizeRef.current;
    if (!d) return;
    setRect({
      ...d.rect,
      width: Math.min(Math.max(d.rect.width + e.clientX - d.pointerX, MIN_WIDTH), window.innerWidth - d.rect.x),
      height: Math.min(Math.max(d.rect.height + e.clientY - d.pointerY, MIN_HEIGHT), window.innerHeight - d.rect.y),
    });
  }
  function endResize() {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    persistWindowPrefs(rectRef.current, opacity);
  }

  function resetWindow() {
    setRect(null);
    persistWindowPrefs(null, opacity);
  }

  function changeOpacity(value: number) {
    setOpacity(value);
    persistWindowPrefs(rectRef.current, value);
  }

  // One account-wide thread, keyed by account so a login switch in the same
  // tab never reuses someone else's thread. The same conversation is used
  // on the Homeboard and inside every profile, so it never resets as the
  // user navigates.
  const accountId = useAuthStore((s) => s.account?.id);
  const convScope = `pare-${accountId ?? 'anon'}`;
  const apiBase = '/ai/dashboard';

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
    enabled: !!profileId && open,
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
      const body = { content, timezone: browserTimeZone(), current_profile_id: profileId ?? undefined };
      try {
        return await api.post<SendResponse>(`${apiBase}/conversations/${conversation}/messages`, body);
      } catch (err) {
        // A resumed conversation can go stale (different login, deleted
        // record); start a fresh one instead of losing the message.
        if (err instanceof ApiError && err.status === 404 && conversation === convId) {
          const fresh = await startConversation();
          return api.post<SendResponse>(`${apiBase}/conversations/${fresh}/messages`, body);
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

  const windowRect = isDesktop ? (rect ?? clampWindowRect(defaultWindowRect())) : null;

  return (
    <div
      className={`fixed z-50 flex flex-col overflow-hidden bg-card border-border shadow-2xl transition-opacity ${
        windowRect ? 'rounded-xl border' : 'inset-x-0 bottom-0 h-[75vh] rounded-t-2xl border-t'
      }`}
      style={{
        // The slider sets how see-through the window is, and it stays that
        // way so the user can read what is behind it. Dragging the slider
        // does not count as typing, so the window updates live as they drag.
        // It only snaps fully solid while they are actively typing, when the
        // text needs to be crisp.
        opacity: typing ? 1 : opacity / 100,
        ...(windowRect
          ? { left: windowRect.x, top: windowRect.y, width: windowRect.width, height: windowRect.height }
          : {}),
      }}
    >
      <div
        className={`flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-surface-2 shrink-0 ${isDesktop ? 'cursor-move touch-none select-none' : ''}`}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={isDesktop ? resetWindow : undefined}
        title={isDesktop ? 'Drag to move the window. Double-click to put it back.' : undefined}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink truncate">Pare</p>
          <p className="text-xs text-muted truncate">
            {personName ? `Viewing ${personName} · everyone in your care` : 'Everyone in your care'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="range"
            min={MIN_OPACITY}
            max={100}
            value={opacity}
            onChange={(e) => changeOpacity(Number(e.target.value))}
            aria-label="Window transparency"
            title="Make the window more or less see-through"
            className="w-16 accent-primary cursor-pointer"
          />
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
            {personName
              ? `Ask anything about ${personName}, tell me what happened so I can log it, or ask me to do or change something anywhere in your care.`
              : 'Ask what needs attention, tell me what happened so I can log it for anyone, or ask me to take you anywhere in the app.'}
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
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
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

      {windowRect ? (
        <div
          onPointerDown={beginResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          title="Drag to resize the window"
          aria-hidden
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize touch-none text-muted hover:text-ink"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="17" y1="9" x2="9" y2="17" />
            <line x1="17" y1="14" x2="14" y2="17" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}
