import { NextResponse } from 'next/server';

export type JsonBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

export type RouteErrorOptions = {
  status?: number;
  code?: string;
  detail?: unknown;
  requestId?: string | null;
  headers?: HeadersInit;
};

export const noStoreHeaders: Record<string, string> = {
  'cache-control': 'no-store',
};

export function withNoStore(headers?: HeadersInit): Headers {
  const out = new Headers(headers || {});
  out.set('cache-control', 'no-store');
  return out;
}

export function requestIdFrom(req: Request): string {
  return (
    req.headers.get('x-request-id') ||
    req.headers.get('x-vercel-id') ||
    `req_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`
  );
}

export function jsonOk<T extends Record<string, unknown>>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, { ...init, headers: withNoStore(init?.headers) });
}

export function jsonError(error: string, opts: RouteErrorOptions = {}) {
  const status = opts.status || 500;
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(opts.code ? { code: opts.code } : {}),
      ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
      ...(opts.requestId ? { requestId: opts.requestId } : {}),
    },
    { status, headers: withNoStore(opts.headers) },
  );
}

export async function readJsonBody<T = unknown>(req: Request, opts: { maxBytes?: number } = {}): Promise<JsonBodyResult<T>> {
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const contentType = req.headers.get('content-type') || '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    return { ok: false, status: 415, error: 'Expected application/json request body.' };
  }

  const text = await req.text().catch(() => '');
  if (!text.trim()) return { ok: false, status: 400, error: 'Missing JSON request body.' };
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { ok: false, status: 413, error: 'JSON request body is too large.' };
  }

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON request body.' };
  }
}

export function sessionErrorResponse(error: unknown) {
  const name = (error as any)?.name || '';
  const status = Number((error as any)?.status || 0);
  if (name === 'SessionInvalidError' || status === 401) {
    return jsonError('Unauthorized', { status: 401, code: 'unauthorized' });
  }
  return null;
}

export async function routeHandler<T>(req: Request, fn: (requestId: string) => Promise<NextResponse<T> | Response>) {
  const requestId = requestIdFrom(req);
  try {
    return await fn(requestId);
  } catch (error: any) {
    const session = sessionErrorResponse(error);
    if (session) return session;
    return jsonError(error?.message || 'Route failed.', { status: 500, requestId });
  }
}
