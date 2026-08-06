import { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth';
import { adminApi, type AdminChatDetail, type AdminChatSummary } from '../../api/admin';
import { SortableTh } from '../../components/data/SortableTh';
import { useDataView, type DataSort } from '../../components/data/useDataView';
import { DataToolbar } from '../../components/data/DataToolbar';

/**
 * The Pare screen for whoever runs the system: how Pare is running right now,
 * and every conversation with it. Super admins see the whole platform; an
 * admin sees their own care. The server enforces the scoping.
 */
const HEALTH_DOT: Record<string, string> = { green: 'bg-green-500', amber: 'bg-amber-400', red: 'bg-red-500' };
const HEALTH_WORD: Record<string, string> = {
  green: 'Online, working well',
  amber: 'Online, under load',
  red: 'Offline, may need attention',
};

function fmtMs(ms: number | null): string {
  if (ms == null) return 'None yet';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold text-ink leading-tight mt-0.5">{value}</div>
      {sub ? <div className="text-xs text-muted mt-0.5">{sub}</div> : null}
    </div>
  );
}

/** The live monitor: connectivity, response time, load and use. */
function PareMonitor() {
  const { data: m } = useQuery({
    queryKey: ['ai-metrics'],
    queryFn: () => adminApi.aiMetrics(),
    refetchInterval: 20000,
  });

  if (!m) {
    return (
      <div className="card">
        <p className="text-sm text-muted">Loading the monitor…</p>
      </div>
    );
  }

  const c = m.connectivity;
  const p = m.performance;
  const u = m.usage;
  const providerName = c.local ? 'On this machine' : c.provider;

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${HEALTH_DOT[c.health]}`} aria-hidden />
        <h3 className="text-base font-semibold text-ink">{HEALTH_WORD[c.health]}</h3>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Assistant" value={providerName} sub={c.model ?? (c.state === 'preparing' ? 'getting ready' : 'provider default')} />
        <Tile label="Response time" value={fmtMs(p.avg_ms)} sub={p.p95_ms != null ? `95th percentile ${fmtMs(p.p95_ms)}` : 'no calls yet'} />
        <Tile label="Working now" value={p.in_flight} sub={p.in_flight === 1 ? 'request in flight' : 'requests in flight'} />
        <Tile
          label="Recent errors"
          value={p.calls > 0 ? `${Math.round(p.error_rate * 100)}%` : 'None'}
          sub={p.calls > 0 ? `of the last ${p.calls}` : 'no recent calls'}
        />
        <Tile label="Conversations" value={u.conversations.toLocaleString()} sub={`${u.conversations_today} today`} />
        <Tile label="Messages" value={u.messages.toLocaleString()} />
        <Tile label="Words used" value={u.tokens.toLocaleString()} sub="tokens" />
        <Tile label="Up for" value={fmtUptime(p.uptime_seconds)} />
      </div>

      {m.top_users.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Who uses Pare most</h4>
          <ul className="divide-y divide-border text-sm">
            {m.top_users.map((tu) => (
              <li key={tu.name} className="flex items-center gap-2 py-1.5">
                <span className="text-ink">{tu.name}</span>
                <span className="ml-auto text-muted text-xs">
                  {tu.conversations} {tu.conversations === 1 ? 'chat' : 'chats'} · {tu.messages} messages
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const CHAT_SORTS: DataSort<AdminChatSummary>[] = [
  { key: 'updated', label: 'Last active', compare: (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(), defaultDir: 'desc' },
  { key: 'created', label: 'Started', compare: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(), defaultDir: 'desc' },
  { key: 'person', label: 'Person', compare: (a, b) => a.account_display_name.localeCompare(b.account_display_name) },
  { key: 'about', label: 'About', compare: (a, b) => (a.care_profile_name ?? '').localeCompare(b.care_profile_name ?? '') },
  { key: 'messages', label: 'Messages', compare: (a, b) => a.message_count - b.message_count, defaultDir: 'desc' },
  { key: 'tokens', label: 'Tokens', compare: (a, b) => a.tokens_used - b.tokens_used, defaultDir: 'desc' },
];

export function AdminChats() {
  const me = useAuthStore((s) => s.account);
  const isSuperAdmin = me?.role === 'super_admin';
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-chats'],
    queryFn: () => adminApi.listChats({ per_page: 1000 }),
  });
  // A conversation nobody said anything in is noise, so empty chats are left out.
  const chats = (data?.chats ?? []).filter((c) => c.message_count > 0);

  const dv = useDataView<AdminChatSummary>({
    rows: chats,
    getId: (c) => c.id,
    searchText: (c) => [c.account_display_name, c.account_email, c.care_profile_name].filter(Boolean).join(' '),
    sorts: CHAT_SORTS,
    defaultPageSize: 25,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-ink">Pare</h2>
        <p className="text-sm text-muted">
          How Pare is running, and every conversation with it
          {isSuperAdmin ? ' across the platform.' : ' about the people in your care.'}
        </p>
      </div>

      <PareMonitor />

      <div>
        <h3 className="mb-2">Conversations</h3>
        {error ? <p className="text-sm text-red-600 mb-2">Could not load the chat log.</p> : null}
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem] items-start">
          <div className="card p-0 overflow-hidden">
            <div className="p-3 border-b border-border">
              <DataToolbar
                search={dv.search}
                onSearch={dv.setSearch}
                searchPlaceholder="Search by person or profile..."
                sorts={CHAT_SORTS.map((s) => ({ key: s.key, label: s.label }))}
                sortKey={dv.sortKey}
                onSort={dv.setSortKey}
                filters={[]}
                filterValues={dv.filterValues}
                onFilter={dv.setFilter}
                page={dv.page}
                totalPages={dv.totalPages}
                pageSize={dv.pageSize}
                totalFiltered={dv.totalFiltered}
                onPageChange={dv.setPage}
                onPageSizeChange={dv.setPageSize}
              />
            </div>
            {isLoading ? (
              <p className="text-sm text-muted p-4">Loading…</p>
            ) : dv.view.length === 0 ? (
              <p className="text-sm text-muted p-4">No conversations yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr className="text-left text-xs text-muted">
                      <SortableTh label="Person" sortKey="person" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                      <SortableTh label="About" sortKey="about" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                      <SortableTh label="Messages" sortKey="messages" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                      <SortableTh label="Tokens" sortKey="tokens" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                      <SortableTh label="Last active" sortKey="updated" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {dv.view.map((c) => (
                      <tr
                        key={c.id}
                        data-record={c.id}
                        onClick={() => setActiveId(c.id)}
                        className={`border-b border-border last:border-0 cursor-pointer hover:bg-surface-2 transition-colors ${activeId === c.id ? 'bg-primary-50/50 dark:bg-primary-900/10' : ''}`}
                      >
                        <td data-field="person" className="px-3 py-2 font-medium text-ink">{c.account_display_name}</td>
                        <td data-field="about" className="px-3 py-2 text-muted">{c.care_profile_name ?? 'Dashboard'}</td>
                        <td data-field="messages" className="px-3 py-2 text-muted">{c.message_count}</td>
                        <td data-field="tokens" className="px-3 py-2 text-muted">{c.tokens_used.toLocaleString()}</td>
                        <td data-field="updated" className="px-3 py-2 text-muted whitespace-nowrap">
                          {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <ChatDetail activeId={activeId} />
        </div>
      </div>
    </div>
  );
}

function ChatDetail({ activeId }: { activeId: string | null }) {
  const { data: active, isLoading } = useQuery({
    queryKey: ['admin-chat', activeId],
    queryFn: () => adminApi.getChat(activeId!).then((r) => r.conversation),
    enabled: !!activeId,
  });

  return (
    <div className="card min-h-[20rem]">
      {!activeId ? (
        <p className="text-sm text-muted my-12 text-center">Pick a conversation to read it.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : active ? (
        <ChatMessages active={active} />
      ) : (
        <p className="text-sm text-muted">Could not load that conversation.</p>
      )}
    </div>
  );
}

function ChatMessages({ active }: { active: AdminChatDetail }) {
  return (
    <div className="space-y-3">
      <div className="pb-3 border-b border-border">
        <p className="text-sm font-semibold text-ink">{active.account_display_name}</p>
        <p className="text-xs text-muted">
          {active.care_profile_name ? `About ${active.care_profile_name}` : 'Dashboard chat'} ·{' '}
          {format(new Date(`${active.chat_day}T00:00:00`), 'd MMM yyyy')} · {active.account_email}
        </p>
      </div>
      {active.messages.length === 0 ? (
        <p className="text-sm text-muted">This conversation has no messages yet.</p>
      ) : (
        active.messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-surface-2 text-ink'}`}>
              {msg.content}
              <span className={`block mt-1 text-[10px] ${msg.role === 'user' ? 'text-white/70' : 'text-muted'}`}>
                {format(new Date(msg.timestamp), 'd MMM, HH:mm')}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
