import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Textarea } from '../../../components/ui/Input';
import { useAuthStore } from '../../../stores/auth';
import { useProfile } from './ProfileLayout';
import type { ChatMessage } from '../../../lib/care';

export function MessagesPage() {
  const { profile, careName } = useProfile();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.account);
  const isAdmin = me?.role === 'admin' || me?.role === 'super_admin';
  const [draft, setDraft] = useState('');
  // When the tone guard asks for a revision, its reason and suggested rewrite.
  const [toneBlock, setToneBlock] = useState<{ reason: string; suggestion: string } | null>(null);
  const [sendError, setSendError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['messages', profile.id],
    queryFn: () => api.get<{ messages: ChatMessage[] }>(`/care-profiles/${profile.id}/messages`),
    refetchInterval: 8000,
  });
  const messages = data?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => api.post(`/care-profiles/${profile.id}/messages`, { body }),
    onSuccess: () => {
      setDraft('');
      setToneBlock(null);
      setSendError('');
      void queryClient.invalidateQueries({ queryKey: ['messages', profile.id] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'TONE_REVISION_NEEDED') {
        setToneBlock({
          reason: String(err.data?.['reason'] ?? err.message),
          suggestion: String(err.data?.['suggestion'] ?? ''),
        });
        setSendError('');
      } else {
        setSendError(err instanceof Error ? err.message : 'Could not send the message.');
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/messages/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['messages', profile.id] }),
  });

  // The instance-wide tone guard state, and the admin control to turn it off.
  const { data: guardData } = useQuery({
    queryKey: ['message-tone-guard'],
    queryFn: () => api.get<{ enabled: boolean }>('/admin/message-tone-guard'),
    enabled: isAdmin,
  });
  const toggleGuard = useMutation({
    mutationFn: (enabled: boolean) => api.patch<{ enabled: boolean }>('/admin/message-tone-guard', { enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['message-tone-guard'] }),
  });

  const send = () => {
    if (draft.trim()) sendMutation.mutate(draft.trim());
  };

  return (
    <div className="card flex flex-col" style={{ minHeight: '28rem' }}>
      <h2 className="text-base font-semibold text-ink mb-1">Messages</h2>
      <p className="text-sm text-muted mb-2">
        A shared space for everyone in {careName}'s circle.
      </p>

      {isAdmin && guardData ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
          <span className="font-medium text-ink">Tone guard</span>
          <span className={guardData.enabled ? 'text-green-700 dark:text-green-300' : 'text-muted'}>
            {guardData.enabled ? 'On' : 'Off'}
          </span>
          <span className="text-muted">
            {guardData.enabled
              ? 'Messages are checked for a calm, care-focused tone before they post. This is platform-wide.'
              : 'Messages post without a tone check. This is platform-wide.'}
          </span>
          <Button
            size="xs"
            variant="secondary"
            className="ml-auto"
            loading={toggleGuard.isPending}
            onClick={() => toggleGuard.mutate(!guardData.enabled)}
          >
            Turn {guardData.enabled ? 'off' : 'on'}
          </Button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto space-y-3 mb-4 max-h-96 pr-1">
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted">No messages yet. Say hello.</p>
        ) : (
          messages.map((m) => {
            const mine = m.author_account_id === me?.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`group max-w-[75%] rounded-lg px-3 py-2 ${
                    mine ? 'bg-primary text-white' : 'bg-surface-2 text-ink'
                  }`}
                >
                  <div className={`text-[11px] mb-0.5 ${mine ? 'text-white/70' : 'text-muted'}`}>
                    {m.author_name ?? 'Former member'} · {format(new Date(m.created_at), 'd MMM, HH:mm')}
                    {mine ? (
                      <button
                        type="button"
                        aria-label="Delete message"
                        className="ml-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:text-white"
                        onClick={() => deleteMutation.mutate(m.id)}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {toneBlock ? (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-500/40 dark:bg-amber-900/20">
          <p className="font-medium text-amber-800 dark:text-amber-200">Let's keep this focused on {careName}'s care</p>
          <p className="mt-0.5 text-amber-800/90 dark:text-amber-100/90">{toneBlock.reason}</p>
          {toneBlock.suggestion ? (
            <div className="mt-2 rounded border border-amber-200 bg-white/70 px-2.5 py-2 text-ink dark:border-amber-500/30 dark:bg-black/20">
              <p className="text-[11px] uppercase tracking-wide text-muted mb-1">Suggested rewrite</p>
              <p className="whitespace-pre-wrap">{toneBlock.suggestion}</p>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {toneBlock.suggestion ? (
              <Button
                size="xs"
                variant="secondary"
                onClick={() => { setDraft(toneBlock.suggestion); setToneBlock(null); }}
              >
                Use this rewrite
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={() => setToneBlock(null)}>Edit my message</Button>
          </div>
        </div>
      ) : null}
      {sendError ? <p className="mb-2 text-sm text-red-600">{sendError}</p> : null}

      <form
        className="flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex-1">
          <Textarea
            aria-label="Message"
            placeholder="Write a message…"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (toneBlock) setToneBlock(null); }}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
        </div>
        <Button type="submit" loading={sendMutation.isPending} disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
