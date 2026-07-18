import { useAuthStore } from '../stores/auth';
import { useSubscriptionStore } from '../stores/subscription';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly feature?: string
  ) {
    super(message);
  }
}

interface ApiBody {
  error?: string;
  code?: string;
  feature?: string;
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

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
    throw new ApiError(res.status, data.code ?? 'ERROR', data.error ?? 'Request failed', data.feature);
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
    throw new ApiError(res.status, data.code ?? 'ERROR', data.error ?? 'Upload failed');
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
  get: <T>(path: string) => request<T>(path),
  upload: <T>(path: string, formData: FormData) => uploadRequest<T>(path, formData),
  blob: (path: string) => blobRequest(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
