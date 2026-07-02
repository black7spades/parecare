import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/subscriptionGate';
import { sendMessage } from '../services/ai';
import type { ChatMessage } from '../services/ai';
import type { AiConversation, CareProfile, CareCircleMember } from '../types';

export const aiRouter = Router({ mergeParams: true });

aiRouter.get('/conversations', requireAuth, async (req, res) => {
  const conversations = await db<AiConversation>('ai_conversations')
    .where({ care_profile_id: req.params['id'], account_id: req.account!.id })
    .orderBy('updated_at', 'desc')
    .select('id', 'tokens_used', 'created_at', 'updated_at');
  res.json({ conversations });
});

aiRouter.get('/conversations/:convId', requireAuth, async (req, res) => {
  const conversation = await db<AiConversation>('ai_conversations')
    .where({ id: req.params['convId'], account_id: req.account!.id, care_profile_id: req.params['id'] })
    .first();
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ conversation });
});

aiRouter.post(
  '/conversations',
  requireAuth,
  requireFeature('ai_access'),
  async (req, res) => {
    const [conversation] = await db<AiConversation>('ai_conversations')
      .insert({
        care_profile_id: req.params['id'],
        account_id: req.account!.id,
        messages: db.raw("'[]'::jsonb"),
      })
      .returning('*');
    res.status(201).json({ conversation });
  }
);

aiRouter.post(
  '/conversations/:convId/messages',
  requireAuth,
  requireFeature('ai_access'),
  async (req, res) => {
    const schema = z.object({ content: z.string().min(1).max(4000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
      return;
    }

    const conversation = await db<AiConversation>('ai_conversations')
      .where({ id: req.params['convId'], account_id: req.account!.id })
      .first();
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
      return;
    }

    const profile = await db<CareProfile>('care_profiles')
      .where({ id: req.params['id'] })
      .first();
    if (!profile) {
      res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
      return;
    }

    const member = await db<CareCircleMember>('care_circle_members')
      .where({ care_profile_id: req.params['id'], account_id: req.account!.id })
      .first();

    const messages = conversation.messages as ChatMessage[];

    let result: { reply: string; tokensUsed: number };
    try {
      result = await sendMessage(
        req.account!,
        conversation.id,
        profile,
        member,
        messages,
        parsed.data.content
      );
    } catch (err: unknown) {
      const appErr = err as { status?: number; code?: string; message?: string };
      if (appErr.status) {
        res.status(appErr.status).json({
          error: appErr.message ?? 'AI request failed',
          code: appErr.code ?? 'AI_ERROR',
        });
        return;
      }
      throw err;
    }

    const updatedMessages = [
      ...messages,
      { role: 'user', content: parsed.data.content, timestamp: new Date().toISOString() },
      { role: 'assistant', content: result.reply, timestamp: new Date().toISOString() },
    ];

    await db('ai_conversations').where({ id: conversation.id }).update({
      messages: JSON.stringify(updatedMessages),
      updated_at: db.fn.now(),
    });

    res.json({ reply: result.reply, tokens_used: result.tokensUsed });
  }
);
