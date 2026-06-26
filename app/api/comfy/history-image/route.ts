import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HistoryImagePayloadV36BP9 = {
  filename: string;
  subfolder: string;
  type: string;
  nodeId?: string;
  bucket?: string;
};

function normalizeBaseUrlV36BP9(value: unknown) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function candidateComfyBaseUrlsV36BP9() {
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
    .map(normalizeBaseUrlV36BP9)
    .filter(Boolean);

  return Array.from(new Set(values));
}

async function fetchHistoryV36BP9(baseUrl: string, promptId: string) {
  const response = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
    cache: "no-store",
  });

  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function extractHistoryImagesV36BP9(historyJson: any, promptId: string): HistoryImagePayloadV36BP9[] {
  const entry = historyJson?.[promptId] || historyJson;
  const outputs = entry?.outputs;

  if (!outputs || typeof outputs !== "object") return [];

  const images: HistoryImagePayloadV36BP9[] = [];

  for (const [nodeId, node] of Object.entries(outputs) as Array<[string, any]>) {
    const buckets: Array<{ name: string; items: any[] }> = [
      { name: "images", items: Array.isArray(node?.images) ? node.images : [] },
      { name: "gifs", items: Array.isArray(node?.gifs) ? node.gifs : [] },
    ];

    for (const bucket of buckets) {
      for (const item of bucket.items) {
        const filename = String(item?.filename || "").trim();
        if (!filename) continue;

        images.push({
          filename,
          subfolder: String(item?.subfolder || "").trim(),
          type: String(item?.type || "output").trim() || "output",
          nodeId,
          bucket: bucket.name,
        });
      }
    }
  }

  return images;
}

function matchesHistoryImageRequestV36BPR2(
  item: HistoryImagePayloadV36BP9,
  filters: { nodeId?: string; filenamePrefix?: string },
) {
  const nodeId = String(filters.nodeId || "").trim();
  const filenamePrefix = String(filters.filenamePrefix || "").trim();

  if (nodeId && String(item.nodeId || "") !== nodeId) return false;
  if (filenamePrefix && !String(item.filename || "").startsWith(filenamePrefix)) return false;

  return true;
}

async function resolveHistoryImageV36BP9(
  promptId: string,
  filters: { nodeId?: string; filenamePrefix?: string } = {},
) {
  const attempts: string[] = [];

  for (const baseUrl of candidateComfyBaseUrlsV36BP9()) {
    try {
      const history = await fetchHistoryV36BP9(baseUrl, promptId);
      attempts.push(`${baseUrl}: ${history ? "history" : "no-history"}`);

      const images = extractHistoryImagesV36BP9(history, promptId);
      if (!images.length) continue;

      const exact = images.filter((item) => matchesHistoryImageRequestV36BPR2(item, filters));
      if ((filters.nodeId || filters.filenamePrefix) && !exact.length) {
        attempts.push(`${baseUrl}: no exact image for nodeId=${filters.nodeId || "*"} filenamePrefix=${filters.filenamePrefix || "*"}`);
        continue;
      }

      const pool = exact.length ? exact : images;
      const preferred =
        pool.find((item) => /character[\s_-]*card|card/i.test(item.filename)) ||
        pool.find((item) => /\.(png|jpg|jpeg|webp)$/i.test(item.filename)) ||
        pool[0];

      return {
        baseUrl,
        image: preferred,
        count: images.length,
        attempts,
      };
    } catch (error: any) {
      attempts.push(`${baseUrl}: ${error?.message || String(error)}`);
    }
  }

  return {
    baseUrl: "",
    image: null as HistoryImagePayloadV36BP9 | null,
    count: 0,
    attempts,
  };
}

function imageJsonResponseV36BP9(request: NextRequest, promptId: string, resolved: Awaited<ReturnType<typeof resolveHistoryImageV36BP9>>) {
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
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const imageUrl = new URL(request.nextUrl.origin + request.nextUrl.pathname);
  imageUrl.searchParams.set("promptId", promptId);
  imageUrl.searchParams.set("image", "1");
  imageUrl.searchParams.set("filename", image.filename);
  imageUrl.searchParams.set("type", image.type || "output");
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
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const promptId = String(request.nextUrl.searchParams.get("promptId") || "").trim();
  const nodeId = String(request.nextUrl.searchParams.get("nodeId") || "").trim();
  const filenamePrefix = String(request.nextUrl.searchParams.get("filenamePrefix") || "").trim();

  if (!promptId) {
    return NextResponse.json({ ok: false, error: "Missing promptId." }, { status: 400 });
  }

  const resolved = await resolveHistoryImageV36BP9(promptId, { nodeId, filenamePrefix });

  if (request.nextUrl.searchParams.get("image") !== "1") {
    return imageJsonResponseV36BP9(request, promptId, resolved);
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
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const viewUrl = new URL(`${resolved.baseUrl}/view`);
  viewUrl.searchParams.set("filename", image.filename);
  viewUrl.searchParams.set("type", image.type || "output");
  if (image.subfolder) viewUrl.searchParams.set("subfolder", image.subfolder);

  const response = await fetch(viewUrl.toString(), { cache: "no-store" });

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `ComfyUI /view failed (${response.status}) for ${image.filename}.`,
        promptId,
        viewUrl: viewUrl.toString(),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const bytes = await response.arrayBuffer();
  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("content-type") || "image/png");
  headers.set("Cache-Control", "no-store");
  headers.set("X-OTG-Comfy-Filename", image.filename);

  return new NextResponse(new Uint8Array(bytes), { headers });
}
