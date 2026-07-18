import { Router, type Request } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { requireFeature } from '../middleware/subscriptionGate';
import { sendMessage } from '../services/ai';
import type { ChatMessage } from '../services/ai';
import { buildProfileContext } from '../services/aiContext';
import { extractActions, executeActions } from '../services/aiActions';
import { replyIntendsToAct, repairActionText, PROFILE_ACTION_REFERENCE } from '../services/actionRepair';
import type { AiConversation, CareProfile } from '../types';

export const aiRouter = Router({ mergeParams: true });

/**
 * Whether this requester may read chats other people had about this
 * person: the profile owner and platform admins can, so the person
 * coordinating the care can review every conversation in one place.
 * Circle members only ever see their own conversations.
 */
function canReadAllChats(req: Request): boolean {
  const level = req.careAccess?.level;
  return level === 'owner' || level === 'admin';
}

aiRouter.get('/conversations', requireAuth, async (req, res) => {
  const query = db<AiConversation>('ai_conversations')
    .join('accounts', 'ai_conversations.account_id', 'accounts.id')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('ai_conversations.updated_at', 'desc')
    .select(
      'ai_conversations.id',
      'ai_conversations.account_id',
      'accounts.display_name as account_display_name',
      'ai_conversations.tokens_used',
      db.raw("to_char(ai_conversations.created_at, 'YYYY-MM-DD') as chat_day"),
      'ai_conversations.created_at',
      'ai_conversations.updated_at'
    );
  if (!canReadAllChats(req)) {
    query.where({ 'ai_conversations.account_id': req.account!.id });
  }
  const conversations = (await query).map((c) => ({ ...c, is_own: c.account_id === req.account!.id }));
  res.json({ conversations });
});

/**
 * Today's conversation for this requester on this profile, so a chat
 * survives closing the browser and picks up where it left off on any
 * device. Conversations belong to the day they were started; a new day
 * starts a new chat log.
 */
aiRouter.get('/conversations/current', requireAuth, async (req, res) => {
  const conversation = await db<AiConversation>('ai_conversations')
    .where({ care_profile_id: req.params['id'], account_id: req.account!.id })
    .whereRaw('created_at::date = CURRENT_DATE')
    .orderBy('created_at', 'desc')
    .first();
  res.json({ conversation: conversation ?? null });
});

aiRouter.get('/conversations/:convId', requireAuth, async (req, res) => {
  const query = db<AiConversation>('ai_conversations').where({
    id: req.params['convId'],
    care_profile_id: req.params['id'],
  });
  if (!canReadAllChats(req)) {
    query.where({ account_id: req.account!.id });
  }
  const conversation = await query.first();
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ conversation });
});

aiRouter.post(
  '/conversations',
  requireAuth,
  requireAccountRight('can_use_ai'),
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
  requireAccountRight('can_use_ai'),
  requireFeature('ai_access'),
  async (req, res) => {
    const schema = z.object({ content: z.string().min(1).max(4000), timezone: z.string().max(64).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
      return;
    }
    const timeZone = parsed.data.timezone ?? null;

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

    // Set by requireCareProfileAccess on the router mount; the member (or
    // owner/admin) it resolved decides what the assistant may see and do.
    const access = req.careAccess!;
    const canWrite = access.level !== 'viewer';
    const contextBlock = await buildProfileContext(profile, access, timeZone);

    const messages = conversation.messages as ChatMessage[];

    let result: { reply: string; tokensUsed: number };
    try {
      result = await sendMessage(
        req.account!,
        conversation.id,
        profile,
        access.member ?? undefined,
        messages,
        parsed.data.content,
        contextBlock,
        canWrite,
        timeZone
      );
    } catch (err: unknown) {
      const appErr = err as { status?: number; code?: string; message?: string };
      if (appErr.status) {
        // Never surface the AI provider's own 401/403 as the client's: it
        // would read as the user's session expiring and log them out. Other
        // statuses (402 subscription, 429 rate limit) still pass through.
        const status = appErr.status === 401 || appErr.status === 403 ? 502 : appErr.status;
        res.status(status).json({
          error: appErr.message ?? 'AI request failed',
          code: appErr.code ?? 'AI_ERROR',
        });
        return;
      }
      throw err;
    }

    // Carry out any actions the assistant proposed, then show what happened
    // instead of the raw action blocks.
    const extracted = extractActions(result.reply);
    const { cleanedReply } = extracted;
    let { actions, parseErrors } = extracted;
    // Weak models sometimes describe an action (or fake a confirmation) without
    // emitting the block. When the reply clearly meant to record something but
    // produced nothing, ask once more for just the JSON and run that.
    if (canWrite && actions.length === 0 && parseErrors.length === 0 && replyIntendsToAct(result.reply)) {
      const repaired = await repairActionText(parsed.data.content, PROFILE_ACTION_REFERENCE);
      if (repaired && repaired.trim().toUpperCase() !== 'NONE') {
        const re = extractActions(repaired);
        actions = re.actions;
        parseErrors = re.parseErrors;
      }
    }
    const outcomes = [...(await executeActions(actions, req.params['id']!, req.account!, access, timeZone)), ...parseErrors];
    const finalReply = [cleanedReply, ...outcomes.map((o) => `✔ ${o}`)].filter(Boolean).join('\n\n');

    const updatedMessages = [
      ...messages,
      { role: 'user', content: parsed.data.content, timestamp: new Date().toISOString() },
      { role: 'assistant', content: finalReply, timestamp: new Date().toISOString() },
    ];

    await db('ai_conversations').where({ id: conversation.id }).update({
      messages: JSON.stringify(updatedMessages),
      updated_at: db.fn.now(),
    });

    res.json({ reply: finalReply, tokens_used: result.tokensUsed, actions_taken: outcomes });
  }
);
