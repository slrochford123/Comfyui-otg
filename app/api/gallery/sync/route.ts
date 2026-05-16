import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { configuredImageComfyBaseUrl, configuredVideoComfyBaseUrl } from "@/app/api/_lib/comfyTarget";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { forcePullOwnerPrompts, syncPromptOutputsForOwner, syncRecentOwnerPrompts } from "@/lib/comfyGallerySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(req: NextRequest): Promise<Record<string, any>> {
  try {
    const raw = await req.text();
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

type DirectSyncHistoryFile = {
  filename: string;
  subfolder?: string;
  type?: string;
  nodeId?: string;
};

type DirectSyncItem = {
  name: string;
  fileName: string;
  path: string;
  serverPath: string;
  url: string;
  remoteFile: DirectSyncHistoryFile;
};

const DIRECT_SYNC_IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

function normalizeDirectSyncBaseUrl(raw: unknown) {
  const value = String(raw || "").trim();
  return value ? value.replace(/\/+$/, "") : "";
}

function uniqueDirectSyncBaseUrls(primary: string) {
  return Array.from(
    new Set(
      [
        primary,
        process.env.OTG_IMAGE_COMFY_BASE_URL,
        process.env.IMAGE_COMFY_BASE_URL,
        process.env.COMFY_IMAGE_BASE_URL,
        process.env.NEXT_PUBLIC_IMAGE_COMFY_BASE_URL,
        process.env.OTG_COMFY_BASE_URL,
        process.env.COMFY_BASE_URL,
        process.env.COMFYUI_BASE_URL,
        process.env.NEXT_PUBLIC_COMFY_BASE_URL,
        process.env.NEXT_PUBLIC_COMFYUI_BASE_URL,
        "http://127.0.0.1:8188",
        "http://localhost:8188",
        "http://100.76.179.83:8188",
      ]
        .map(normalizeDirectSyncBaseUrl)
        .filter(Boolean)
    )
  );
}

function safeDirectSyncSegment(raw: unknown, fallback = "item") {
  const value = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return value || fallback;
}

function directSyncOutputRoot(ownerKey: string, promptId: string) {
  const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(
    dataRoot,
    "production_storyboard_sync",
    safeDirectSyncSegment(ownerKey, "owner"),
    safeDirectSyncSegment(promptId, "prompt")
  );
}

function directSyncOrderKey(name: string) {
  const file = String(name || "").split(/[\\/]/).pop() || String(name || "");
  const matches = file.match(/\d+/g) || [];
  const lastNumber = matches.length ? Number(matches[matches.length - 1]) : Number.MAX_SAFE_INTEGER;

  return {
    file,
    lastNumber: Number.isFinite(lastNumber) ? lastNumber : Number.MAX_SAFE_INTEGER,
  };
}

function sortDirectSyncFiles(files: DirectSyncHistoryFile[]) {
  return [...files].sort((a, b) => {
    const ka = directSyncOrderKey(a.filename);
    const kb = directSyncOrderKey(b.filename);

    if (ka.lastNumber !== kb.lastNumber) return ka.lastNumber - kb.lastNumber;
    return ka.file.localeCompare(kb.file, undefined, { numeric: true, sensitivity: "base" });
  });
}

function extractDirectSyncImageFiles(record: any): DirectSyncHistoryFile[] {
  const files: DirectSyncHistoryFile[] = [];
  const seen = new Set<string>();

  const visit = (value: any, nodeId?: string) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, nodeId);
      return;
    }

    if (!value || typeof value !== "object") return;

    if (value.filename && DIRECT_SYNC_IMAGE_RE.test(String(value.filename))) {
      const file: DirectSyncHistoryFile = {
        filename: String(value.filename),
        subfolder: value.subfolder ? String(value.subfolder) : "",
        type: value.type ? String(value.type) : "output",
        nodeId,
      };

      const key = `${file.type || "output"}|${file.subfolder || ""}|${file.filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        files.push(file);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      visit(child, key || nodeId);
    }
  };

  visit(record);
  return sortDirectSyncFiles(files);
}

async function fetchDirectSyncHistory(baseUrl: string, promptId: string) {
  const res = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Comfy history failed at ${baseUrl} (${res.status}).`);
  }

  const json = await res.json().catch(() => null);
  const record = json?.[promptId] || json;

  if (!record || typeof record !== "object") {
    throw new Error(`Comfy history returned no usable record at ${baseUrl}.`);
  }

  return record;
}

async function fetchDirectSyncViewBytes(baseUrl: string, file: DirectSyncHistoryFile) {
  const viewUrl =
    `${baseUrl}/view?filename=${encodeURIComponent(file.filename)}` +
    `&type=${encodeURIComponent(file.type || "output")}` +
    `&subfolder=${encodeURIComponent(file.subfolder || "")}`;

  const res = await fetch(viewUrl, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Comfy view failed for ${file.filename} at ${baseUrl} (${res.status}).`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function syncPromptOutputsDirectFallback(args: {
  promptId: string;
  ownerKey: string;
  imageComfyBaseUrl: string;
}) {
  const promptId = String(args.promptId || "").trim();
  const ownerKey = String(args.ownerKey || "owner").trim() || "owner";
  const bases = uniqueDirectSyncBaseUrls(args.imageComfyBaseUrl);

  let lastError = "";

  for (const baseUrl of bases) {
    try {
      const record = await fetchDirectSyncHistory(baseUrl, promptId);
      const files = extractDirectSyncImageFiles(record);

      if (!files.length) {
        lastError = `No image files found in Comfy history at ${baseUrl}.`;
        continue;
      }

      const outDir = directSyncOutputRoot(ownerKey, promptId);
      await fs.mkdir(outDir, { recursive: true });

      const items: DirectSyncItem[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const remoteFile = files[index];
        const bytes = await fetchDirectSyncViewBytes(baseUrl, remoteFile);

        const ext = path.extname(remoteFile.filename || "").toLowerCase() || ".png";
        const baseName = safeDirectSyncSegment(path.basename(remoteFile.filename, ext), `storyboard_${index + 1}`);
        const finalName = `${String(index + 1).padStart(2, "0")}_${baseName}${ext}`;
        const finalAbs = path.join(outDir, finalName);

        await fs.writeFile(finalAbs, bytes);

        items.push({
          name: finalName,
          fileName: finalName,
          path: finalAbs,
          serverPath: finalAbs,
          url: `/api/file?path=${encodeURIComponent(finalAbs)}`,
          remoteFile,
        });
      }

      return {
        ok: true,
        status: "synced",
        fallback: "direct-comfy-history",
        promptId,
        baseUrl,
        saved: items.map((item) => item.name),
        items,
        fileCount: items.length,
      };
    } catch (error: any) {
      lastError = error?.message || String(error);
    }
  }

  return {
    ok: false,
    status: "error",
    fallback: "direct-comfy-history",
    promptId,
    error: lastError || "Direct Comfy history fallback failed.",
    triedBaseUrls: bases,
    saved: [],
    items: [],
    fileCount: 0,
  };
}

// PRODUCTION_GALLERY_SYNC_FALLBACK_PATCH_V2
async function runSync(req: NextRequest, body: Record<string, any>) {
  const owner = await getOwnerContext(req);
  const imageComfyBaseUrl = configuredImageComfyBaseUrl();
  const videoComfyBaseUrl = configuredVideoComfyBaseUrl();

  const promptId = String(body?.promptId || body?.prompt_id || req.nextUrl.searchParams.get("promptId") || "").trim();
  const forcePullRaw = body?.forcePull ?? body?.force_pull ?? req.nextUrl.searchParams.get("forcePull") ?? req.nextUrl.searchParams.get("force_pull");
  const forcePull = forcePullRaw === true || String(forcePullRaw || "").trim().toLowerCase() === "true" || String(forcePullRaw || "").trim() === "1";
  const limitValue = Number(body?.limit || req.nextUrl.searchParams.get("limit") || (forcePull ? 5000 : 10));
  const limit = forcePull
    ? Math.max(1, Math.min(5000, Number.isFinite(limitValue) ? Math.floor(limitValue) : 5000))
    : Math.max(1, Math.min(25, Number.isFinite(limitValue) ? Math.floor(limitValue) : 10));

  if (promptId) {
    try {
      const result = await syncPromptOutputsForOwner({
        promptId,
        ownerKey: owner.ownerKey,
        username: owner.username,
        deviceId: owner.deviceId,
        imageComfyBaseUrl,
        videoComfyBaseUrl,
      });

      const { ok: _ok, ...payload } = result;
      const payloadAny = payload as any;
      const normalSaved = Array.isArray(payloadAny.saved) ? payloadAny.saved : [];
      const normalItems = Array.isArray(payloadAny.items) ? payloadAny.items : [];
      const normalStatus = String(payloadAny.status || "").trim().toLowerCase();

      if (!normalSaved.length && !normalItems.length && (!normalStatus || normalStatus === "pending")) {
        const fallback = await syncPromptOutputsDirectFallback({
          promptId,
          ownerKey: owner.ownerKey,
          imageComfyBaseUrl,
        });

        const { ok: fallbackOk, ...fallbackPayload } = fallback;
        const fallbackSaved = Array.isArray(fallbackPayload.saved) ? fallbackPayload.saved : [];
        const fallbackItems = Array.isArray(fallbackPayload.items) ? fallbackPayload.items : [];

        if (fallbackOk && (fallbackSaved.length || fallbackItems.length)) {
          return NextResponse.json({
            ok: true,
            mode: "single",
            owner,
            normalSyncStatus: payloadAny.status || "pending",
            normalSyncSavedCount: normalSaved.length,
            normalSyncItemCount: normalItems.length,
            fallbackReason: "normal-sync-returned-empty-pending",
            ...fallbackPayload,
          });
        }

        return NextResponse.json({
          ok: true,
          mode: "single",
          owner,
          ...payload,
          fallbackAttempted: true,
          fallbackReason: "normal-sync-returned-empty-pending",
          fallbackError: fallbackPayload.error || null,
          fallbackTriedBaseUrls: fallbackPayload.triedBaseUrls || [],
        });
      }

      // GALLERY_SYNC_EMPTY_PENDING_FALLBACK_V3
      return NextResponse.json({ ok: true, mode: "single", owner, ...payload });
    } catch (error: any) {
      const fallback = await syncPromptOutputsDirectFallback({
        promptId,
        ownerKey: owner.ownerKey,
        imageComfyBaseUrl,
      });

      const { ok: fallbackOk, ...fallbackPayload } = fallback;

      return NextResponse.json(
        {
          ok: fallbackOk,
          mode: "single",
          owner,
          normalSyncError: error?.message || String(error),
          ...fallbackPayload,
        },
        { status: fallbackOk ? 200 : 502 }
      );
    }
  }

  if (forcePull) {
    const result = await forcePullOwnerPrompts({
      ownerKey: owner.ownerKey,
      username: owner.username,
      deviceId: owner.deviceId,
      imageComfyBaseUrl,
      videoComfyBaseUrl,
      limit,
    });

    const { ok: _ok, ...payload } = result;
    return NextResponse.json({ ok: true, mode: "force-pull", owner, ...payload });
  }

  const result = await syncRecentOwnerPrompts({
    ownerKey: owner.ownerKey,
    username: owner.username,
    deviceId: owner.deviceId,
    imageComfyBaseUrl,
    videoComfyBaseUrl,
    limit,
  });

  const { ok: _ok, ...payload } = result;
  return NextResponse.json({ ok: true, mode: "recent", owner, ...payload });
}

export async function GET(req: NextRequest) {
  try {
    return await runSync(req, {});
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    return await runSync(req, body);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
