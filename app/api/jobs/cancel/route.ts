import { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const COMFY_BASE_URL = (process.env.COMFY_BASE_URL || process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

export async function POST(req: NextRequest) {
  try {
    // Ensure caller is authenticated/has a valid session (OTG Law: whoami governs auth state)
    await getOwnerContext(req);

    const body = await req.json().catch(() => ({}));
    const promptId = String(body?.promptId || body?.prompt_id || "").trim();
    if (!promptId) {
      return Response.json({ ok: false, error: "Missing promptId" }, { status: 400 });
    }

    // Best-effort cancellation:
    // - Remove pending items: POST /queue { delete: [prompt_id] }
    // - Stop current running job: POST /interrupt
    // ComfyUI does not guarantee surgical cancel of a running job by prompt_id.

    const results: any = { deleted: null, interrupted: false };

    try {
      const r1 = await fetch(`${COMFY_BASE_URL}/queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete: [promptId] }),
      });
      results.deleted = await r1.json().catch(() => null);
    } catch {
      // ignore
    }

    try {
      const r2 = await fetch(`${COMFY_BASE_URL}/interrupt`, { method: "POST" });
      results.interrupted = r2.ok;
    } catch {
      // ignore
    }

    return Response.json({ ok: true, promptId, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
