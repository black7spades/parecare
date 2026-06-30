import Anthropic from '@anthropic-ai/sdk';
import { db } from '../config/database';
import { env } from '../config/env';
import type { Account, CareProfile, CareCircleMember } from '../types';

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw Object.assign(
      new Error('AI assistant requires an Anthropic API key. Set ANTHROPIC_API_KEY in your environment.'),
      { status: 402, code: 'AI_NOT_CONFIGURED' }
    );
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
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
  conversationId: string,
  tokensUsed: number
): Promise<void> {
  await db.transaction(async (trx) => {
    await trx('accounts').where({ id: accountId }).increment('ai_tokens_used', tokensUsed);
    await trx('ai_conversations')
      .where({ id: conversationId })
      .update({ tokens_used: db.raw(`tokens_used + ${tokensUsed}`) });
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

Speak plainly. Never use medical abbreviations without explaining them. Never use legal jargon without defining it. When you don't know something specific to the person's situation, say so and suggest who to contact. Keep answers practical and focused on what the person can actually do next. Do not give formal legal or medical advice — frame guidance as information to take to the relevant professional.`;
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
  await checkTokenBudget(account);

  const client = getClient();
  const systemPrompt = buildSystemPrompt(profile, member);

  const apiMessages: Anthropic.MessageParam[] = [
    ...messages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: newUserMessage },
  ];

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages: apiMessages,
  });

  const reply =
    response.content[0]?.type === 'text' ? response.content[0].text : '';
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

  await recordTokenUsage(account.id, conversationId, tokensUsed);

  return { reply, tokensUsed };
}
