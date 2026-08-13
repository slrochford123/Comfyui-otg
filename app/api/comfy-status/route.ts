import { NextRequest } from "next/server";
import {
  classifyComfyJob,
  configuredComfyBaseUrlForJob,
  configuredImageComfyBaseUrl,
  logComfyRouting,
} from "@/app/api/_lib/comfyTarget";
import { probeVideoBackend, videoBackends } from "@/lib/videoBackendFailover";

export const runtime = "nodejs";

async function probeImage(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/system_stats`, { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    const gpuName = Array.isArray(json?.devices) ? String(json.devices[0]?.name || "") || null : null;
    return { ok: response.ok, status: response.status, gpuName, error: response.ok ? null : `HTTP ${response.status}` };
  } catch (error: any) {
    return { ok: false, status: null, gpuName: null, error: String(error?.message || error) };
  }
}

export async function GET(req: NextRequest) {
  const descriptor = {
    mode: String(req.nextUrl.searchParams.get("mode") || "").toLowerCase(),
    preset: String(req.nextUrl.searchParams.get("preset") || req.nextUrl.searchParams.get("workflow") || "").trim(),
    label: String(req.nextUrl.searchParams.get("label") || "").trim(),
  };
  const requestedKind = classifyComfyJob(descriptor);
  const route = configuredComfyBaseUrlForJob(descriptor);
  const imageBaseUrl = configuredImageComfyBaseUrl();
  const backends = videoBackends();
  logComfyRouting("/api/comfy-status GET", descriptor, route);

  const [image, videoPrimary, videoFallback] = await Promise.all([
    probeImage(imageBaseUrl),
    probeVideoBackend(backends.primary.baseUrl),
    probeVideoBackend(backends.fallback.baseUrl),
  ]);

  const activeVideoBackend = videoPrimary.ok ? backends.primary : videoFallback.ok ? backends.fallback : null;
  const fallbackActive = !videoPrimary.ok && videoFallback.ok;
  const selectedOk = requestedKind === "video" ? Boolean(activeVideoBackend) : image.ok;
  const selectedBaseUrl = requestedKind === "video" ? activeVideoBackend?.baseUrl || backends.primary.baseUrl : imageBaseUrl;

  return Response.json(
    {
      ok: selectedOk,
      connected: selectedOk,
      serverState: selectedOk ? "idle" : "down",
      serverHint: selectedOk ? "Connected" : "Disconnected",
      requestedKind,
      comfyBaseUrl: selectedBaseUrl,
      imageBackend: {
        id: "rtx5060ti",
        label: "RTX 5060 Ti image backend",
        baseUrl: imageBaseUrl,
        gpu: image.gpuName,
        available: image.ok,
        error: image.error,
      },
      videoBackend: {
        activeId: activeVideoBackend?.id || null,
        activeLabel: activeVideoBackend?.label || "No video backend available",
        activeBaseUrl: activeVideoBackend?.baseUrl || null,
        activeGpu: activeVideoBackend ? (activeVideoBackend.id === "rtx3090" ? videoPrimary.gpuName : videoFallback.gpuName) : null,
        fallbackActive,
        fallbackStatus: fallbackActive
          ? "RTX 3090 unavailable; RTX 5060 Ti fallback is active for compatible workflows."
          : videoPrimary.ok
            ? "RTX 3090 primary is available; fallback is standing by."
            : "RTX 3090 and RTX 5060 Ti video backends are unavailable.",
        primary: { ...backends.primary, available: videoPrimary.ok, probe: videoPrimary },
        fallback: { ...backends.fallback, available: videoFallback.ok, probe: videoFallback },
      },
    },
    { status: selectedOk ? 200 : 502 }
  );
}
