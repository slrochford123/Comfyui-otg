import { NextRequest } from "next/server";
import { configuredComfyBaseUrlForJob, logComfyRouting } from "@/app/api/_lib/comfyTarget";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const mode = String(req.nextUrl.searchParams.get("mode") || "").toLowerCase();
  const preset = String(req.nextUrl.searchParams.get("preset") || req.nextUrl.searchParams.get("workflow") || "").trim();
  const label = String(req.nextUrl.searchParams.get("label") || "").trim();
  const route = configuredComfyBaseUrlForJob({ mode, preset, label });
  const comfyBaseUrl = route.baseUrl;
  logComfyRouting("/api/comfy-status GET", { mode, preset, label }, route);

  try {
    const r = await fetch(`${comfyBaseUrl}/system_stats`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    return Response.json(
      {
        serverState: r.ok ? "idle" : "down",
        serverHint: r.ok ? "Connected" : "Disconnected",
        comfyBaseUrl,
        upstreamStatus: r.status,
        system_stats: j,
      },
      { status: r.ok ? 200 : 502 }
    );
  } catch (e: any) {
    return Response.json(
      {
        serverState: "down",
        serverHint: "Disconnected",
        comfyBaseUrl,
        error: String(e?.message || e),
      },
      { status: 502 }
    );
  }
}
