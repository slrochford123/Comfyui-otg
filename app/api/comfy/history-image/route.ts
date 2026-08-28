import { NextRequest, NextResponse } from "next/server";
import {
  candidateComfyImageBaseUrls,
  normalizeComfyBaseUrl,
  resolveComfyHistoryImage,
  type ComfyHistoryImageResolution,
} from "../../../../lib/comfyImageOutputLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIEW_REQUEST_TIMEOUT_MS = 10_000;

function allowedPreferredBaseUrl(request: NextRequest) {
  const requested = normalizeComfyBaseUrl(
    request.nextUrl.searchParams.get("comfyBaseUrl") ||
      request.nextUrl.searchParams.get("endpoint") ||
      "",
  );

  if (!requested) return "";
  return candidateComfyImageBaseUrls().includes(requested) ? requested : "";
}

function imageJsonResponse(
  request: NextRequest,
  promptId: string,
  resolved: ComfyHistoryImageResolution,
) {
  const image = resolved.image;
  if (!image) {
    return NextResponse.json(
      {
        ok: false,
        error: "No ComfyUI image output was found for this prompt id.",
        promptId,
        nodeId: request.nextUrl.searchParams.get("nodeId") || "",
        filenamePrefix: request.nextUrl.searchParams.get("filenamePrefix") || "",
        attempts: resolved.attempts,
        checkedBackends: resolved.checkedBackends,
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const imageUrl = new URL(request.nextUrl.origin + request.nextUrl.pathname);
  imageUrl.searchParams.set("promptId", promptId);
  imageUrl.searchParams.set("image", "1");
  if (image.nodeId) imageUrl.searchParams.set("nodeId", image.nodeId);
  imageUrl.searchParams.set("filename", image.filename);
  imageUrl.searchParams.set("type", image.type || "output");
  imageUrl.searchParams.set("comfyBaseUrl", resolved.baseUrl);
  if (image.subfolder) imageUrl.searchParams.set("subfolder", image.subfolder);

  return NextResponse.json(
    {
      ok: true,
      promptId,
      url: imageUrl.pathname + imageUrl.search,
      imageUrl: imageUrl.pathname + imageUrl.search,
      sourceName: image.filename,
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type || "output",
      nodeId: image.nodeId || "",
      outputCount: resolved.count,
      comfyBaseUrl: resolved.baseUrl,
      attempts: resolved.attempts,
      checkedBackends: resolved.checkedBackends,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function fetchComfyView(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VIEW_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const promptId = String(request.nextUrl.searchParams.get("promptId") || "").trim();
  const nodeId = String(request.nextUrl.searchParams.get("nodeId") || "").trim();
  const filename = String(request.nextUrl.searchParams.get("filename") || "").trim();
  const filenamePrefix = String(request.nextUrl.searchParams.get("filenamePrefix") || "").trim();
  const preferredBaseUrl = allowedPreferredBaseUrl(request);

  if (!promptId) {
    return NextResponse.json({ ok: false, error: "Missing promptId." }, { status: 400 });
  }

  const resolved = await resolveComfyHistoryImage({
    promptId,
    filters: { nodeId, filename, filenamePrefix },
    preferredBaseUrl,
  });

  if (request.nextUrl.searchParams.get("image") !== "1") {
    return imageJsonResponse(request, promptId, resolved);
  }

  const image = resolved.image;
  if (!image || !resolved.baseUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "No ComfyUI image output was found for this prompt id.",
        promptId,
        nodeId,
        filenamePrefix,
        attempts: resolved.attempts,
        checkedBackends: resolved.checkedBackends,
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const viewUrl = new URL(`${resolved.baseUrl}/view`);
  viewUrl.searchParams.set("filename", image.filename);
  viewUrl.searchParams.set("type", image.type || "output");
  if (image.subfolder) viewUrl.searchParams.set("subfolder", image.subfolder);

  let response: Response;
  try {
    response = await fetchComfyView(viewUrl.toString());
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: `ComfyUI /view request failed for ${image.filename}: ${error?.message || String(error)}`,
        promptId,
        comfyBaseUrl: resolved.baseUrl,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `ComfyUI /view failed (${response.status}) for ${image.filename}.`,
        promptId,
        comfyBaseUrl: resolved.baseUrl,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const bytes = await response.arrayBuffer();
  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("content-type") || "image/png");
  headers.set("Cache-Control", "no-store");
  headers.set("X-OTG-Comfy-Filename", image.filename);
  headers.set("X-OTG-Comfy-Base-Url", resolved.baseUrl);

  return new NextResponse(new Uint8Array(bytes), { headers });
}
