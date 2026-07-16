import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';

const ACTIONS: Record<string, string> = { POST: 'created', PUT: 'updated', PATCH: 'updated', DELETE: 'deleted' };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The record id the request touched: the last uuid in the sub-path. */
function sourceIdOf(req: Request): string | null {
  const matches = req.path.match(UUID_RE);
  return matches ? matches[matches.length - 1] : null;
}

function summaryOf(body: Record<string, unknown>): string | null {
  const value = [body['name'], body['substance'], body['label'], body['title']].find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  );
  return value ? value.slice(0, 255) : null;
}

/**
 * Watches a data-collection resource and records every successful change
 * as a care plan event. Events are the sole input to the incremental
 * care-plan updater: each one is later applied to exactly one plan
 * version, carried as provenance, and never re-applied.
 *
 * The full plan document is never regenerated from here — this only
 * appends facts about what changed.
 */
export function capturePlanEvents(sourceTable: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const action = ACTIONS[req.method];
    const profileId = req.params['id'];
    if (!action || !profileId) {
      next();
      return;
    }
    // The care-needs record itself is watched, but only its own update
    // endpoint (PUT /) — the version/changelog endpoints under the same
    // mount are outputs of the updater and must never feed back into it.
    if (sourceTable === 'plan' && !(req.method === 'PUT' && (req.path === '/' || req.path === ''))) {
      next();
      return;
    }
    const actorId = req.account?.id ?? null;
    const body = (req.body ?? {}) as Record<string, unknown>;

    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      void db('care_plan_events')
        .insert({
          care_profile_id: profileId,
          source_table: sourceTable,
          source_id: sourceIdOf(req),
          action,
          summary: summaryOf(body),
          snapshot: db.raw('?::jsonb', [JSON.stringify(body)]),
          actor_account_id: actorId,
        })
        .catch((err) => console.warn('Care plan event write failed:', (err as Error).message));
    });
    next();
  };
}
