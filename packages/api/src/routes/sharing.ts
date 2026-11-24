import path from 'path';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { getStorageConfig } from '../config/settings';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { composeEmergencySheet } from '../services/emergencySheet';
import { getDownloadUrl } from '../services/storage';
import {
  activeEmergencyLink,
  appointmentIcs,
  createShareLink,
  linkMayOpenDocument,
  linkOut,
  openShared,
  type ShareLinkRow,
} from '../services/shareLinks';

/** One person's emergency sheet, for their own profile page and for keeping on a phone. */
export const emergencySheetRouter = Router({ mergeParams: true });

emergencySheetRouter.get('/', requireAuth, async (req, res) => {
  const access = req.careAccess;
  const sheet = await composeEmergencySheet(String(req.params['id']), { owner: access?.level === 'owner', role: access?.member?.role ?? null });
  if (!sheet) {
    res.status(404).json({ error: 'That person could not be found.', code: 'NOT_FOUND' });
    return;
  }
  const link = await activeEmergencyLink(sheet.profile.id);
  res.json({ sheet, link: link ? linkOut(link) : null });
});

/**
 * The links a person's records are shared through. The emergency sheet has
 * one link at a time, made on the first Share a link and kept until it is
 * turned off. Appointment and report links are made when they are sent.
 */
export const shareLinksRouter = Router({ mergeParams: true });

shareLinksRouter.get('/', requireAuth, async (req, res) => {
  const q = db('share_links').where({ care_profile_id: String(req.params['id']) }).orderBy('created_at', 'desc').limit(200);
  if (req.query['kind']) q.where({ kind: String(req.query['kind']) });
  const links = (await q) as ShareLinkRow[];
  res.json({ links: links.map(linkOut) });
});

shareLinksRouter.post('/', requireAuth, async (req, res) => {
  const parsed = z.object({ kind: z.literal('emergency_sheet') }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: 'Only the emergency sheet is shared from here. Appointments and reports are shared when they are sent.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }
  const profileId = String(req.params['id']);
  const existing = await activeEmergencyLink(profileId);
  if (existing) {
    res.json({ link: linkOut(existing) });
    return;
  }
  try {
    const link = await createShareLink(db, { profileId, kind: 'emergency_sheet', createdBy: req.account!.id });
    res.status(201).json({ link: linkOut(link) });
  } catch (err) {
    // Two taps at once: one link is made, and both get it.
    const made = await activeEmergencyLink(profileId);
    if (!made) throw err;
    res.json({ link: linkOut(made) });
  }
});

shareLinksRouter.delete('/:linkId', requireAuth, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params['linkId']))) {
    res.status(404).json({ error: 'That link could not be found.', code: 'NOT_FOUND' });
    return;
  }
  const [row] = await db('share_links')
    .where({ id: req.params['linkId'], care_profile_id: String(req.params['id']) })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now() })
    .returning('*');
  if (!row) {
    res.status(404).json({ error: 'That link is already turned off.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ link: linkOut(row as ShareLinkRow) });
});

/** Undo a turn off: the same link works again. */
shareLinksRouter.post('/:linkId/restore', requireAuth, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params['linkId']))) {
    res.status(404).json({ error: 'That link could not be found.', code: 'NOT_FOUND' });
    return;
  }
  const profileId = String(req.params['id']);
  const row = (await db('share_links').where({ id: req.params['linkId'], care_profile_id: profileId }).first()) as ShareLinkRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'That link could not be found.', code: 'NOT_FOUND' });
    return;
  }
  // One emergency sheet link at a time: a newer one stays the one in use.
  if (!row.revoked_at) {
    res.json({ link: linkOut(row) });
    return;
  }
  if (row.kind === 'emergency_sheet' && (await activeEmergencyLink(profileId))) {
    res.status(409).json({ error: 'A newer link is already on. Turn that one off first to bring this one back.', code: 'NEWER_LINK' });
    return;
  }
  const [restored] = await db('share_links').where({ id: row.id }).update({ revoked_at: null }).returning('*');
  res.json({ link: linkOut(restored as ShareLinkRow) });
});

/**
 * The public end of a share link: no login, the token is the credential,
 * and opens are limited per address so tokens cannot be guessed.
 */
export const sharedRouter = Router();
sharedRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));
// Never kept by a browser or a proxy: a link turned off, or back on, answers fresh.
sharedRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const turnedOff = (by: string | null) =>
  by ? `This link has been turned off. Ask ${by} for a new one.` : 'This link does not open anything. Ask whoever sent it for a new one.';

sharedRouter.get('/:token', async (req, res) => {
  const opened = await openShared(String(req.params['token']));
  if (!opened.ok) {
    res.status(opened.status).json({
      error: turnedOff(opened.shared_by),
      code: opened.status === 410 ? 'LINK_OFF' : 'NOT_FOUND',
      shared_by: opened.shared_by,
    });
    return;
  }
  res.json(opened.page);
});

sharedRouter.get('/:token/calendar.ics', async (req, res) => {
  const opened = await openShared(String(req.params['token']), { count: false });
  if (!opened.ok) {
    res.status(opened.status).send(turnedOff(opened.shared_by));
    return;
  }
  const file = opened.page.kind === 'appointment' ? await appointmentIcs(opened.link.care_profile_id, opened.page.appointment.id) : null;
  if (!file) {
    res.status(404).send('This link has no appointment with a date to add.');
    return;
  }
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.body);
});

sharedRouter.get('/:token/documents/:docId', async (req, res) => {
  const opened = await openShared(String(req.params['token']), { count: false });
  const docId = String(req.params['docId']);
  if (!opened.ok || !/^[0-9a-f-]{36}$/i.test(docId) || !(await linkMayOpenDocument(opened.link, docId, opened.page))) {
    res.status(404).json({ error: 'That document is not part of this link.', code: 'NOT_FOUND' });
    return;
  }
  const doc = (await db('documents').where({ id: docId, care_profile_id: opened.link.care_profile_id }).first()) as
    | { file_url: string; mime_type: string | null; label: string }
    | undefined;
  if (!doc) {
    res.status(404).json({ error: 'That document is no longer on file.', code: 'NOT_FOUND' });
    return;
  }
  if (!doc.file_url.startsWith('/uploads/')) {
    res.redirect(await getDownloadUrl(doc.file_url));
    return;
  }
  const localPath = path.resolve(getStorageConfig().localPath, doc.file_url.slice('/uploads/'.length));
  if (doc.mime_type) res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${doc.label.replace(/[^\w .-]/g, '_')}${path.extname(doc.file_url)}"`);
  res.sendFile(localPath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'That file is missing from storage.', code: 'NOT_FOUND' });
  });
});
