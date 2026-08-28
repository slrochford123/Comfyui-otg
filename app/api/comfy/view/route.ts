import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeBaseUrlV36BPI2(value: unknown) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function candidateComfyBaseUrlsV36BPI2() {
  const values = [
    process.env.OTG_IMAGE_COMFY_URL,
    process.env.IMAGE_COMFY_BASE_URL,
    process.env.COMFY_IMAGE_BASE_URL,
    process.env.COMFYUI_IMAGE_BASE_URL,
    process.env.COMFYUI_BASE_URL,
    process.env.COMFY_BASE_URL,
    process.env.NEXT_PUBLIC_COMFY_IMAGE_BASE_URL,
    process.env.NEXT_PUBLIC_COMFY_BASE_URL,
    "http://127.0.0.1:8188",
    "http://127.0.0.1:8288",
  ]
    .map(normalizeBaseUrlV36BPI2)
    .filter(Boolean);

  return Array.from(new Set(values));
}

function firstNonEmptyV36BPI2(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

async function fetchComfyViewV36BPI2(baseUrl: string, filename: string, type: string, subfolder: string) {
  const viewUrl = new URL(`${baseUrl}/view`);
  viewUrl.searchParams.set("filename", filename);
  viewUrl.searchParams.set("type", type || "output");
  if (subfolder) viewUrl.searchParams.set("subfolder", subfolder);

  const response = await fetch(viewUrl.toString(), { cache: "no-store" });
  return { response, viewUrl: viewUrl.toString() };
}

export async function GET(request: NextRequest) {
  const filename = firstNonEmptyV36BPI2(
    request.nextUrl.searchParams.get("filename"),
    request.nextUrl.searchParams.get("name"),
  );
  const type = firstNonEmptyV36BPI2(request.nextUrl.searchParams.get("type"), "output");
  const subfolder = firstNonEmptyV36BPI2(request.nextUrl.searchParams.get("subfolder"));

  if (!filename) {
    return NextResponse.json({ ok: false, error: "Missing filename." }, { status: 400 });
  }

  const attempts: string[] = [];

  for (const baseUrl of candidateComfyBaseUrlsV36BPI2()) {
    try {
      const { response, viewUrl } = await fetchComfyViewV36BPI2(baseUrl, filename, type, subfolder);
      attempts.push(`${viewUrl}: ${response.status}`);

      if (!response.ok) continue;

      const bytes = await response.arrayBuffer();
      const headers = new Headers();
      headers.set("Content-Type", response.headers.get("content-type") || "image/png");
      headers.set("Cache-Control", "no-store");
      headers.set("X-OTG-Comfy-Filename", filename);
      headers.set("X-OTG-Comfy-Type", type);
      if (subfolder) headers.set("X-OTG-Comfy-Subfolder", subfolder);

      return new NextResponse(new Uint8Array(bytes), { headers });
    } catch (error: any) {
      attempts.push(`${baseUrl}: ${error?.message || String(error)}`);
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: "COMFY_VIEW_PROXY_FAILED",
      filename,
      type,
      subfolder,
      attempts,
    },
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
}
