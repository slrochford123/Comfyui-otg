import { RequestError } from "@/lib/requestError";

/** Enforces actual streamed bytes, not only a client-supplied Content-Length. */
export async function limitedBytes(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const claimed = Number(request.headers.get("content-length") || 0);
  if (claimed > limit) throw new RequestError("Choose a smaller upload; the request exceeds the server limit.", 413);
  if (!request.body) throw new RequestError("Choose a non-empty upload.", 400);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new RequestError("Choose a smaller upload; the request exceeds the server limit.", 413);
      parts.push(result.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

export async function limitedFormData(request: Request, limit: number): Promise<FormData> {
  const bytes = await limitedBytes(request, limit);
  try { return await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
  catch { throw new RequestError("Invalid upload form.", 400); }
}

export async function limitedJson(request: Request, limit = 1024 * 1024): Promise<Record<string, unknown>> {
  const bytes = await limitedBytes(request, limit);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new RequestError("A valid JSON object is required.", 400); }
}
