import Anthropic from '@anthropic-ai/sdk';
import { getAiConfig, type AiProvider } from '../config/settings';
import { beginCall } from './aiMetrics';

/**
 * Provider-agnostic chat completion. Three wire protocols cover every
 * popular option:
 *  - anthropic: the Claude API (default; uses ANTHROPIC_API_KEY or AI_API_KEY)
 *  - openai-compatible: OpenAI itself plus any server speaking its API,
 *    including Ollama and LM Studio running on your own hardware
 *  - google: the Gemini API
 *
 * A second service can stand behind the main one as a fallback. While the main
 * service is not answering, every request goes to the fallback instead, and
 * Pare moves back by itself as soon as the main one answers again. Nobody
 * using PareCare has to notice or do anything.
 */

/**
 * A turn's content. Plain text stays a string, so nothing that already speaks
 * to the model has to change. A turn can also carry parts: text alongside an
 * image (a photographed receipt, a scanned letter), read natively by a
 * vision-capable model. Audio is carried the same way for a model that hears.
 */
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'image'; media_type: string; data: string }
  | { type: 'audio'; media_type: string; data: string }
  // A whole PDF, read page by page, scanned pages included. Only Claude reads
  // these; check readsScannedDocuments() before sending one.
  | { type: 'document'; media_type: 'application/pdf'; data: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string | ChatPart[];
}

/** A turn's content as parts, wrapping a bare string as one text part. */
function asParts(content: string | ChatPart[]): ChatPart[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

/** How much text a turn carries, for the token estimate when usage is absent. */
function textLength(content: string | ChatPart[]): number {
  return typeof content === 'string'
    ? content.length
    : content.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 0), 0);
}

/** A data URI for an image or audio part, as the OpenAI vision format expects. */
const dataUri = (p: { media_type: string; data: string }): string => `data:${p.media_type};base64,${p.data}`;

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

// Bare aliases, never dated snapshots: an alias always resolves to the current
// build of that model, so a retired snapshot can never quietly break Pare.
const DEFAULT_MODELS: Record<string, Record<Tier, string>> = {
  anthropic: { chat: 'claude-haiku-4-5', mediation: 'claude-sonnet-5' },
  openai: { chat: 'gpt-4o-mini', mediation: 'gpt-4o' },
  google: { chat: 'gemini-2.0-flash', mediation: 'gemini-2.0-flash' },
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://host.docker.internal:11434/v1',
  lmstudio: 'http://host.docker.internal:1234/v1',
};

/**
 * How long the main service is given to answer when a fallback stands behind
 * it. A model on this machine can take a couple of minutes to reply; the app
 * gives up after five, so this leaves the fallback room to answer in time.
 */
const MAIN_DEADLINE_LOCAL_MS = 150_000;
const MAIN_DEADLINE_CLOUD_MS = 90_000;

function notConfigured(detail: string): Error {
  return Object.assign(new Error(`AI assistant is not configured: ${detail}`), {
    status: 503,
    code: 'AI_NOT_CONFIGURED',
  });
}

/**
 * One AI service Pare can talk to: the main one from the settings, or the
 * fallback it moves to while the main one is not answering. Every wire call
 * takes one of these, so the same code serves both.
 */
interface AiTarget {
  role: 'main' | 'fallback';
  provider: AiProvider;
  model?: string;
  mediationModel?: string;
  baseUrl?: string;
  apiKey?: string;
}

function mainTarget(): AiTarget {
  const cfg = getAiConfig();
  return {
    role: 'main',
    provider: cfg.provider,
    model: cfg.model,
    mediationModel: cfg.mediationModel,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.provider === 'anthropic' ? cfg.anthropicApiKey ?? cfg.apiKey : cfg.apiKey,
  };
}

/** The fallback service chosen in the settings, whether or not it is finished. */
function chosenFallback(): AiTarget | null {
  const cfg = getAiConfig();
  const provider = cfg.fallbackProvider;
  if (!provider || provider === 'off') return null;
  return {
    role: 'fallback',
    provider,
    model: cfg.fallbackModel,
    baseUrl: cfg.fallbackBaseUrl,
    // A Claude fallback reuses the Anthropic key already entered for the main
    // service, so choosing it needs nothing more.
    apiKey: cfg.fallbackApiKey ?? (provider === 'anthropic' ? cfg.anthropicApiKey : undefined),
  };
}

/**
 * The settings a chosen fallback still needs before it can answer, named as
 * the settings screen names them, so the screen can say exactly what is left.
 */
function fallbackMissing(t: AiTarget): string[] {
  const missing: string[] = [];
  const cloud = t.provider === 'anthropic' || t.provider === 'openai' || t.provider === 'google';
  if (cloud && !t.apiKey) missing.push('Fallback service key');
  if (!cloud && !t.model) missing.push('Fallback service model');
  // Ollama and LM Studio have a usual address; any other server needs one.
  if (t.provider === 'openai-compatible' && !t.baseUrl) missing.push('Fallback service base URL');
  return missing;
}

/** The fallback service, or null when none is chosen or it is missing what it needs. */
function fallbackTarget(): AiTarget | null {
  const t = chosenFallback();
  return t && fallbackMissing(t).length === 0 ? t : null;
}

const isLocal = (p: AiProvider): boolean => p === 'ollama' || p === 'lmstudio' || p === 'openai-compatible';

function targetConfigured(t: AiTarget): boolean {
  switch (t.provider) {
    case 'anthropic':
    case 'openai':
    case 'google':
      return !!t.apiKey;
    default:
      // Local/self-hosted servers need a model name; a key is optional
      return !!t.model;
  }
}

function pickModel(t: AiTarget, tier: Tier): string {
  const defaults = DEFAULT_MODELS[t.provider];
  if (tier === 'mediation') {
    // The heavy tier prefers an explicit mediation model, then the provider's
    // best default, and only then the single configured model. Without this
    // order a configured chat model won over the mediation default, so setting
    // one model silently collapsed both tiers onto it and the hard jobs quietly
    // ran on the quick model.
    if (t.mediationModel) return t.mediationModel;
    if (defaults) return defaults.mediation;
    if (t.model) return t.model;
  } else {
    // The quick tier is the configured model, else the provider's chat default.
    if (t.model) return t.model;
    if (defaults) return defaults.chat;
  }
  throw notConfigured(`set a model for the '${t.provider}' provider (e.g. the model name loaded in Ollama or LM Studio).`);
}

// --- Moving to the fallback and back -----------------------------------------
//
// When the main service fails a request, the same request is answered by the
// fallback, and the main service is marked as not answering. From then on new
// requests go straight to the fallback, so nobody waits on a service that is
// down, while a quiet check in the background asks the main service every
// 30 seconds whether it is back. The first good answer moves Pare home.

const PROBE_EVERY_MS = 30_000;
let mainDownSince: number | null = null;
let probeTimer: ReturnType<typeof setInterval> | null = null;
let probing = false;

function markMainDown(err: unknown): void {
  if (mainDownSince !== null) return;
  mainDownSince = Date.now();
  const why = err instanceof Error ? err.message : String(err);
  console.warn(`[ai] main service is not answering, using the fallback until it does: ${why.slice(0, 200)}`);
  if (!probeTimer) {
    probeTimer = setInterval(() => void probeMain(), PROBE_EVERY_MS);
    probeTimer.unref?.();
  }
}

function markMainUp(): void {
  if (mainDownSince !== null) console.info('[ai] main service is answering again; moved back from the fallback');
  mainDownSince = null;
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

/**
 * Whether a service is answering, asked as cheaply as it allows. A server on
 * this machine is asked for its model list, which costs nothing; a cloud
 * service is asked for a one-word reply.
 */
async function targetAnswers(t: AiTarget): Promise<boolean> {
  if (!targetConfigured(t)) return false;
  try {
    if (t.provider === 'ollama') {
      const res = await fetch(`${ollamaRootOf(t)}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return false;
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const want = t.model ?? 'parecare';
      return (data.models ?? []).some((m) => modelNameMatches(m.name ?? '', want));
    }
    if (isLocal(t.provider)) {
      const base = (t.baseUrl ?? DEFAULT_BASE_URLS[t.provider] ?? '').replace(/\/$/, '');
      const res = await fetch(`${base}/models`, {
        headers: t.apiKey ? { Authorization: `Bearer ${t.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    }
    await completeWith(t, 'Reply with the single word ok.', [{ role: 'user', content: 'ok?' }], 4, 'chat', undefined, 20_000);
    return true;
  } catch {
    return false;
  }
}

async function probeMain(): Promise<void> {
  if (probing || mainDownSince === null) return;
  probing = true;
  try {
    // With no fallback any more, there is nothing to move back from.
    if (!fallbackTarget() || (await targetAnswers(mainTarget()))) markMainUp();
  } finally {
    probing = false;
  }
}

/**
 * Whether a failure means the service is not answering at all, rather than
 * that this one request was unsuitable. A refused connection, a timeout, an
 * overloaded or failing server, a rejected key or a model still downloading
 * all mean the service is down for now. A request it could not accept (too
 * long, malformed) is still tried on the fallback, but does not move Pare.
 */
function isOutage(err: unknown): boolean {
  const e = err as { code?: string; providerStatus?: number; status?: number } | null;
  if (e?.code === 'AI_MODEL_PREPARING') return true;
  // Our own provider errors carry the provider's status; the Claude library's
  // errors carry it as status.
  const status = e?.providerStatus ?? (e?.code === undefined ? e?.status : undefined);
  return !(status === 400 || status === 413 || status === 422);
}

/** Whether a request carries a whole PDF, which only Claude reads. */
const carriesDocument = (turns: ChatTurn[]): boolean =>
  turns.some((t) => typeof t.content !== 'string' && t.content.some((p) => p.type === 'document'));

/** Whether Pare is answering from the fallback right now. */
export function onFallback(): boolean {
  if (!fallbackTarget()) return false;
  return mainDownSince !== null || !targetConfigured(mainTarget());
}

/** The service answering right now: the fallback while it is in use, otherwise the main one. */
function activeTarget(): AiTarget {
  const b = fallbackTarget();
  return b && onFallback() ? b : mainTarget();
}

export interface FallbackStatus {
  /** The fallback service chosen, or null when it is off. */
  provider: string | null;
  model: string | null;
  /** Whether the chosen fallback has everything it needs to answer. */
  ready: boolean;
  /** The settings it still needs, by their names on the settings screen. */
  missing: string[];
  /** Whether the fallback runs on this machine. */
  local: boolean;
  /** Whether Pare is answering from the fallback right now. */
  in_use: boolean;
  /** When the main service stopped answering, while the fallback is in use. */
  since: string | null;
}

/** The fallback as the screens describe it, and whether it is in use. */
export function fallbackStatus(): FallbackStatus {
  const b = chosenFallback();
  const missing = b ? fallbackMissing(b) : [];
  const inUse = onFallback();
  return {
    provider: b?.provider ?? null,
    model: b?.model ?? null,
    ready: !!b && missing.length === 0,
    missing,
    local: b ? isLocal(b.provider) : false,
    in_use: inUse,
    since: inUse && mainDownSince !== null ? new Date(mainDownSince).toISOString() : null,
  };
}

export function isAiConfigured(): boolean {
  return targetConfigured(mainTarget()) || !!fallbackTarget();
}

/**
 * Whether the service answering now can be handed a schema and made to obey
 * it. Anthropic does it through a forced tool; the OpenAI-compatible servers
 * (including Ollama and LM Studio) do it through the response format. Google's
 * path is left on today's tolerant text parsing, so it never regresses.
 */
export function supportsStructuredOutput(): boolean {
  return activeTarget().provider !== 'google';
}

/**
 * Whether the AI service answering now can read a scanned PDF itself. Claude
 * reads every page of a PDF, scanned or not; the other services need the
 * pages as photos.
 */
export function readsScannedDocuments(): boolean {
  return activeTarget().provider === 'anthropic';
}

/** Whether the main service runs on this machine (a local server) rather than in the cloud. */
export function isLocalProvider(): boolean {
  return isLocal(getAiConfig().provider);
}

/** The native Ollama root for a target: its base URL with the trailing /v1 dropped. */
function ollamaRootOf(t: AiTarget): string {
  const base = (t.baseUrl ?? DEFAULT_BASE_URLS['ollama'] ?? '').replace(/\/$/, '');
  return base.replace(/\/v1$/, '');
}

/**
 * The native (non-OpenAI) root of the local Ollama server, derived from the
 * configured base URL by dropping the trailing /v1. Ollama's own endpoints for
 * listing and downloading models live under here, not under /v1.
 */
export function ollamaRoot(): string {
  return ollamaRootOf(mainTarget());
}

function modelNameMatches(name: string, want: string): boolean {
  return name === want || name === `${want}:latest` || name.split(':')[0] === want.split(':')[0];
}

/**
 * Whether the main service is ready to answer, for the warming state. A cloud
 * provider is ready as soon as it is configured. The bundled on-machine
 * assistant is asked directly whether its model has finished downloading:
 * present means ready, absent or still starting means preparing.
 */
export async function mainModelState(): Promise<'ready' | 'preparing' | 'unavailable'> {
  const t = mainTarget();
  if (t.provider !== 'ollama') {
    return targetConfigured(t) ? 'ready' : 'unavailable';
  }
  const want = t.model ?? 'parecare';
  try {
    const res = await fetch(`${ollamaRootOf(t)}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return 'preparing';
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const present = (data.models ?? []).some((m) => modelNameMatches(m.name ?? '', want));
    return present ? 'ready' : 'preparing';
  } catch {
    // Unreachable usually means the service is still starting on first run.
    return 'preparing';
  }
}

/**
 * Whether Pare can answer at all. While the main service is still getting
 * ready or is not answering, a fallback answers instead, so Pare is ready.
 */
export async function localModelState(): Promise<'ready' | 'preparing' | 'unavailable'> {
  const state = await mainModelState();
  if (state !== 'ready' && fallbackTarget()) {
    // The model on this machine is still downloading or not answering: the
    // fallback covers it, and the background check moves Pare home once ready.
    if (targetConfigured(mainTarget())) markMainDown(new Error(`main service is ${state}`));
    return 'ready';
  }
  return state;
}

/** A deadline signal for a fetch, or nothing when there is no deadline. */
const deadline = (ms?: number): { signal?: AbortSignal } => (ms ? { signal: AbortSignal.timeout(ms) } : {});

function providerError(status: number, body: string): Error {
  return Object.assign(new Error(`AI provider returned ${status}: ${body.slice(0, 200)}`), {
    status: 502,
    code: 'AI_PROVIDER_ERROR',
    providerStatus: status,
  });
}

async function completeAnthropic(
  t: AiTarget,
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  opts?: CompleteOptions,
  timeoutMs?: number,
): Promise<CompletionResult> {
  if (!t.apiKey) throw notConfigured('set the Anthropic API key in the settings screen.');
  // With a fallback standing by, a struggling Claude is given less time and
  // fewer retries, so the fallback still answers before the app gives up.
  const client = new Anthropic({ apiKey: t.apiKey, ...(timeoutMs ? { timeout: timeoutMs, maxRetries: 1 } : {}) });
  const toAnthropicBlock = (p: ChatPart): unknown => {
    if (p.type === 'image') return { type: 'image', source: { type: 'base64', media_type: p.media_type, data: p.data } };
    if (p.type === 'document') return { type: 'document', source: { type: 'base64', media_type: p.media_type, data: p.data } };
    // Claude has no audio input; keep the turn valid with a short note.
    if (p.type === 'audio') return { type: 'text', text: '[a voice note was attached]' };
    return { type: 'text', text: p.text };
  };
  const messages: Anthropic.MessageParam[] = turns.map((turn) => ({
    role: turn.role,
    content: (typeof turn.content === 'string' ? turn.content : turn.content.map(toAnthropicBlock)) as Anthropic.MessageParam['content'],
  }));

  // Constrained output on Claude is a forced tool: the schema becomes the
  // tool's input, and requiring that tool guarantees the reply fits it.
  if (opts?.schema) {
    const response = await client.messages.create({
      model: pickModel(t, tier),
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
    model: pickModel(t, tier),
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
  t: AiTarget,
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  opts?: CompleteOptions,
  timeoutMs?: number,
): Promise<CompletionResult> {
  if (t.provider === 'openai' && !t.apiKey) {
    throw notConfigured('set the OpenAI API key in the settings screen.');
  }
  const baseUrl = (t.baseUrl ?? DEFAULT_BASE_URLS[t.provider] ?? '').replace(/\/$/, '');
  if (!baseUrl) throw notConfigured("set the base URL to your server's OpenAI-compatible endpoint (ending in /v1).");
  const model = pickModel(t, tier);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(t.apiKey ? { Authorization: `Bearer ${t.apiKey}` } : {}),
    },
    ...deadline(timeoutMs),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        ...turns.map((turn) => ({
          role: turn.role,
          content:
            typeof turn.content === 'string'
              ? turn.content
              : turn.content.map((p) => {
                  if (p.type === 'image') return { type: 'image_url', image_url: { url: dataUri(p) } };
                  // Not read here; the document reader never sends one to this service.
                  if (p.type === 'document') return { type: 'text', text: '[a PDF document was attached]' };
                  if (p.type === 'audio') {
                    return { type: 'input_audio', input_audio: { data: p.data, format: p.media_type.split('/')[1] || 'wav' } };
                  }
                  return { type: 'text', text: p.text };
                }),
        })),
      ],
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
    // On a local server, a missing model is the download not being finished
    // yet, not a real fault. Give it a code the app can turn into "Pare is
    // still getting ready" instead of a raw provider error.
    if (isLocal(t.provider) && (res.status === 404 || /not found|no such model|try pulling|do not have/i.test(body))) {
      throw Object.assign(new Error('The assistant on this machine is still getting ready.'), {
        status: 503,
        code: 'AI_MODEL_PREPARING',
      });
    }
    throw providerError(res.status, body);
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
    reported || Math.ceil((system.length + turns.reduce((n, turn) => n + textLength(turn.content), 0) + text.length) / 4);
  return { text, tokensUsed, structured };
}

async function completeGoogle(
  t: AiTarget,
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  opts?: CompleteOptions,
  timeoutMs?: number,
): Promise<CompletionResult> {
  if (!t.apiKey) throw notConfigured('set the Google AI Studio API key in the settings screen.');
  const model = pickModel(t, tier);
  const baseUrl = (t.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

  const res = await fetch(`${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(t.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...deadline(timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((turn) => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: asParts(turn.content).map((p) =>
          p.type === 'text'
            ? { text: p.text }
            : p.type === 'document'
              ? { text: '[a PDF document was attached]' }
              : { inlineData: { mimeType: p.media_type, data: p.data } }
        ),
      })),
      // A schema only arrives here when Gemini is standing in as the fallback
      // for a service that honours one. Asking for JSON keeps that reply in
      // the shape the caller is waiting for.
      generationConfig: { maxOutputTokens: maxTokens, ...(opts?.schema ? { responseMimeType: 'application/json' } : {}) },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw providerError(res.status, body);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { totalTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let structured: unknown;
  if (opts?.schema && text) {
    try {
      structured = JSON.parse(text);
    } catch {
      structured = undefined;
    }
  }
  return { text, tokensUsed: data.usageMetadata?.totalTokenCount ?? Math.ceil(text.length / 4), structured };
}

/** One request to one service, with no moving to the fallback. */
function completeWith(
  t: AiTarget,
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  opts?: CompleteOptions,
  timeoutMs?: number,
): Promise<CompletionResult> {
  switch (t.provider) {
    case 'anthropic':
      return completeAnthropic(t, system, turns, maxTokens, tier, opts, timeoutMs);
    case 'google':
      return completeGoogle(t, system, turns, maxTokens, tier, opts, timeoutMs);
    default:
      return completeOpenAiCompatible(t, system, turns, maxTokens, tier, opts, timeoutMs);
  }
}

const mainDeadline = (t: AiTarget): number => (isLocal(t.provider) ? MAIN_DEADLINE_LOCAL_MS : MAIN_DEADLINE_CLOUD_MS);

/**
 * One request, answered by the main service when it is answering and by the
 * fallback when it is not. A request the main service fails is answered by the
 * fallback straight away, so the person asking only ever sees the answer.
 */
async function completeWithFallback(
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  opts?: CompleteOptions,
): Promise<CompletionResult> {
  const main = mainTarget();
  const b = fallbackTarget();
  // A whole PDF can only go to Claude; any other fallback is no help for it.
  const fallback = b && (!carriesDocument(turns) || b.provider === 'anthropic') ? b : null;

  if (!fallback) return completeWith(main, system, turns, maxTokens, tier, opts);
  if (!targetConfigured(main)) return completeWith(fallback, system, turns, maxTokens, tier, opts);

  if (mainDownSince !== null) {
    // Known to be down: go straight to the fallback. If the fallback fails too,
    // give the main service one more chance before saying it did not work.
    try {
      return await completeWith(fallback, system, turns, maxTokens, tier, opts);
    } catch (fallbackErr) {
      try {
        const result = await completeWith(main, system, turns, maxTokens, tier, opts, mainDeadline(main));
        markMainUp();
        return result;
      } catch (mainErr) {
        console.warn('[ai] the fallback service failed too:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
        throw mainErr;
      }
    }
  }

  try {
    return await completeWith(main, system, turns, maxTokens, tier, opts, mainDeadline(main));
  } catch (mainErr) {
    if (isOutage(mainErr)) markMainDown(mainErr);
    try {
      return await completeWith(fallback, system, turns, maxTokens, tier, opts);
    } catch (fallbackErr) {
      console.warn('[ai] the fallback service failed too:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      throw mainErr;
    }
  }
}

export async function complete(
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
  tier: Tier,
  opts?: CompleteOptions,
): Promise<CompletionResult> {
  // Time every model call in one place, so the traffic light and the
  // monitoring panel see all of Pare's work.
  const done = beginCall();
  try {
    const result = await completeWithFallback(system, turns, maxTokens, tier, opts);
    done(true);
    return result;
  } catch (err) {
    done(false);
    throw err;
  }
}

/**
 * A failed test in words whoever runs PareCare can act on. Nothing listening
 * and no reply in time are the common ones, and the raw network message for
 * them means nothing to most people.
 */
function plainFailure(err: unknown): string {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string } } | null;
  const msg = e?.message ?? '';
  if (e?.code === 'AI_MODEL_PREPARING') return 'its model is still downloading.';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timed? ?out/i.test(msg)) {
    return 'it did not reply in time. Check it is switched on and not overloaded.';
  }
  if (msg === 'fetch failed' || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connect/i.test(msg + (e?.cause?.code ?? ''))) {
    return 'nothing answered at its address. Check it is switched on and the address is right.';
  }
  return msg || 'it did not reply.';
}

export interface ServiceTest {
  ok: boolean;
  provider: string;
  sample?: string;
  error?: string;
}

/**
 * Ask the main service and the fallback each for a short reply, separately, so
 * the settings screen shows whether both work rather than hiding a broken one
 * behind the other. A main service that answers here moves Pare back to it.
 */
export async function testServices(): Promise<{ main: ServiceTest | null; fallback: ServiceTest | null }> {
  const ask = async (t: AiTarget): Promise<ServiceTest> => {
    try {
      const { text } = await completeWith(
        t,
        'You are a connection test. Reply with a single short sentence.',
        [{ role: 'user', content: 'Say hello so I know the connection works.' }],
        64,
        'chat',
        undefined,
        60_000,
      );
      return { ok: true, provider: t.provider, sample: text.slice(0, 200) };
    } catch (err) {
      return { ok: false, provider: t.provider, error: plainFailure(err) };
    }
  };
  const main = mainTarget();
  const fallback = fallbackTarget();
  const [mainResult, fallbackResult] = await Promise.all([
    targetConfigured(main) ? ask(main) : Promise.resolve(null),
    fallback ? ask(fallback) : Promise.resolve(null),
  ]);
  if (mainResult?.ok) markMainUp();
  return { main: mainResult, fallback: fallbackResult };
}
