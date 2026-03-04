function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}

import { NextResponse } from "next/server";
import { resolveComfyBaseUrl } from "@/app/api/_lib/comfyTarget";

export const runtime = "nodejs";

function getComfyBaseUrl() {
  const raw =
    // Prefer COMFY_BASE_URL which is used by /api/comfy and our server-side proxy.
    process.env.COMFY_BASE_URL ||
    process.env.COMFY_URL ||
    process.env.NEXT_PUBLIC_COMFY_URL ||
    "http://127.0.0.1:8188";
  return raw.replace(/\/$/, "");
}

export async function GET() {
  const { baseUrl } = await resolveComfyBaseUrl();
  const COMFY_BASE_URL = baseUrl.replace(/\/+$/, "");
  const base = getComfyBaseUrl();
  const url = `${base}/system_stats`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      comfyBase: base,
      target: url,
      system: json?.system ?? json ?? null,
      raw: json ? undefined : text,
    }, { status: res.ok ? 200 : 502 });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        status: 0,
        comfyBase: base,
        target: url,
        error: String(e?.message ?? e),
      },
      { status: 502 }
    );
  }
}
