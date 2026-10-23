/** Enforces actual streamed bytes, not only Content-Length, before multipart parsing. */
export async function limitedFormData(request: Request, limit: number): Promise<FormData> {
  const claimed = Number(request.headers.get("content-length") || 0);
  if (claimed > limit) throw new Error("Choose a smaller upload; the request exceeds the server limit.");
  if (!request.body) throw new Error("Choose a non-empty upload.");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new Error("Choose a smaller upload; the request exceeds the server limit.");
      parts.push(result.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new Response(bytes, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
}
