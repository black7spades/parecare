import { db } from '../config/database';
import { env } from '../config/env';
import { complete, isAiConfigured } from './aiProvider';
import type { Account, CareProfile, CareCircleMember } from '../types';

function ensureConfigured(): void {
  if (!isAiConfigured()) {
    // 503, not 402 — a missing provider is a server configuration issue,
    // and 402 makes the web app show the subscription upgrade prompt.
    throw Object.assign(
      new Error('AI assistant is not configured. Set AI_PROVIDER and its API key (or a local model) on the server.'),
      { status: 503, code: 'AI_NOT_CONFIGURED' }
    );
  }
}

function getTokenLimit(account: Account): number {
  if (env.SELF_HOSTED) return -1;
  const tier = account.subscription_tier;
  if (tier === 'professional') return env.AI_TOKENS_PROFESSIONAL;
  if (tier === 'family') return env.AI_TOKENS_FAMILY;
  return env.AI_TOKENS_FREE;
}

export async function checkTokenBudget(account: Account): Promise<void> {
  if (env.SELF_HOSTED) return;

  const limit = getTokenLimit(account);
  if (limit === 0) {
    throw Object.assign(
      new Error('AI assistant is not available on the free plan. Upgrade to access it.'),
      { status: 402, code: 'SUBSCRIPTION_REQUIRED', feature: 'ai_access' }
    );
  }
  if (limit === -1) return;

  const now = new Date();
  if (new Date(account.ai_tokens_reset_at) < now) {
    await db('accounts').where({ id: account.id }).update({
      ai_tokens_used: 0,
      ai_tokens_reset_at: db.raw("NOW() + INTERVAL '1 month'"),
      updated_at: db.fn.now(),
    });
    account.ai_tokens_used = 0;
  }

  if (account.ai_tokens_used >= limit) {
    throw Object.assign(
      new Error('AI token limit reached for this billing period. It will reset next month.'),
      { status: 402, code: 'AI_TOKEN_LIMIT' }
    );
  }
}

export async function recordTokenUsage(
  accountId: string,
  conversationId: string | null,
  tokensUsed: number
): Promise<void> {
  await db.transaction(async (trx) => {
    await trx('accounts').where({ id: accountId }).increment('ai_tokens_used', tokensUsed);
    if (conversationId) {
      await trx('ai_conversations')
        .where({ id: conversationId })
        .update({ tokens_used: db.raw(`tokens_used + ${tokensUsed}`) });
    }
  });
}

function buildSystemPrompt(
  profile: CareProfile,
  member: CareCircleMember | undefined
): string {
  const firstName = profile.preferred_name ?? profile.full_name.split(' ')[0];
  return `You are PareCare Assistant, a plain-language guide for families caring for ageing parents. You help people understand what they should do, what paperwork is involved, and what their legal options are at each stage of the care journey.

Current context:
- Person being cared for: ${firstName}
- Current care phase: ${profile.current_phase.replace(/_/g, ' ')}
- Asking member's role: ${member?.role ?? 'family member'}
- Jurisdiction: Australia

Speak plainly. Never use medical abbreviations without explaining them. Never use legal jargon without defining it. When you don't know something specific to the person's situation, say so and suggest who to contact. Keep answers practical and focused on what the person can actually do next. Do not give formal legal or medical advice; frame guidance as information to take to the relevant professional. Never use em dashes in your replies.

Family care decisions are emotionally loaded and often carry old resentments. When a question involves disagreement between family members, act as a neutral mediator: never take sides, restate each position fairly and charitably, name the shared goal (${firstName}'s wellbeing), and steer towards concrete options the family can decide between. Where a claim is disputed, suggest how it could be verified (a GP's opinion, an assessment, a document) rather than adjudicating it yourself.`;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export async function sendMessage(
  account: Account,
  conversationId: string,
  profile: CareProfile,
  member: CareCircleMember | undefined,
  messages: ChatMessage[],
  newUserMessage: string
): Promise<{ reply: string; tokensUsed: number }> {
  ensureConfigured();
  await checkTokenBudget(account);

  const systemPrompt = buildSystemPrompt(profile, member);
  const turns = [
    ...messages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: newUserMessage },
  ];

  const { text: reply, tokensUsed } = await complete(systemPrompt, turns, 1024, 'chat');

  await recordTokenUsage(account.id, conversationId, tokensUsed);

  return { reply, tokensUsed };
}

export interface MediationInput {
  questionTitle: string;
  questionBody: string | null;
  responses: Array<{ author: string; body: string }>;
}

/**
 * Produce a neutral mediation summary for a disputed family question:
 * common ground, each position restated fairly, options, and a suggested
 * next step. Uses the provider's more capable model tier — getting the
 * tone of a family dispute wrong is worse than a slow answer.
 */
export async function mediateQuestion(
  account: Account,
  profile: CareProfile,
  input: MediationInput
): Promise<{ summary: string; tokensUsed: number }> {
  ensureConfigured();
  await checkTokenBudget(account);

  const firstName = profile.preferred_name ?? profile.full_name.split(' ')[0];
  const system = `You are a neutral family mediator inside PareCare, a platform where families coordinate the care of an ageing parent. Family members have raised a question they disagree on. Your job is to lower the temperature and move them towards a decision — never to pick a winner.

Rules:
- Be warm but plain-spoken. No therapy-speak, no jargon.
- Restate each person's position fairly and charitably, by name, even positions expressed badly.
- Name what everyone already agrees on — there is almost always something, starting with ${firstName}'s wellbeing.
- Where a factual claim is disputed, do not adjudicate it. Suggest how the family could verify it (GP opinion, an assessment, a document, asking ${firstName} directly if appropriate).
- Offer 2–3 concrete options the family could choose between, with the trade-off of each in one sentence.
- End with one small, specific suggested next step.
- Never use em dashes.
- Keep the whole response under 350 words. Use short headed sections: "Common ground", "The different views", "Options", "Suggested next step".`;

  const discussion =
    input.responses.length > 0
      ? input.responses.map((r) => `${r.author}: ${r.body}`).join('\n\n')
      : '(No discussion responses yet; mediate based on the question itself.)';

  const userContent = `The family caring for ${firstName} (care phase: ${profile.current_phase.replace(/_/g, ' ')}) has an open question:

Question: ${input.questionTitle}
${input.questionBody ? `Context: ${input.questionBody}` : ''}

Discussion so far:
${discussion}`;

  const { text: summary, tokensUsed } = await complete(
    system,
    [{ role: 'user', content: userContent }],
    1024,
    'mediation'
  );
  await recordTokenUsage(account.id, null, tokensUsed);

  return { summary, tokensUsed };
}
