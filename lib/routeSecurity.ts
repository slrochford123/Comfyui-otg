import { NextRequest, NextResponse } from "next/server";
import { getOwnerContext, SessionInvalidError, type OwnerContext } from "@/lib/ownerKey";

import { RequestError } from "@/lib/requestError";
export { RequestError } from "@/lib/requestError";

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let host: string;
  try { host = new URL(origin).host; } catch { throw new RequestError("Invalid request origin.", 403); }
  if (origin !== request.nextUrl.origin && host !== request.headers.get("host")) throw new RequestError("Request origin is not allowed.", 403);
}

/** Authenticate before reading a body, resolving a path, or contacting a worker. */
export function withOwner(handler: (request: NextRequest, owner: OwnerContext) => Promise<Response>) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const owner = await getOwnerContext(request);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        assertSameOrigin(request);
      }
      const response = await handler(request, owner);
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch (error) {
      const status = error instanceof SessionInvalidError ? 401 : error instanceof RequestError ? error.status : 500;
      return NextResponse.json({ ok: false, error: status === 401 ? "Unauthorized" : error instanceof RequestError ? error.message : "The request could not be completed." },
        { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
  };
}
