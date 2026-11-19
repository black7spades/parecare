import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { canSeeDocument } from './documents';
import { withCategory } from '../services/documentCategories';
import type { Document } from '../types';
import { forwardInfoForNotes } from '../services/noteForwards';

/**
 * What every record's own view shows beyond its fields: notes people have
 * added, documents attached to it, and who changed it and when. A record is
 * named by its kind (the activity trail's names, such as appointments,
 * medications or log) and its id.
 */
export const recordsRouter = Router({ mergeParams: true });

const kindSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const idSchema = z.string().uuid();
const noteSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const linkSchema = z.object({ document_id: z.string().uuid() });

function target(params: Record<string, string>): { kind: string; id: string } | null {
  const kind = kindSchema.safeParse(params['kind']);
  const id = idSchema.safeParse(params['recordId']);
  return kind.success && id.success ? { kind: kind.data, id: id.data } : null;
}

recordsRouter.get('/:kind/:recordId', requireAuth, async (req, res) => {
  const t = target(req.params as Record<string, string>);
  if (!t) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  const [notes, docs, history] = await Promise.all([
    db('record_notes as n')
      .leftJoin('accounts as a', 'n.author_account_id', 'a.id')
      .where({ 'n.care_profile_id': profileId, 'n.entity_type': t.kind, 'n.entity_id': t.id })
      .orderBy('n.created_at', 'desc')
      .select('n.id', 'n.body', 'n.created_at', 'n.author_account_id', 'n.forward_id', 'a.display_name as author_name'),
    withCategory(db('documents'))
      .join('document_links as l', 'l.document_id', 'documents.id')
      .where({ 'documents.care_profile_id': profileId, 'l.entity_type': t.kind, 'l.entity_id': t.id })
      .orderBy('documents.created_at', 'desc'),
    db('audit_log as l')
      .leftJoin('accounts as a', 'l.actor_account_id', 'a.id')
      .where({ 'l.care_profile_id': profileId, 'l.entity_id': t.id })
      .orderBy('l.created_at', 'desc')
      .limit(50)
      .select('l.id', 'l.action', 'l.summary', 'l.source', 'l.created_at', 'a.display_name as actor_name'),
  ]);
  // A note passed on to another appointment shows where it went; a copy
  // that arrived from one shows who it is from.
  const typedNotes = notes as Array<Record<string, unknown> & { id: string; forward_id: string | null }>;
  const info = await forwardInfoForNotes(typedNotes);
  res.json({
    notes: typedNotes.map((n) => ({ ...n, ...info(n.id, n.forward_id) })),
    documents: (docs as Document[]).filter((d) => canSeeDocument(req, d)),
    history,
  });
});

recordsRouter.post('/:kind/:recordId/notes', requireAuth, async (req, res) => {
  const t = target(req.params as Record<string, string>);
  const parsed = noteSchema.safeParse(req.body);
  if (!t || !parsed.success) {
    res.status(400).json({ error: 'Write something to add as a note.', code: 'VALIDATION_ERROR' });
    return;
  }
  const [note] = await db('record_notes')
    .insert({
      care_profile_id: req.params['id'],
      entity_type: t.kind,
      entity_id: t.id,
      body: parsed.data.body,
      author_account_id: req.account!.id,
    })
    .returning('*');
  res.status(201).json({ note });
});

recordsRouter.delete('/notes/:noteId', requireAuth, async (req, res) => {
  const note = await db('record_notes')
    .where({ id: req.params['noteId'], care_profile_id: req.params['id'] })
    .first();
  if (!note) {
    res.status(404).json({ error: 'That note could not be found.', code: 'NOT_FOUND' });
    return;
  }
  // Your own notes are yours to remove; the owner can remove any.
  if (note.author_account_id !== req.account!.id && req.careAccess?.level !== 'owner') {
    res.status(403).json({ error: 'Only the person who wrote a note, or the owner, can remove it.', code: 'FORBIDDEN' });
    return;
  }
  await db.transaction(async (trx) => {
    await trx('record_notes').where({ id: note.id }).delete();
    // A forwarded copy removed here means the original is no longer forwarded.
    if (note.forward_id) await trx('note_forwards').where({ id: note.forward_id }).delete();
  });
  res.json({ note });
});

/** Attach a document already on file to this record. */
recordsRouter.post('/:kind/:recordId/documents', requireAuth, async (req, res) => {
  const t = target(req.params as Record<string, string>);
  const parsed = linkSchema.safeParse(req.body);
  if (!t || !parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const doc = await db('documents').where({ id: parsed.data.document_id, care_profile_id: req.params['id'] }).first();
  if (!doc) {
    res.status(404).json({ error: 'That document could not be found.', code: 'NOT_FOUND' });
    return;
  }
  await db('document_links')
    .insert({ document_id: doc.id, entity_type: t.kind, entity_id: t.id })
    .onConflict(['document_id', 'entity_type', 'entity_id'])
    .ignore();
  res.status(201).json({ linked: true });
});

/** Take a document off this record. The document itself stays in Documents. */
recordsRouter.delete('/:kind/:recordId/documents/:docId', requireAuth, async (req, res) => {
  const t = target(req.params as Record<string, string>);
  if (!t) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const doc = await db('documents').where({ id: req.params['docId'], care_profile_id: req.params['id'] }).first();
  if (!doc) {
    res.status(404).json({ error: 'That document could not be found.', code: 'NOT_FOUND' });
    return;
  }
  await db('document_links').where({ document_id: doc.id, entity_type: t.kind, entity_id: t.id }).delete();
  res.json({ unlinked: true });
});
