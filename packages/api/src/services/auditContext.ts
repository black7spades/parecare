import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped attribution for the audit trail. A change made through the
 * assistant runs inside this context so every audit row it writes records how
 * it was made and which batch it belongs to, without threading the fact
 * through dozens of action executors. Ordinary writes run outside it and fall
 * back to a person, which is what they are.
 */
export type AuditSource = 'person' | 'pare' | 'assistant';

export interface AuditContext {
  source: AuditSource;
  /** Groups the rows one action call wrote, so one token can undo them. */
  undoBatch: string | null;
}

export const auditContext = new AsyncLocalStorage<AuditContext>();

/** The source in force right now, or a person when nothing set one. */
export function currentAuditSource(): AuditSource {
  return auditContext.getStore()?.source ?? 'person';
}

/** The undo batch in force right now, if any. */
export function currentUndoBatch(): string | null {
  return auditContext.getStore()?.undoBatch ?? null;
}
