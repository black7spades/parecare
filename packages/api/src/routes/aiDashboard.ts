import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { requireFeature } from '../middleware/subscriptionGate';
import { sendDashboardMessage } from '../services/ai';
import type { ChatMessage } from '../services/ai';
import { buildDashboardContext, countAttentionItems } from '../services/aiDashboardContext';
import { extractDashboardActions, executeDashboardActions } from '../services/aiDashboardActions';
import type { AiConversation } from '../types';

/**
 * Pare on the dashboard: an account-wide conversation that can see a
 * summary of every profile the account can reach. Stored in
 * ai_conversations with care_profile_id = NULL to keep dashboard
 * conversations apart from per-profile ones. Same auth, account rights,
 * subscription gating and token budget as the profile-level assistant.
 */
export const aiDashboardRouter = Router();

/** How many things need attention across everyone, for the dashboard prompt line. */
aiDashboardRouter.get('/attention', requireAuth, async (req, res) => {
  const count = await countAttentionItems(req.account!.id);
  res.json({ count });
});

aiDashboardRouter.get('/conversations', requireAuth, async (req, res) => {
  const conversations = await db<AiConversation>('ai_conversations')
    .where({ account_id: req.account!.id })
    .whereNull('care_profile_id')
    .orderBy('updated_at', 'desc')
    .select('id', 'tokens_used', 'created_at', 'updated_at');
  res.json({ conversations });
});

aiDashboardRouter.get('/conversations/:convId', requireAuth, async (req, res) => {
  const conversation = await db<AiConversation>('ai_conversations')
    .where({ id: req.params['convId'], account_id: req.account!.id })
    .whereNull('care_profile_id')
    .first();
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ conversation });
});

aiDashboardRouter.post(
  '/conversations',
  requireAuth,
  requireAccountRight('can_use_ai'),
  requireFeature('ai_access'),
  async (req, res) => {
    const [conversation] = await db<AiConversation>('ai_conversations')
      .insert({
        care_profile_id: null,
        account_id: req.account!.id,
        messages: db.raw("'[]'::jsonb"),
      })
      .returning('*');
    res.status(201).json({ conversation });
  }
);

aiDashboardRouter.post(
  '/conversations/:convId/messages',
  requireAuth,
  requireAccountRight('can_use_ai'),
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
      .whereNull('care_profile_id')
      .first();
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
      return;
    }

    const { context, profileCount } = await buildDashboardContext(req.account!);
    const messages = conversation.messages as ChatMessage[];

    let result: { reply: string; tokensUsed: number };
    try {
      result = await sendDashboardMessage(req.account!, conversation.id, messages, parsed.data.content, context, profileCount);
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

    // Carry out any actions the assistant proposed. Navigation is passed
    // through for the web app to perform; profile creation happens here.
    const { cleanedReply, actions, parseErrors } = extractDashboardActions(result.reply);
    const { outcomes, clientActions } = await executeDashboardActions(actions, req.account!);
    const allOutcomes = [...outcomes, ...parseErrors];
    const finalReply = [cleanedReply, ...allOutcomes.map((o) => `✔ ${o}`)].filter(Boolean).join('\n\n');

    const updatedMessages = [
      ...messages,
      { role: 'user', content: parsed.data.content, timestamp: new Date().toISOString() },
      { role: 'assistant', content: finalReply, timestamp: new Date().toISOString() },
    ];

    await db('ai_conversations').where({ id: conversation.id }).update({
      messages: JSON.stringify(updatedMessages),
      updated_at: db.fn.now(),
    });

    res.json({
      reply: finalReply,
      tokens_used: result.tokensUsed,
      actions_taken: allOutcomes,
      client_actions: clientActions,
    });
  }
);
