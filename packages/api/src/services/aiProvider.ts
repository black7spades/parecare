import Anthropic from '@anthropic-ai/sdk';
import { getAiConfig } from '../config/settings';

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
  /**
   * The parsed structured object, present only when a schema was supplied and
   * the provider honoured it. The caller reads its actions straight from here
   * rather than parsing them back out of the prose.
   */
  structured?: unknown;
}

export interface CompleteOptions {
  /**
   * A JSON schema to constrain the reply to ("structured output"). When set,
   * and the provider supports it, the model cannot emit anything that does not
   * fit the schema, so an action can never come back malformed. `name` is a
   * short identifier some providers require for the schema.
   */
  schema?: { name: string; schema: Record<string, unknown> };
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
  const cfg = getAiConfig();
  const defaults = DEFAULT_MODELS[cfg.provider];
  if (tier === 'mediation') {
    // The heavy tier prefers an explicit mediation model, then the provider's
    // best default, and only then the single configured model. Without this
    // order a configured chat model won over the mediation default, so setting
    // one model silently collapsed both tiers onto it and the hard jobs quietly
    // ran on the quick model.
    if (cfg.mediationModel) return cfg.mediationModel;
    if (defaults) return defaults.mediation;
    if (cfg.model) return cfg.model;
  } else {
    // The quick tier is the configured model, else the provider's chat default.
    if (cfg.model) return cfg.model;
    if (defaults) return defaults.chat;
  }
  throw notConfigured(`set a model for the '${cfg.provider}' provider (e.g. the model name loaded in Ollama or LM Studio).`);
}

export function isAiConfigured(): boolean {
  const cfg = getAiConfig();
  switch (cfg.provider) {
    case 'anthropic':
      return !!(cfg.anthropicApiKey ?? cfg.apiKey);
    case 'openai':
    case 'google':
      return !!cfg.apiKey;
    default:
      // Local/self-hosted servers need a model name; a key is optional
      return !!cfg.model;
  }
}

/**
 * Whether the current provider can be handed a schema and made to obey it.
 * Anthropic does it through a forced tool; the OpenAI-compatible servers
 * (including Ollama and LM Studio) do it through the response format. Google's
 * path is left on today's tolerant text parsing, so it never regresses.
 */
export function supportsStructuredOutput(): boolean {
  return getAiConfig().provider !== 'google';
}

async function completeAnthropic(
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  opts?: CompleteOptions,
): Promise<CompletionResult> {
  const cfg = getAiConfig();
  const apiKey = cfg.anthropicApiKey ?? cfg.apiKey;
  if (!apiKey) throw notConfigured('set the Anthropic API key in the settings screen.');
  const client = new Anthropic({ apiKey });
  const messages = turns.map((t) => ({ role: t.role, content: t.content }));

  // Constrained output on Claude is a forced tool: the schema becomes the
  // tool's input, and requiring that tool guarantees the reply fits it.
  if (opts?.schema) {
    const response = await client.messages.create({
      model: pickModel(tier),
      max_tokens: maxTokens,
      system,
      messages,
      tools: [
        {
          name: opts.schema.name,
          description: 'Return your reply to the person and any actions to carry out.',
          input_schema: opts.schema.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: opts.schema.name },
    });
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    const structured = toolUse && toolUse.type === 'tool_use' ? toolUse.input : undefined;
    return {
      text: structured !== undefined ? JSON.stringify(structured) : '',
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      structured,
    };
  }

  const response = await client.messages.create({
    model: pickModel(tier),
    max_tokens: maxTokens,
    system,
    messages,
  });
  return {
    text: response.content[0]?.type === 'text' ? response.content[0].text : '',
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
}

async function completeOpenAiCompatible(
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  opts?: CompleteOptions,
): Promise<CompletionResult> {
  const cfg = getAiConfig();
  if (cfg.provider === 'openai' && !cfg.apiKey) {
    throw notConfigured('set the OpenAI API key in the settings screen.');
  }
  const baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URLS[cfg.provider] ?? '').replace(/\/$/, '');
  if (!baseUrl) throw notConfigured("set the base URL to your server's OpenAI-compatible endpoint (ending in /v1).");
  const model = pickModel(tier);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...turns],
      // A JSON schema in response_format makes Ollama and LM Studio mask any
      // token that would break the schema, and guides OpenAI's own models the
      // same way. Left off entirely when no schema is asked for.
      ...(opts?.schema
        ? { response_format: { type: 'json_schema', json_schema: { name: opts.schema.name, schema: opts.schema.schema, strict: false } } }
        : {}),
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
  // On the constrained path the content is the JSON object itself; parse it so
  // the caller reads actions straight from it. A parse failure leaves
  // structured undefined and the caller falls back to reading the prose.
  let structured: unknown;
  if (opts?.schema && text) {
    try {
      structured = JSON.parse(text);
    } catch {
      structured = undefined;
    }
  }
  const reported =
    data.usage?.total_tokens ?? (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
  // Some local servers omit usage; estimate so metering stays sane
  const tokensUsed =
    reported || Math.ceil((system.length + turns.reduce((n, t) => n + t.content.length, 0) + text.length) / 4);
  return { text, tokensUsed, structured };
}

async function completeGoogle(
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  _opts?: CompleteOptions,
): Promise<CompletionResult> {
  const cfg = getAiConfig();
  if (!cfg.apiKey) throw notConfigured('set the Google AI Studio API key in the settings screen.');
  const model = pickModel(tier);
  const baseUrl = (cfg.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

  const res = await fetch(`${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
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

export async function complete(
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  opts?: CompleteOptions,
): Promise<CompletionResult> {
  switch (getAiConfig().provider) {
    case 'anthropic':
      return completeAnthropic(system, turns, maxTokens, tier, opts);
    case 'google':
      return completeGoogle(system, turns, maxTokens, tier, opts);
    default:
      return completeOpenAiCompatible(system, turns, maxTokens, tier, opts);
  }
}
