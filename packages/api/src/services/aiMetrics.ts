/**
 * A light, in-memory record of how Pare is performing right now: how long its
 * last calls took, how many are in flight, and how many failed. Every call to
 * the model goes through complete(), so timing it there catches all of Pare's
 * work in one place. It is deliberately in memory and best-effort: this powers
 * the traffic light and the monitoring panel, not billing, so losing it on a
 * restart costs nothing.
 */
interface CallRecord {
  at: number;
  ms: number;
  ok: boolean;
}

const RING = 200;
const calls: CallRecord[] = [];
let inFlight = 0;
const startedAt = Date.now();

/** Start timing one model call. Call the returned function once, with whether it succeeded. */
export function beginCall(): (ok: boolean) => void {
  inFlight += 1;
  const t0 = Date.now();
  let closed = false;
  return (ok: boolean) => {
    if (closed) return;
    closed = true;
    inFlight = Math.max(0, inFlight - 1);
    calls.push({ at: Date.now(), ms: Date.now() - t0, ok });
    while (calls.length > RING) calls.shift();
  };
}

export interface AiMetricsSnapshot {
  /** Completed calls within the window. */
  calls: number;
  /** Mean and 95th-percentile response time in ms, or null with no calls yet. */
  avg_ms: number | null;
  p95_ms: number | null;
  /** Share of windowed calls that failed, 0..1. */
  error_rate: number;
  /** Calls running right now. */
  in_flight: number;
  /** When the last call finished, or null. */
  last_at: string | null;
  /** How long this API process has been running. */
  uptime_seconds: number;
}

export function snapshot(windowMs = 10 * 60 * 1000): AiMetricsSnapshot {
  const now = Date.now();
  const recent = calls.filter((c) => now - c.at <= windowMs);
  const n = recent.length;
  const durations = recent.map((c) => c.ms).sort((a, b) => a - b);
  const avg = n ? Math.round(durations.reduce((s, x) => s + x, 0) / n) : null;
  const p95 = n ? durations[Math.min(n - 1, Math.floor(n * 0.95))]! : null;
  const failures = recent.filter((c) => !c.ok).length;
  const last = calls.length ? calls[calls.length - 1]!.at : null;
  return {
    calls: n,
    avg_ms: avg,
    p95_ms: p95,
    error_rate: n ? failures / n : 0,
    in_flight: inFlight,
    last_at: last ? new Date(last).toISOString() : null,
    uptime_seconds: Math.round((now - startedAt) / 1000),
  };
}

export type Health = 'green' | 'amber' | 'red';

/**
 * The traffic light. Offline or mostly failing is red; getting ready or busy is
 * amber; ready and healthy is green. Judged over the recent window so a single
 * old error does not stick.
 */
export function health(state: 'preparing' | 'ready' | 'unavailable'): Health {
  if (state === 'unavailable') return 'red';
  const s = snapshot();
  if (s.calls >= 3 && s.error_rate > 0.34) return 'red';
  if (state === 'preparing') return 'amber';
  if (s.in_flight >= 3 || (s.calls > 0 && s.error_rate > 0)) return 'amber';
  return 'green';
}
