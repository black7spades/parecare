import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

/**
 * Provider-agnostic chat completion. Three wire protocols cover every
 * popular option:
 *  - anthropic: the Claude API (default; uses ANTHROPIC_API_KEY or AI_API_KEY)
 *  - openai-compatible: OpenAI itself plus any server speaking its API,
 *    including Ollama and LM Studio running on your own hardware
 *  - google: the Gemini API
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  text: string;
  tokensUsed: number;
}

type Tier = 'chat' | 'mediation';

const DEFAULT_MODELS: Record<string, Record<Tier, string>> = {
  anthropic: { chat: 'claude-haiku-4-5-20251001', mediation: 'claude-sonnet-5' },
  openai: { chat: 'gpt-4o-mini', mediation: 'gpt-4o' },
  google: { chat: 'gemini-2.0-flash', mediation: 'gemini-2.0-flash' },
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://host.docker.internal:11434/v1',
  lmstudio: 'http://host.docker.internal:1234/v1',
};

function notConfigured(detail: string): Error {
  return Object.assign(new Error(`AI assistant is not configured: ${detail}`), {
    status: 503,
    code: 'AI_NOT_CONFIGURED',
  });
}

function pickModel(tier: Tier): string {
  if (tier === 'mediation' && env.AI_MEDIATION_MODEL) return env.AI_MEDIATION_MODEL;
  if (env.AI_MODEL) return env.AI_MODEL;
  const defaults = DEFAULT_MODELS[env.AI_PROVIDER];
  if (defaults) return defaults[tier];
  throw notConfigured(`set AI_MODEL for the '${env.AI_PROVIDER}' provider (e.g. the model name loaded in Ollama or LM Studio).`);
}

export function isAiConfigured(): boolean {
  switch (env.AI_PROVIDER) {
    case 'anthropic':
      return !!(env.ANTHROPIC_API_KEY ?? env.AI_API_KEY);
    case 'openai':
    case 'google':
      return !!env.AI_API_KEY;
    default:
      // Local/self-hosted servers need a model name; a key is optional
      return !!env.AI_MODEL;
  }
}

async function completeAnthropic(system: string, turns: ChatTurn[], maxTokens: number, tier: Tier): Promise<CompletionResult> {
  const apiKey = env.ANTHROPIC_API_KEY ?? env.AI_API_KEY;
  if (!apiKey) throw notConfigured('set ANTHROPIC_API_KEY (or AI_API_KEY) in your environment.');
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: pickModel(tier),
    max_tokens: maxTokens,
    system,
    messages: turns.map((t) => ({ role: t.role, content: t.content })),
  });
  return {
    text: response.content[0]?.type === 'text' ? response.content[0].text : '',
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

async function completeOpenAiCompatible(system: string, turns: ChatTurn[], maxTokens: number, tier: Tier): Promise<CompletionResult> {
  if (env.AI_PROVIDER === 'openai' && !env.AI_API_KEY) {
    throw notConfigured('set AI_API_KEY to your OpenAI API key.');
  }
  const baseUrl = (env.AI_BASE_URL ?? DEFAULT_BASE_URLS[env.AI_PROVIDER] ?? '').replace(/\/$/, '');
  if (!baseUrl) throw notConfigured("set AI_BASE_URL to your server's OpenAI-compatible endpoint (ending in /v1).");
  const model = pickModel(tier);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.AI_API_KEY ? { Authorization: `Bearer ${env.AI_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...turns],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`AI provider returned ${res.status}: ${body.slice(0, 200)}`), {
      status: 502,
      code: 'AI_PROVIDER_ERROR',
    });
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  const reported =
    data.usage?.total_tokens ?? (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
  // Some local servers omit usage; estimate so metering stays sane
  const tokensUsed =
    reported || Math.ceil((system.length + turns.reduce((n, t) => n + t.content.length, 0) + text.length) / 4);
  return { text, tokensUsed };
}

async function completeGoogle(system: string, turns: ChatTurn[], maxTokens: number, tier: Tier): Promise<CompletionResult> {
  if (!env.AI_API_KEY) throw notConfigured('set AI_API_KEY to your Google AI Studio API key.');
  const model = pickModel(tier);
  const baseUrl = (env.AI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

  const res = await fetch(`${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(env.AI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`AI provider returned ${res.status}: ${body.slice(0, 200)}`), {
      status: 502,
      code: 'AI_PROVIDER_ERROR',
    });
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { totalTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return { text, tokensUsed: data.usageMetadata?.totalTokenCount ?? Math.ceil(text.length / 4) };
}

export async function complete(system: string, turns: ChatTurn[], maxTokens: number, tier: Tier): Promise<CompletionResult> {
  switch (env.AI_PROVIDER) {
    case 'anthropic':
      return completeAnthropic(system, turns, maxTokens, tier);
    case 'google':
      return completeGoogle(system, turns, maxTokens, tier);
    default:
      return completeOpenAiCompatible(system, turns, maxTokens, tier);
  }
}
