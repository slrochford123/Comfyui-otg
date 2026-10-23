/** Bound streamed JSON before parsing; missing/forged Content-Length is not trusted. */
export async function readH3StudioJson(request: Request, limit = 24_000): Promise<Record<string, unknown>> {
  if (!request.body || Number(request.headers.get("content-length") || 0) > limit) throw Object.assign(new Error("Request too large or empty."), { status: 413 });
  const reader = request.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { request.signal.throwIfAborted(); const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > limit) throw Object.assign(new Error("Request too large."), { status: 413 }); parts.push(next.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected a request object.");
  return body;
}
