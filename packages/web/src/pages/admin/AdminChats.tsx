import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useAuthStore } from '../../stores/auth';
import { adminApi, type AdminChatDetail, type AdminChatSummary } from '../../api/admin';
import { Button } from '../../components/ui/Button';

/**
 * Every conversation with Pare, kept per day. Super admins see every chat
 * on the platform; admins see their own chats plus any chat about a care
 * profile in their care (owned or circle membership). The server enforces
 * the scoping; this screen just renders what it is allowed to see.
 */
export function AdminChats() {
  const me = useAuthStore((s) => s.account);
  const isSuperAdmin = me?.role === 'super_admin';

  const [chats, setChats] = useState<AdminChatSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [day, setDay] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<AdminChatDetail | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.listChats({ day: day || undefined, page, per_page: perPage });
      setChats(res.chats);
      setTotal(res.total);
    } catch {
      setError('Could not load the chat log.');
    } finally {
      setLoading(false);
    }
  }, [day, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    let cancelled = false;
    setActiveLoading(true);
    adminApi
      .getChat(activeId)
      .then((res) => {
        if (!cancelled) setActive(res.conversation);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load that conversation.');
      })
      .finally(() => {
        if (!cancelled) setActiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Group the page of chats by the day they started, newest day first.
  const byDay = new Map<string, AdminChatSummary[]>();
  for (const c of chats) {
    const arr = byDay.get(c.chat_day) ?? [];
    arr.push(c);
    byDay.set(c.chat_day, arr);
  }
  const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Pare chat log</h2>
          <p className="text-sm text-muted">
            {isSuperAdmin
              ? 'Every conversation with Pare across the platform, kept per day.'
              : 'Conversations with Pare about the people in your care, kept per day.'}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="block text-xs text-muted mb-1">Day</span>
            <input
              type="date"
              value={day}
              onChange={(e) => {
                setPage(1);
                setDay(e.target.value);
              }}
              className="rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-sm focus:border-primary focus:outline-none"
            />
          </label>
          {day ? (
            <Button
              variant="secondary"
              onClick={() => {
                setPage(1);
                setDay('');
              }}
            >
              All days
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr] items-start">
        <div className="card">
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : chats.length === 0 ? (
            <p className="text-sm text-muted">No chats {day ? 'on that day' : 'yet'}.</p>
          ) : (
            <div className="space-y-4">
              {days.map((d) => (
                <div key={d}>
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                    {format(new Date(`${d}T00:00:00`), 'EEEE d MMMM yyyy')}
                  </h3>
                  <ul className="space-y-1">
                    {byDay.get(d)!.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setActiveId(c.id)}
                          className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors ${
                            activeId === c.id ? 'bg-primary-50 text-primary font-medium' : 'text-muted hover:bg-surface-2'
                          }`}
                        >
                          <span className="block font-medium text-ink">{c.account_display_name}</span>
                          <span className="block">
                            {c.care_profile_name ? `About ${c.care_profile_name}` : 'Dashboard chat'} · {c.message_count}{' '}
                            {c.message_count === 1 ? 'message' : 'messages'} · last active{' '}
                            {format(new Date(c.updated_at), 'HH:mm')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-xs text-muted">
                Page {page} of {totalPages}
              </span>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </div>

        <div className="card min-h-[20rem]">
          {!activeId ? (
            <p className="text-sm text-muted my-12 text-center">Pick a conversation from the left to read it.</p>
          ) : activeLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : active ? (
            <div className="space-y-3">
              <div className="pb-3 border-b border-border">
                <p className="text-sm font-semibold text-ink">
                  {active.account_display_name} <span className="font-normal text-muted">({active.account_email})</span>
                </p>
                <p className="text-xs text-muted">
                  {active.care_profile_name ? `About ${active.care_profile_name}` : 'Dashboard chat'} ·{' '}
                  {format(new Date(`${active.chat_day}T00:00:00`), 'd MMM yyyy')}
                </p>
              </div>
              {active.messages.length === 0 ? (
                <p className="text-sm text-muted">This conversation has no messages yet.</p>
              ) : (
                active.messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                        m.role === 'user' ? 'bg-primary text-white' : 'bg-surface-2 text-ink'
                      }`}
                    >
                      {m.content}
                      <span className={`block mt-1 text-[10px] ${m.role === 'user' ? 'text-white/70' : 'text-muted'}`}>
                        {format(new Date(m.timestamp), 'd MMM, HH:mm')}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
