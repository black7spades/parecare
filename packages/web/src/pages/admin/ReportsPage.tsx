import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { healthStatusCategoryLabel, healthStatusStatusLabel } from '../../lib/care';

type Period = '7d' | '30d' | '90d' | 'custom';

function dateRange(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const to = new Date();
  if (period === 'custom' && customFrom && customTo) {
    return { from: customFrom, to: customTo };
  }
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

interface SentimentWeek {
  week: string;
  avg_sentiment: number;
  count: number;
}

interface HealthSummaryRow {
  category: string;
  status: string;
  count: number;
}

interface OutcomeData {
  positive: number;
  negative: number;
  total: number;
}

const SELECT = 'rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function ReportsPage() {
  const role = useAuthStore((s) => s.account?.role);
  const [period, setPeriod] = useState<Period>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo(() => dateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const qs = `from=${range.from}&to=${range.to}`;

  const { data: sentimentData } = useQuery({
    queryKey: ['reports-sentiment', qs],
    queryFn: () => api.get<{ weeks: SentimentWeek[] }>(`/reports/sentiment-trends?${qs}`),
  });
  const weeks = sentimentData?.weeks ?? [];

  const { data: healthData } = useQuery({
    queryKey: ['reports-health-summary'],
    queryFn: () => api.get<{ summary: HealthSummaryRow[] }>('/reports/health-status-summary'),
  });
  const healthSummary = healthData?.summary ?? [];

  const { data: outcomeData } = useQuery({
    queryKey: ['reports-outcomes', qs],
    queryFn: () => api.get<OutcomeData>(`/reports/outcome-analysis?${qs}`),
  });

  const scopeLabel = role === 'super_admin' ? 'All profiles' : role === 'admin' ? 'Your care circles' : 'Your tasks';

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Reports</h2>
          <p className="text-sm text-muted">Scope: {scopeLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['7d', '30d', '90d', 'custom'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                period === p ? 'bg-primary text-white font-medium' : 'bg-surface-2 text-muted hover:text-ink'
              }`}
              onClick={() => setPeriod(p)}
            >
              {p === 'custom' ? 'Custom' : p}
            </button>
          ))}
        </div>
      </div>

      {period === 'custom' ? (
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted">From</label>
          <input type="date" className={SELECT} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <label className="text-muted">To</label>
          <input type="date" className={SELECT} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
      ) : null}

      <div className="card">
        <h3 className="text-sm font-semibold text-ink mb-3">Sentiment trends</h3>
        {weeks.length === 0 ? (
          <p className="text-sm text-muted">No completed tasks with sentiment data in this period.</p>
        ) : (
          <div className="space-y-2">
            {weeks.map((w) => {
              const pct = (w.avg_sentiment / 6) * 100;
              const color =
                w.avg_sentiment >= 4 ? 'bg-green-500' : w.avg_sentiment >= 3 ? 'bg-amber-400' : 'bg-red-500';
              return (
                <div key={w.week} className="flex items-center gap-3 text-sm">
                  <span className="w-24 text-xs text-muted tabular-nums shrink-0">
                    {new Date(w.week).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <div className="flex-1 bg-surface-2 rounded-full h-4 overflow-hidden">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted tabular-nums w-16 text-right">
                    {w.avg_sentiment}/6 ({w.count})
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-ink mb-3">Health status summary</h3>
        {healthSummary.length === 0 ? (
          <p className="text-sm text-muted">No health statuses recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {healthSummary.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{healthStatusCategoryLabel(r.category)}</td>
                    <td className="px-3 py-2">{healthStatusStatusLabel(r.status)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-ink mb-3">Outcome analysis</h3>
        {!outcomeData || outcomeData.total === 0 ? (
          <p className="text-sm text-muted">No outcome data in this period.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-4 text-sm">
              <div className="flex-1 rounded-lg bg-green-50 dark:bg-green-900/20 p-4 text-center">
                <div className="text-2xl font-bold text-green-700 dark:text-green-300">{outcomeData.positive}</div>
                <div className="text-xs text-green-600 dark:text-green-400 mt-1">Positive (4-6)</div>
              </div>
              <div className="flex-1 rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-center">
                <div className="text-2xl font-bold text-red-700 dark:text-red-300">{outcomeData.negative}</div>
                <div className="text-xs text-red-600 dark:text-red-400 mt-1">Negative (1-3)</div>
              </div>
              <div className="flex-1 rounded-lg bg-surface-2 p-4 text-center">
                <div className="text-2xl font-bold text-ink">{outcomeData.total}</div>
                <div className="text-xs text-muted mt-1">Total rated</div>
              </div>
            </div>
            {outcomeData.total > 0 ? (
              <div className="flex rounded-full h-3 overflow-hidden bg-surface-2">
                <div
                  className="bg-green-500 h-full"
                  style={{ width: `${(outcomeData.positive / outcomeData.total) * 100}%` }}
                />
                <div
                  className="bg-red-500 h-full"
                  style={{ width: `${(outcomeData.negative / outcomeData.total) * 100}%` }}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
