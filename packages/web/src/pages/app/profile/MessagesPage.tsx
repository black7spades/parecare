import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Textarea } from '../../../components/ui/Input';
import { useAuthStore } from '../../../stores/auth';
import { useProfile } from './ProfileLayout';
import type { ChatMessage } from '../../../lib/care';

export function MessagesPage() {
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.account);
  const [draft, setDraft] = useState('');
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
      void queryClient.invalidateQueries({ queryKey: ['messages', profile.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/messages/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['messages', profile.id] }),
  });

  const send = () => {
    if (draft.trim()) sendMutation.mutate(draft.trim());
  };

  return (
    <div className="card flex flex-col" style={{ minHeight: '28rem' }}>
      <h2 className="text-base font-semibold text-ink mb-1">Messages</h2>
      <p className="text-sm text-muted mb-4">
        A shared space for everyone in {profile.preferred_name ?? profile.full_name}'s circle.
      </p>

      <div className="flex-1 overflow-y-auto space-y-3 mb-4 max-h-96 pr-1">
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted">No messages yet — say hello.</p>
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
                        className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity hover:text-white"
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
            onChange={(e) => setDraft(e.target.value)}
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
