import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/subscriptionGate';
import { requireAccountRight } from '../middleware/accountRights';
import { mediateQuestion } from '../services/ai';
import { guardMessageTone, toneBlockBody } from '../services/messageTone';
import type { CareProfile, OpenQuestion } from '../types';
import { QuestionProblem, questionInputSchema, questionsOut, saveQuestion } from '../services/questions';

export const questionsRouter = Router({ mergeParams: true });

questionsRouter.get('/', requireAuth, async (req, res) => {
  const questions = await questionsOut(db, String(req.params['id']));
  res.json({ questions });
});

/** One question as the list returns it. */
const oneQuestion = async (profileId: string, id: string) =>
  (await questionsOut(db, profileId, (q) => void q.where('q.id', id)))[0] ?? null;

questionsRouter.post('/', requireAuth, async (req, res) => {
  const parsed = questionInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Write the question first, then save it.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);

  // Questions are a communications surface too, so the same tone guard applies.
  const verdict = await guardMessageTone(profileId, [parsed.data.title, parsed.data.body].filter(Boolean).join('\n'));
  if (!verdict.ok) {
    res.status(422).json(toneBlockBody(verdict));
    return;
  }

  try {
    const saved = await db.transaction((trx) =>
      saveQuestion(trx, { profileId, actorId: req.account!.id, actorMemberId: req.careAccess?.member?.id ?? null, input: parsed.data })
    );
    res.status(201).json({ question: await oneQuestion(profileId, saved.id), filed: saved.filed });
  } catch (err) {
    if (err instanceof QuestionProblem) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
});

questionsRouter.patch('/:questionId', requireAuth, async (req, res) => {
  const schema = questionInputSchema.partial().extend({
    status: z.enum(['open', 'resolved', 'deferred']).optional(),
    resolution: z.string().max(4000).optional().nullable(),
    resolved_at: z.string().datetime().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'The question did not save. Check the question is written, then save it again.', code: 'VALIDATION_ERROR' });
    return;
  }
  const profileId = String(req.params['id']);
  const questionId = String(req.params['questionId']);
  const { status, resolution, resolved_at, ...input } = parsed.data;
  // New words go through the same tone guard as a new question.
  if (input.title !== undefined || input.body !== undefined) {
    const verdict = await guardMessageTone(profileId, [input.title, input.body].filter(Boolean).join('\n'));
    if (!verdict.ok) {
      res.status(422).json(toneBlockBody(verdict));
      return;
    }
  }
  try {
    const found = await db.transaction(async (trx) => {
      const exists = await trx('open_questions').where({ id: questionId, care_profile_id: profileId }).first('id');
      if (!exists) return false;
      if (Object.keys(input).length) {
        await saveQuestion(trx, { profileId, actorId: req.account!.id, input, questionId });
      }
      const state: Record<string, unknown> = {};
      if (status !== undefined) state['status'] = status;
      if (resolution !== undefined) state['resolution'] = resolution?.trim() || null;
      if (resolved_at !== undefined) state['resolved_at'] = resolved_at;
      if (status === 'resolved' && resolved_at === undefined) state['resolved_at'] = trx.fn.now();
      if (status === 'open') state['resolved_at'] = null;
      if (Object.keys(state).length) await trx('open_questions').where({ id: questionId }).update(state);
      return true;
    });
    if (!found) {
      res.status(404).json({ error: 'Question not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ question: await oneQuestion(profileId, questionId) });
  } catch (err) {
    if (err instanceof QuestionProblem) {
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
      return;
    }
    throw err;
  }
});

questionsRouter.delete('/:questionId', requireAuth, async (req, res) => {
  const deleted = await db('open_questions')
    .where({ id: req.params['questionId'], care_profile_id: req.params['id'] })
    .del();
  if (!deleted) {
    res.status(404).json({ error: 'Question not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ deleted: 1 });
});

questionsRouter.post('/bulk', requireAuth, async (req, res) => {
  const schema = z.object({
    action: z.enum(['resolve', 'delete']),
    ids: z.array(z.string().uuid()).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const { action, ids } = parsed.data;
  const profileId = req.params['id'];

  if (action === 'delete') {
    const deleted = await db('open_questions')
      .where({ care_profile_id: profileId })
      .whereIn('id', ids)
      .del();
    res.json({ deleted });
  } else {
    const updated = await db<OpenQuestion>('open_questions')
      .where({ care_profile_id: profileId })
      .whereIn('id', ids)
      .update({ status: 'resolved', resolved_at: new Date().toISOString() });
    res.json({ updated });
  }
});

// A reply belongs to a question, and the question to one profile. Every
// reply route checks the question is on this profile first, so an id from
// someone else's profile can never be read or written through this one.
async function questionOnProfile(questionId: unknown, profileId: unknown): Promise<OpenQuestion | undefined> {
  if (typeof questionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(questionId)) return undefined;
  return db<OpenQuestion>('open_questions')
    .where({ id: questionId, care_profile_id: String(profileId) })
    .first();
}

questionsRouter.get('/:questionId/responses', requireAuth, async (req, res) => {
  const question = await questionOnProfile(req.params['questionId'], req.params['id']);
  if (!question) {
    res.status(404).json({ error: 'Question not found', code: 'NOT_FOUND' });
    return;
  }
  const responses = await responsesWithAuthors().where({ 'r.question_id': question.id }).orderBy('r.created_at', 'asc');
  res.json({ responses });
});

/**
 * Replies as every thread reads them: who wrote each one, by their login's
 * name, else the circle member's name.
 */
const responsesWithAuthors = () =>
  db('open_question_responses as r')
    .leftJoin('accounts as acc', 'acc.id', 'r.author_account_id')
    .leftJoin('care_circle_members as m', 'm.id', 'r.author_member_id')
    .select('r.id', 'r.body', 'r.created_at', 'r.is_ai', 'r.author_account_id', db.raw('coalesce(acc.display_name, m.display_name) as author_name'));

// Neutral AI mediation for a disputed question: summarises common ground,
// each position, options, and a next step, and posts it into the thread.
questionsRouter.post('/:questionId/mediate', requireAuth, requireAccountRight('can_use_ai'), requireFeature('ai_access'), async (req, res) => {
  const question = await questionOnProfile(req.params['questionId'], req.params['id']);
  if (!question) {
    res.status(404).json({ error: 'Question not found', code: 'NOT_FOUND' });
    return;
  }

  const profile = await db<CareProfile>('care_profiles').where({ id: req.params['id'] }).first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }

  const rows = await responsesWithAuthors().where({ 'r.question_id': question.id, 'r.is_ai': false }).orderBy('r.created_at', 'asc');

  let summary: string;
  try {
    const result = await mediateQuestion(req.account!, profile, {
      questionTitle: question.title,
      questionBody: question.body,
      responses: rows.map((r) => ({ author: r.author_name ?? 'A family member', body: r.body })),
    });
    summary = result.summary;
  } catch (err: unknown) {
    const appErr = err as { status?: number; code?: string; message?: string };
    if (appErr.status) {
      res.status(appErr.status).json({ error: appErr.message ?? 'AI request failed', code: appErr.code ?? 'AI_ERROR' });
      return;
    }
    throw err;
  }

  const [response] = await db('open_question_responses')
    .insert({ question_id: question.id, body: summary, is_ai: true })
    .returning(['id', 'body', 'created_at', 'is_ai']);

  res.status(201).json({ response: { ...response, author_name: null } });
});

questionsRouter.post('/:questionId/responses', requireAuth, async (req, res) => {
  const schema = z.object({ body: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const question = await questionOnProfile(req.params['questionId'], req.params['id']);
  if (!question) {
    res.status(404).json({ error: 'Question not found', code: 'NOT_FOUND' });
    return;
  }

  // Who wrote it, from the session.
  const [created] = await db('open_question_responses')
    .insert({ question_id: question.id, body: parsed.data.body, author_account_id: req.account!.id, author_member_id: req.careAccess?.member?.id ?? null })
    .returning('id');
  const response = await responsesWithAuthors().where('r.id', (created as { id: string }).id).first();

  res.status(201).json({ response });
});
