import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { requireFeature } from '../middleware/subscriptionGate';
import { sendDashboardMessage } from '../services/ai';
import type { ChatMessage } from '../services/ai';
import { accessibleProfiles, buildDashboardContext, countAttentionItems, gatherAttentionItems, getDismissedKeys } from '../services/aiDashboardContext';
import { gatherHealthAlerts } from '../services/healthAlerts';
import { buildProfileContext } from '../services/aiContext';
import { extractDashboardActions, splitDashboardActions, executeDashboardActions } from '../services/aiDashboardActions';
import { executeCrossProfileActions } from '../services/aiActions';
import { replyIntendsToAct, repairActionText, dashboardActionReference } from '../services/actionRepair';
import { getCareAccess } from '../middleware/subscriptionGate';
import type { AiConversation, CareProfile } from '../types';

/**
 * Pare on the dashboard: an account-wide conversation that can see a
 * summary of every profile the account can reach. Stored in
 * ai_conversations with care_profile_id = NULL to keep dashboard
 * conversations apart from per-profile ones. Same auth, account rights,
 * subscription gating and token budget as the profile-level assistant.
 */
export const aiDashboardRouter = Router();

/**
 * What needs attention across everyone, listed so the Homeboard can show
 * the items itself. Also returns the count for backwards compatibility. The
 * optional tz query param renders due times on the user's own clock.
 */
aiDashboardRouter.get('/attention', requireAuth, async (req, res) => {
  const tz = typeof req.query['tz'] === 'string' ? req.query['tz'] : (req.account!.timezone ?? null);
  const items = await gatherAttentionItems(req.account!.id, tz);
  res.json({ count: items.length, items });
});

/**
 * Health alerts across everyone in the account's care: illnesses whose
 * symptoms have stayed above moderate for days, and injuries still
 * unresolved months on. Rendered as banners on the Homeboard and on each
 * person's overview, with their GP's details to hand. Dismissals share the
 * attention mechanism below.
 */
aiDashboardRouter.get('/health-alerts', requireAuth, async (req, res) => {
  const [profiles, dismissed] = await Promise.all([
    accessibleProfiles(req.account!.id),
    getDismissedKeys(req.account!.id),
  ]);
  const alerts = await gatherHealthAlerts(
    profiles.map((p) => ({ id: p.id, name: p.preferred_name ?? p.full_name }))
  );
  res.json({ alerts: alerts.filter((a) => !dismissed.has(a.key)) });
});

/**
 * Acknowledge a "needs attention" item and set it aside, so it stops showing
 * on this account's Homeboard. Only dismissible items reach here (the web app
 * gates the control behind an "are you sure?" confirm). A restock clears the
 * dismissal elsewhere, so an out-of-stock alert can recur.
 */
aiDashboardRouter.post('/attention/dismiss', requireAuth, async (req, res) => {
  const parsed = z.object({ key: z.string().min(1).max(255) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  await db('attention_dismissals')
    .insert({ account_id: req.account!.id, item_key: parsed.data.key })
    .onConflict(['account_id', 'item_key'])
    .ignore();
  res.json({ dismissed: true });
});

aiDashboardRouter.get('/conversations', requireAuth, async (req, res) => {
  const conversations = await db<AiConversation>('ai_conversations')
    .where({ account_id: req.account!.id })
    .whereNull('care_profile_id')
    .orderBy('updated_at', 'desc')
    .select('id', 'tokens_used', 'created_at', 'updated_at');
  res.json({ conversations });
});

/**
 * Today's dashboard conversation, so a chat survives closing the browser
 * and picks up where it left off on any device. Conversations belong to
 * the day they were started; a new day starts a new chat log.
 */
aiDashboardRouter.get('/conversations/current', requireAuth, async (req, res) => {
  const conversation = await db<AiConversation>('ai_conversations')
    .where({ account_id: req.account!.id })
    .whereNull('care_profile_id')
    .whereRaw('created_at::date = CURRENT_DATE')
    .orderBy('created_at', 'desc')
    .first();
  res.json({ conversation: conversation ?? null });
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
    const schema = z.object({
      content: z.string().min(1).max(4000),
      timezone: z.string().max(64).optional(),
      // The profile the user is currently viewing, so one conversation can
      // follow them from the Homeboard into a profile and back without ever
      // going blank, with that person's full record to hand.
      current_profile_id: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
      return;
    }
    const timeZone = parsed.data.timezone ?? null;

    const conversation = await db<AiConversation>('ai_conversations')
      .where({ id: req.params['convId'], account_id: req.account!.id })
      .whereNull('care_profile_id')
      .first();
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
      return;
    }

    const { context: dashboardContext, profileCount } = await buildDashboardContext(req.account!, timeZone);

    // If the user is viewing a profile, add that person's full record and
    // note it is open, so Pare can answer in detail and act on them directly
    // while still seeing everyone else.
    let context = dashboardContext;
    let openProfileName: string | null = null;
    if (parsed.data.current_profile_id) {
      const access = await getCareAccess(req.account!, parsed.data.current_profile_id);
      const profile = access
        ? await db<CareProfile>('care_profiles').where({ id: parsed.data.current_profile_id }).first()
        : null;
      if (access && profile) {
        openProfileName = profile.full_name;
        const full = await buildProfileContext(profile, access, timeZone);
        context = `${dashboardContext}\n\n## Currently open profile\nThe user is viewing ${profile.full_name}'s profile right now. When they say "log this", "record that" or otherwise do not name anyone, they mean ${profile.full_name}. Here is ${profile.full_name}'s full record:\n\n${full}`;
      }
    }

    const messages = conversation.messages as ChatMessage[];

    let result: { reply: string; tokensUsed: number };
    try {
      result = await sendDashboardMessage(req.account!, conversation.id, messages, parsed.data.content, context, profileCount, timeZone);
    } catch (err: unknown) {
      const appErr = err as { status?: number; code?: string; message?: string };
      if (appErr.status) {
        // An upstream AI 401/403 must not read as the user's session expiring
        // and log them out; other statuses (402, 429) still pass through.
        const status = appErr.status === 401 || appErr.status === 403 ? 502 : appErr.status;
        res.status(status).json({
          error: appErr.message ?? 'AI request failed',
          code: appErr.code ?? 'AI_ERROR',
        });
        return;
      }
      throw err;
    }

    // Carry out any actions the assistant proposed. Navigation is passed
    // through for the web app to perform; profile creation happens here;
    // cross-profile logging resolves each named profile and writes to it.
    const extracted = extractDashboardActions(result.reply);
    const { cleanedReply } = extracted;
    let { actions, parseErrors } = extracted;
    // If the reply meant to record something but emitted no block, ask once
    // more for just the JSON (weak models often describe the action instead of
    // emitting it). The open profile's name lets it resolve "log this".
    if (actions.length === 0 && parseErrors.length === 0 && replyIntendsToAct(result.reply)) {
      const repaired = await repairActionText(parsed.data.content, dashboardActionReference(openProfileName));
      if (repaired && repaired.trim().toUpperCase() !== 'NONE') {
        const re = extractDashboardActions(repaired);
        actions = re.actions;
        parseErrors = re.parseErrors;
      }
    }
    const { single, cross } = splitDashboardActions(actions);
    const { outcomes, clientActions, confirmations } = await executeDashboardActions(single, req.account!);
    const crossOutcomes = await executeCrossProfileActions(cross, req.account!, timeZone);
    const allOutcomes = [...outcomes, ...crossOutcomes, ...parseErrors];
    // Proposed completions are stored in the reply as confirm directives, so
    // the button stays put when the conversation is reloaded. The app renders
    // them; only the person's click completes the task.
    const confirmBlocks = confirmations.map((c) => `\n\n\`\`\`parecare-confirm\n${JSON.stringify(c)}\n\`\`\``).join('');
    const finalReply = [cleanedReply, ...allOutcomes.map((o) => `✔ ${o}`)].filter(Boolean).join('\n\n') + confirmBlocks;

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
