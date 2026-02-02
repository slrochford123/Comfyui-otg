import { NextRequest } from "next/server";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const COMFY_BASE_URL = (process.env.COMFY_BASE_URL || process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

export async function GET(req: NextRequest) {
  try {
    const ownerCtx = await getOwnerContext(req);
    const ownerKey = ownerCtx.ownerKey;

    const r = await fetch(`${COMFY_BASE_URL}/queue`, { cache: "no-store" });
    const qj = await r.json().catch(() => ({}));

    // ComfyUI queue schema can vary by version. We pass through the raw payload
    // and add a normalized shape used by the OTG UI.
    const running = (qj as any)?.queue_running ?? (qj as any)?.running ?? [];
    const pending = (qj as any)?.queue_pending ?? (qj as any)?.pending ?? [];

    const normalize = (arr: any[]) =>
      (Array.isArray(arr) ? arr : []).map((x) => {
        // Most commonly: [prompt_id, ...]
        const prompt_id = Array.isArray(x) ? String(x[0] ?? "") : String((x as any)?.prompt_id ?? "");
        return { prompt_id };
      });

    return Response.json(
      {
        ok: true,
        ownerKey,
        raw: qj,
        running: normalize(running),
        pending: normalize(pending),
      },
      { status: r.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}
