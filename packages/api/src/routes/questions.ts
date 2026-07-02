import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import type { OpenQuestion } from '../types';

export const questionsRouter = Router({ mergeParams: true });

questionsRouter.get('/', requireAuth, async (req, res) => {
  const questions = await db<OpenQuestion>('open_questions')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('created_at', 'desc');
  res.json({ questions });
});

questionsRouter.post('/', requireAuth, async (req, res) => {
  const schema = z.object({
    title: z.string().min(1).max(255),
    body: z.string().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [question] = await db<OpenQuestion>('open_questions')
    .insert({ care_profile_id: req.params['id'], ...parsed.data })
    .returning('*');

  res.status(201).json({ question });
});

questionsRouter.patch('/:questionId', requireAuth, async (req, res) => {
  const schema = z.object({
    status: z.enum(['open', 'resolved', 'deferred']).optional(),
    resolution: z.string().optional().nullable(),
    resolved_at: z.string().datetime().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [question] = await db<OpenQuestion>('open_questions')
    .where({ id: req.params['questionId'], care_profile_id: req.params['id'] })
    .update(parsed.data)
    .returning('*');

  if (!question) {
    res.status(404).json({ error: 'Question not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ question });
});

questionsRouter.get('/:questionId/responses', requireAuth, async (req, res) => {
  const responses = await db('open_question_responses')
    .leftJoin('care_circle_members', 'open_question_responses.author_member_id', 'care_circle_members.id')
    .where({ question_id: req.params['questionId'] })
    .orderBy('open_question_responses.created_at', 'asc')
    .select(
      'open_question_responses.id',
      'open_question_responses.body',
      'open_question_responses.created_at',
      'care_circle_members.display_name as author_name'
    );
  res.json({ responses });
});

questionsRouter.post('/:questionId/responses', requireAuth, async (req, res) => {
  const schema = z.object({ body: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [response] = await db('open_question_responses')
    .insert({ question_id: req.params['questionId'], body: parsed.data.body })
    .returning('*');

  res.status(201).json({ response });
});
