import type { NextRequest } from "next/server";

import { getH3PreviewFrame, h3LivePreviewEnabled } from "@/lib/h3PreviewBroker";
import { getOwnerContext } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!h3LivePreviewEnabled()) return new Response(null, { status: 404 });
  const owner = await getOwnerContext(req);
  const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
  const frame = getH3PreviewFrame(jobId, owner.ownerKey);
  if (!frame) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return new Response(new Uint8Array(frame.bytes), {
    headers: {
      "Content-Type": frame.contentType,
      "Cache-Control": "private, no-store",
      "X-H3-Preview-Version": String(frame.version),
      "X-H3-Prompt-Id": frame.promptId,
      "X-H3-Preview-Content-Type": frame.contentType,
    },
  });
}

