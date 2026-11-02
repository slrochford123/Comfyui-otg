import { NextResponse } from "next/server";
import { withOwner } from "@/lib/routeSecurity";
import { limitedJson } from "@/lib/limitedRequestBody";
import { syncRecentOwnerPrompts } from "@/lib/comfyGallerySync";
export const runtime = "nodejs";
export const POST = withOwner(async (request, owner) => {
  const body = await limitedJson(request, 16 * 1024);
  const limit = Math.max(1, Math.min(25, Math.floor(Number(body.limit) || 10)));
  const result = await syncRecentOwnerPrompts({
    ...owner, deviceId: owner.ownerKey, limit,
  });
  return NextResponse.json(result);
});
