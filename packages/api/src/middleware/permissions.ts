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
    (resource === 'circle' && req.method === 'PATCH' && (req.path === '/me/relationship' || req.path === '/me'));
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
 * A route that knows better than the generic guess what it changed sets
 * res.locals.auditEntries to these, and they are written instead of the one
 * default line. Recording a dose uses it so the activity reads "Jess
 * recorded Metoprolol as refused" rather than "Medication added", and a
 * round of several doses writes one line per dose.
 */
export interface AuditEntry {
  action?: 'created' | 'updated' | 'deleted';
  entity_type?: string;
  entity_id?: string | null;
  summary?: string | null;
}

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

  // The id of the record touched, so the activity can point back at it.
  // An edit or delete names it in the path; a create returns it, usually as
  // the one object in the response, e.g. { document: { id } }.
  let entityId: string | null = /^\/([0-9a-f-]{36})(?:\/|$)/i.exec(req.path)?.[1] ?? null;
  const sendJson = res.json.bind(res);
  res.json = (payload: unknown) => {
    if (!entityId && payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      const inner = Object.values(p).find(
        (v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).id === 'string'
      );
      const id = typeof p.id === 'string' ? p.id : inner?.id;
      if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) entityId = id;
    }
    return sendJson(payload);
  };

  res.on('finish', () => {
    if (res.statusCode >= 400 || !profileId) return;
    const custom = res.locals['auditEntries'] as AuditEntry[] | undefined;
    if (Array.isArray(custom)) {
      if (custom.length === 0) return;
      void db('audit_log')
        .insert(
          custom.map((e) => ({
            care_profile_id: profileId,
            actor_account_id: actorId,
            action: e.action ?? action,
            entity_type: e.entity_type ?? resourceOf(req),
            entity_id: e.entity_id ?? null,
            summary: e.summary ? e.summary.slice(0, 255) : null,
          }))
        )
        .catch((err) => console.warn('Audit log write failed:', (err as Error).message));
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    // The best available one-line description of what was touched, checked
    // in order of specificity across every record type the API accepts.
    const summary = [
      body.title, // tasks, appointments, documents, memories
      body.label, // documents, notification channels
      body.display_name,
      body.full_name,
      body.name, // conditions, treatments, health statuses, providers
      body.substance, // allergies
      body.medication_name, // medications and dose records
      body.subject,
      body.domain, // functional impact rows
      body.code, // diagnosis codes
      body.content, // notes and messages
      body.body,
    ]
      .find((v): v is string => typeof v === 'string' && v.trim().length > 0)
      ?.slice(0, 255);
    void db('audit_log')
      .insert({
        care_profile_id: profileId,
        actor_account_id: actorId,
        action,
        entity_type: resourceOf(req),
        entity_id: entityId,
        summary: summary ?? null,
      })
      .catch((err) => console.warn('Audit log write failed:', (err as Error).message));
  });
  next();
}

/**
 * Some changes are kept for the profile owner and platform admins: who is in
 * the care circle, the medication list, treatments and care costs. A blocked
 * person is told plainly what they cannot do and who can, by name, so they
 * know who to ask: "Only Linda Kowalski, who manages this profile, or an
 * admin can change a medication's dose or times."
 *
 * Pass what the route does, written to follow "can": "change a medication's
 * dose or times".
 */
export function requireProfileOwner(what: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.careAccess?.level === 'owner' || req.careAccess?.level === 'admin') {
      next();
      return;
    }
    res.status(403).json({ error: await ownerOnlyMessage(req.params['id'], what), code: 'OWNER_ONLY' });
  };
}

/** "Only Linda Kowalski, who manages this profile, or an admin can <what>." */
export async function ownerOnlyMessage(profileId: string | undefined, what: string): Promise<string> {
  let owner: string | null = null;
  try {
    if (profileId) {
      const row = await db('care_profiles as cp')
        .join('accounts as a', 'cp.account_id', 'a.id')
        .where('cp.id', profileId)
        .first('a.display_name');
      owner = (row?.display_name as string | undefined)?.trim() || null;
    }
  } catch {
    owner = null;
  }
  return owner
    ? `Only ${owner}, who manages this profile, or an admin can ${what}. Ask ${owner} if it needs changing.`
    : `Only the person who manages this profile, or an admin, can ${what}.`;
}
