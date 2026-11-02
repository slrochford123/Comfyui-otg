import { NextRequest } from "next/server";
import { withOwner } from "@/lib/routeSecurity";
import { serveOwnedComfyMedia } from "@/lib/comfyMediaAccess";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const serve = withOwner(async (request, owner) => {
  // Retain the old URL shape, but never use a shared public filename cache.
  const url = new URL(request.url);
  const src = url.searchParams.get("src");
  if (src) {
    const source = new URL(src, request.url);
    for (const key of ["filename", "name", "type", "subfolder", "promptId", "nodeId", "comfyBaseUrl"]) {
      const value = source.searchParams.get(key);
      if (value) url.searchParams.set(key, value);
    }
  }
  return serveOwnedComfyMedia(new NextRequest(url, { method: request.method, headers: request.headers, signal: request.signal }), owner);
});
export const GET = serve;
export const HEAD = serve;
