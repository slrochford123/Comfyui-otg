import { NextRequest } from "next/server";
import { isLikelyVideoWorkflowKey } from "@/app/api/_lib/comfyTarget";
import { assertAllowedWorkerTargetUrl } from "@/lib/runtime/workerTargetPolicy";

export const runtime = "nodejs";

function normalizeComfyBaseUrl(raw: unknown): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function firstComfyBaseUrl(...values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = normalizeComfyBaseUrl(value);
    if (normalized) return normalized;
  }
  return null;
}

function configuredImageComfyBaseUrl(): string {
  return assertAllowedWorkerTargetUrl(
    firstComfyBaseUrl(
      process.env.OTG_IMAGE_COMFY_BASE_URL,
      process.env.IMAGE_COMFY_BASE_URL,
      process.env.COMFY_IMAGE_BASE_URL,
      process.env.NEXT_PUBLIC_IMAGE_COMFY_BASE_URL,
      process.env.OTG_COMFY_BASE_URL,
      process.env.COMFY_BASE_URL,
      process.env.COMFYUI_BASE_URL,
      process.env.NEXT_PUBLIC_COMFY_BASE_URL,
      process.env.NEXT_PUBLIC_COMFYUI_BASE_URL
    ) || "http://127.0.0.1:8288",
    "ComfyUI image status worker target",
  );
}

function configuredVideoComfyBaseUrl(): string {
  return assertAllowedWorkerTargetUrl(
    firstComfyBaseUrl(
      process.env.OTG_VIDEO_COMFY_BASE_URL,
      process.env.VIDEO_COMFY_BASE_URL,
      process.env.COMFY_VIDEO_BASE_URL,
      process.env.NEXT_PUBLIC_VIDEO_COMFY_BASE_URL,
      process.env.OTG_COMFY_BASE_URL,
      process.env.COMFY_BASE_URL,
      process.env.COMFYUI_BASE_URL,
      process.env.NEXT_PUBLIC_COMFY_BASE_URL,
      process.env.NEXT_PUBLIC_COMFYUI_BASE_URL,
      configuredImageComfyBaseUrl()
    ) || "http://127.0.0.1:8288",
    "ComfyUI video status worker target",
  );
}

export async function GET(req: NextRequest) {
  const mode = String(req.nextUrl.searchParams.get("mode") || "").toLowerCase();
  const preset = String(req.nextUrl.searchParams.get("preset") || req.nextUrl.searchParams.get("workflow") || "").trim();
  const label = String(req.nextUrl.searchParams.get("label") || "").trim();
  const workflowLooksVideo = mode === "video" || isLikelyVideoWorkflowKey(preset, label);
  const comfyBaseUrl = workflowLooksVideo ? configuredVideoComfyBaseUrl() : configuredImageComfyBaseUrl();

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
