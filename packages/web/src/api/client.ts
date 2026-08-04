import { useAuthStore } from '../stores/auth';
import { useSubscriptionStore } from '../stores/subscription';

const BASE = '/api/v1';

/**
 * A deadline for a Pare request. A reply from a model on this machine can take
 * a couple of minutes; this is longer than the slowest honest reply but short
 * enough that a request which is never coming back says so instead of spinning
 * forever.
 */
export const AI_REQUEST_TIMEOUT_MS = 300_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly feature?: string,
    /** The full parsed error body, for endpoints that return extra fields. */
    public readonly data?: Record<string, unknown>
  ) {
    super(message);
  }
}

interface ApiBody {
  error?: string;
  code?: string;
  feature?: string;
  [key: string]: unknown;
}

/**
 * Read a response as JSON without ever throwing a raw "Unexpected token '<'"
 * when the body is not JSON. A non-JSON body means the request did not reach
 * the API and was answered by something else (a reverse proxy's error page,
 * a gateway timeout, or the single-page-app fallback serving index.html). We
 * surface that as a clear, actionable ApiError instead of a parse crash.
 */
async function readJson(res: Response, path: string): Promise<ApiBody> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as ApiBody;
  } catch {
    console.error(`Non-JSON response from ${path} (HTTP ${res.status}):`, text.slice(0, 300));
    throw new ApiError(
      res.status || 502,
      'BAD_GATEWAY',
      'The server could not be reached just now, or returned an unexpected response. Please try again in a moment.'
    );
  }
}

interface RequestOptions {
  /** Abort the request after this many milliseconds and report a clear timeout. */
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestInit = {}, reqOpts: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().token;

  const controller = reqOpts.timeoutMs ? new AbortController() : undefined;
  const timer = controller ? window.setTimeout(() => controller.abort(), reqOpts.timeoutMs) : undefined;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller?.signal ?? options.signal ?? undefined,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch (err) {
    if (controller?.signal.aborted) {
      throw new ApiError(
        504,
        'AI_TIMEOUT',
        'Pare is taking longer than usual to answer. It may still be working; wait a moment and try again.'
      );
    }
    throw err;
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }

  const data = await readJson(res, path);

  if (!res.ok) {
    if (res.status === 401) {
      useAuthStore.getState().clearAuth();
    }
    if (res.status === 402) {
      useSubscriptionStore
        .getState()
        .showUpgradePrompt(data.feature, data.error);
    }
    throw new ApiError(res.status, data.code ?? 'ERROR', data.error ?? 'Request failed', data.feature, data);
  }

  return data as T;
}

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const data = await readJson(res, path);
  if (!res.ok) {
    if (res.status === 401) useAuthStore.getState().clearAuth();
    throw new ApiError(res.status, data.code ?? 'ERROR', data.error ?? 'Upload failed', data.feature, data);
  }
  return data as T;
}

async function blobRequest(path: string): Promise<Blob> {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Download failed');
  return res.blob();
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, {}, opts),
  upload: <T>(path: string, formData: FormData) => uploadRequest<T>(path, formData),
  blob: (path: string) => blobRequest(path),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }, opts),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
