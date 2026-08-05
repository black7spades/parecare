import { getAiConfig } from '../config/settings';
import { ollamaRoot } from './aiProvider';

/**
 * Managing the assistant that runs on this machine, so a super admin can see
 * what model is in use and change it by pointing at a model and downloading it,
 * without touching compose or the environment. This talks to Ollama's own
 * endpoints (under the base URL with /v1 removed), not the OpenAI-compatible
 * ones, because listing and downloading models are Ollama features.
 */

export interface InstalledModel {
  /** The tag as Ollama stores it, e.g. "gemma4:12b-it-q4_K_M". */
  name: string;
  /** Size on disk in bytes, when reported. */
  size: number | null;
  /** Human details when Ollama reports them. */
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
}

export interface PullState {
  /** The model being downloaded, or null when nothing is in progress. */
  model: string | null;
  status: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
  /** When the last pull finished, so a stale success can be cleared. */
  finishedAt: number | null;
}

let pull: PullState = { model: null, status: '', completed: 0, total: 0, done: true, error: null, finishedAt: null };

export function getPullState(): PullState {
  return pull;
}

/**
 * Turn what a person pasted into a reference Ollama can download. A Hugging
 * Face link becomes the hf.co form Ollama understands; a plain model tag is
 * left as it is. Anything with characters that do not belong in a model
 * reference is rejected, so nothing odd reaches the server.
 */
export function normalizeModelRef(input: string): string {
  let ref = input.trim();
  // A Hugging Face URL in any of its usual shapes becomes hf.co/<owner>/<repo>.
  ref = ref.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  ref = ref.replace(/^huggingface\.co\//i, 'hf.co/');
  // Drop a trailing slash or a /tree/... or /blob/... path a browser copy adds.
  ref = ref.replace(/\/(tree|blob|resolve)\/.*$/i, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(ref) || ref.length > 200) {
    throw Object.assign(new Error('That does not look like a model name or a Hugging Face link.'), {
      status: 400,
      code: 'BAD_MODEL_REF',
    });
  }
  return ref;
}

/** Whether the current provider is the bundled on-machine assistant we can manage. */
function managingLocalModels(): boolean {
  return getAiConfig().provider === 'ollama';
}

/** Whether an installed tag is the one named by `want` (exact, :latest, or base). */
export function matchesModel(name: string, want: string): boolean {
  if (!want) return false;
  return name === want || name === `${want}:latest` || name.split(':')[0] === want.split(':')[0];
}

/**
 * The models already downloaded on this machine, newest first. Never throws: an
 * unreachable server (still starting on first run) reads as no models yet, so
 * the caller can show the warming state rather than an error.
 */
export async function listInstalledModels(): Promise<InstalledModel[]> {
  if (!managingLocalModels()) return [];
  try {
    const res = await fetch(`${ollamaRoot()}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{
        name?: string;
        size?: number;
        details?: { family?: string; parameter_size?: string; quantization_level?: string };
      }>;
    };
    return (data.models ?? []).map((m) => ({
      name: m.name ?? '',
      size: typeof m.size === 'number' ? m.size : null,
      family: m.details?.family ?? null,
      parameterSize: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Start downloading a model, reporting progress as it goes. Only one download
 * runs at a time. The request to Ollama streams progress lines, which are read
 * and folded into a single state the settings screen polls.
 */
export function startPull(model: string): PullState {
  if (!managingLocalModels()) {
    throw Object.assign(new Error('Downloading a model is only for the assistant that runs on this machine.'), {
      status: 400,
      code: 'NOT_LOCAL',
    });
  }
  if (pull.model && !pull.done) {
    throw Object.assign(new Error(`A download is already in progress (${pull.model}). Wait for it to finish.`), {
      status: 409,
      code: 'PULL_IN_PROGRESS',
    });
  }
  pull = { model, status: 'starting', completed: 0, total: 0, done: false, error: null, finishedAt: null };
  void runPull(model);
  return pull;
}

async function runPull(model: string): Promise<void> {
  try {
    const res = await fetch(`${ollamaRoot()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(body.slice(0, 200) || `The assistant service answered ${res.status}.`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Ollama streams one JSON object per line.
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        applyPullLine(model, line);
      }
    }
    if (pull.model === model && !pull.error) {
      pull = { ...pull, status: 'success', done: true, finishedAt: Date.now(), completed: pull.total || pull.completed };
    }
  } catch (err) {
    if (pull.model === model) {
      pull = { ...pull, status: 'error', done: true, error: (err as Error).message, finishedAt: Date.now() };
    }
  }
}

function applyPullLine(model: string, line: string): void {
  if (pull.model !== model) return;
  try {
    const msg = JSON.parse(line) as { status?: string; error?: string; total?: number; completed?: number };
    if (msg.error) {
      pull = { ...pull, status: 'error', done: true, error: msg.error, finishedAt: Date.now() };
      return;
    }
    pull = {
      ...pull,
      status: msg.status ?? pull.status,
      total: typeof msg.total === 'number' ? msg.total : pull.total,
      completed: typeof msg.completed === 'number' ? msg.completed : pull.completed,
    };
  } catch {
    // A partial or non-JSON line: ignore and wait for the next one.
  }
}
