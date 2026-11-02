import { NextResponse } from "next/server";
import { withOwner, RequestError } from "@/lib/routeSecurity";
import { ownedHistoryImage, proxyOwnedWorkerMedia } from "@/lib/comfyMediaAccess";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withOwner(async (request, owner) => {
  const q = request.nextUrl.searchParams;
  const promptId = q.get("promptId") || "";
  if (!promptId) throw new RequestError("Missing promptId.", 400);
  const result = await ownedHistoryImage(owner.ownerKey, promptId, {
    nodeId: q.get("nodeId") || undefined, filename: q.get("filename") || undefined,
    filenamePrefix: q.get("filenamePrefix") || undefined,
  });
  if (q.get("image") === "1") return proxyOwnedWorkerMedia(request, result.baseUrl, result.image);
  const params = new URLSearchParams({ promptId, image: "1", filename: result.image.filename });
  if (result.image.nodeId) params.set("nodeId", result.image.nodeId);
  const imageUrl = "/api/comfy/history-image?" + params;
  return NextResponse.json({ ok: true, promptId, url: imageUrl, imageUrl, ...result.image, sourceName: result.image.filename, outputCount: result.count });
});
