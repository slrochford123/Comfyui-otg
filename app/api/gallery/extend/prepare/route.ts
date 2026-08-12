import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";
import { getOwnerDirs, ensureDir } from "@/lib/paths";
import { getFfmpegVersion } from "@/lib/ffmpeg";
import { buildTailFrameName, deriveOrientation, extractTailFrameToImage, probeVideoInfo } from "@/lib/videoFrame";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function safePrompt(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const name = firstText(form.get("name"));
    const scopeHint = firstText(form.get("scope"));

    if (!name) {
      return NextResponse.json({ ok: false, error: "missing name" }, { status: 400 });
    }

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const item = resolveGalleryItemByName({
      sources,
      name,
      scopeHint: scopeHint || null,
    });

    if (!item) {
      return NextResponse.json({ ok: false, error: "gallery item not found" }, { status: 404 });
    }
    if (item.kind !== "video") {
      return NextResponse.json({ ok: false, error: "extend prepare only supports videos" }, { status: 400 });
    }

    const dirs = getOwnerDirs(owner.ownerKey);
    ensureDir(dirs.preview);

    const ffmpegVersion = await getFfmpegVersion();
    if (!ffmpegVersion) {
      return NextResponse.json(
        {
          ok: false,
          error: "ffmpeg not available",
          hint: "Set OTG_FFMPEG_PATH and OTG_FFPROBE_PATH to your ffmpeg install.",
        },
        { status: 500 },
      );
    }

    const probe = await probeVideoInfo(item.path);
    const frameName = buildTailFrameName(item.path);
    const framePath = path.join(dirs.preview, frameName);

    if (!fs.existsSync(framePath)) {
      await extractTailFrameToImage({ inputPath: item.path, outputPath: framePath });
    }

    const positivePrompt = safePrompt(item.meta?.positivePrompt) || safePrompt(item.meta?.submitPayload?.positivePrompt);
    const negativePrompt = safePrompt(item.meta?.negativePrompt) || safePrompt(item.meta?.submitPayload?.negativePrompt);
    const defaultSecondsRaw = Number(item.meta?.submitPayload?.durationSeconds || item.meta?.submitPayload?.duration || 5);
    const defaultSeconds = Math.max(5, Math.min(15, Number.isFinite(defaultSecondsRaw) ? Math.round(defaultSecondsRaw) : 5));

    return NextResponse.json({
      ok: true,
      item: {
        name: item.name,
        fileName: path.basename(item.path),
        scope: item.scope,
        kind: item.kind,
        sourceUrl: item.url,
      },
      frame: {
        name: frameName,
        url: `/api/preview/file?name=${encodeURIComponent(frameName)}`,
      },
      defaults: {
        positivePrompt,
        negativePrompt,
        durationSeconds: defaultSeconds,
      },
      extend: {
        mode: "last-frame-continue",
        sourceFrame: "tail-frame",
        workflowFallback: "presets/Create a Video from Pictures",
      },
      video: {
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        orientation: deriveOrientation(probe.width, probe.height),
        codec: probe.codec,
      },
      ffmpeg: {
        ready: true,
        version: ffmpegVersion,
      },
    });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
