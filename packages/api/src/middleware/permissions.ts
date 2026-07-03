import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Resource name = last segment of the mount path (/care-profiles/:id/<resource>)
function resourceOf(req: Request): string {
  const segments = req.baseUrl.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

/**
 * Read-only gate for viewer-level circle members. Viewers can read
 * everything their document visibility allows, and can take part in the
 * conversation (messages, question responses) — but cannot create, edit
 * or delete records.
 */
export function blockViewerWrites(req: Request, res: Response, next: NextFunction): void {
  if (READ_METHODS.has(req.method) || req.careAccess?.level !== 'viewer') {
    next();
    return;
  }
  const resource = resourceOf(req);
  const conversational =
    resource === 'messages' || // post + delete own messages
    (resource === 'questions' && req.method === 'POST' && /\/responses$/.test(req.path)) ||
    // Setting how you personally know the person is always self-service
    (resource === 'circle' && req.method === 'PATCH' && req.path === '/me/relationship');
  if (conversational) {
    next();
    return;
  }
  res.status(403).json({
    error: 'You have view-only access to this care profile',
    code: 'VIEW_ONLY',
  });
}

const AUDITED_ACTIONS: Record<string, string> = { POST: 'created', PUT: 'updated', PATCH: 'updated', DELETE: 'deleted' };

/**
 * Append-only activity trail for every successful change under a care
 * profile. Captures who, what kind of record, and a short summary — not
 * record contents.
 */
export function auditTrail(req: Request, res: Response, next: NextFunction): void {
  const action = AUDITED_ACTIONS[req.method];
  if (!action) {
    next();
    return;
  }
  const profileId = req.params['id'];
  const actorId = req.account?.id ?? null;

  res.on('finish', () => {
    if (res.statusCode >= 400 || !profileId) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const summary = [body.title, body.label, body.display_name, body.full_name, body.name]
      .find((v): v is string => typeof v === 'string' && v.trim().length > 0)
      ?.slice(0, 255);
    void db('audit_log')
      .insert({
        care_profile_id: profileId,
        actor_account_id: actorId,
        action,
        entity_type: resourceOf(req),
        summary: summary ?? null,
      })
      .catch((err) => console.warn('Audit log write failed:', (err as Error).message));
  });
  next();
}

/** Circle management (invites, roles, POA, removal) is owner-only. */
export function requireProfileOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.careAccess?.level !== 'owner') {
    res.status(403).json({
      error: 'Only the profile owner can manage the care circle',
      code: 'OWNER_ONLY',
    });
    return;
  }
  next();
}
