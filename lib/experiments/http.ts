import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_requireAdmin";
import { RequestError } from "@/lib/requestError";
import { requireTestLab } from "./store";

export const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
export function labRoute(handler: (request: NextRequest, owner: string) => Promise<Response>) {
  return async (request: NextRequest) => {
    try {
      requireTestLab();
      const auth = await requireAdmin();
      if (!auth.ok) throw new RequestError(auth.error, auth.status);
      if (!["GET", "HEAD"].includes(request.method)) {
        const origin = request.headers.get("origin"), host = request.headers.get("host");
        let allowed = false;
        try { allowed = !!origin && new URL(origin).host === host && ["https:", "http:"].includes(new URL(origin).protocol); } catch { /* reject malformed origin */ }
        if (!allowed || request.headers.get("sec-fetch-site") === "cross-site") throw new RequestError("Same-origin request required.", 403);
      }
      const response = await handler(request, auth.id);
      for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
      return response;
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof RequestError ? error.message : "Experimental workspace request failed. No production operation was attempted." }, { status: error instanceof RequestError ? error.status : 500, headers: privateHeaders });
    }
  };
}
export async function boundedJson(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body) throw new RequestError("JSON request required.", 400);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); throw new RequestError("Request too large.", 413); }
      chunks.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("shape");
    return data as Record<string, unknown>;
  } catch (error) { if (error instanceof RequestError) throw error; throw new RequestError("Invalid JSON request.", 400); }
  finally { reader.releaseLock(); }
}
