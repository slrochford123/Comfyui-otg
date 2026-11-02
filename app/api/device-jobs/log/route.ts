import fs from "node:fs/promises";
import path from "node:path";
import { withOwner, RequestError } from "@/lib/routeSecurity";
import { limitedJson } from "@/lib/limitedRequestBody";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { ownedPromptMeta } from "@/lib/comfyMediaAccess";
export const runtime = "nodejs";
export const POST = withOwner(async (request, owner) => {
  const body = await limitedJson(request, 16 * 1024);
  const promptId = String(body.promptId || body.prompt_id || "").trim();
  if (!promptId) throw new RequestError("Missing promptId.", 400);
  ownedPromptMeta(owner.ownerKey, promptId);
  const deviceId = safeSegment(owner.ownerKey);
  const row = { prompt_id: promptId, promptId, ownerKey: owner.ownerKey, ts: Date.now(), deviceId };
  const root = path.join(OTG_DATA_ROOT, "device_jobs");
  await fs.mkdir(root, { recursive: true });
  await fs.appendFile(path.join(root, deviceId + ".jsonl"), JSON.stringify(row) + "\n", { mode: 0o600 });
  return Response.json({ ok: true, deviceId, promptId });
});
