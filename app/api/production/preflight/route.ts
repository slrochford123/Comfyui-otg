import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import { SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SceneInput = {
  card?: number;
  clipIndex?: number;
  videoPath?: string;
  videoUrl?: string;
  fileName?: string;
};

function safeString(value: unknown) {
  return String(value || "").trim();
}

function fileNameFromUrl(value: string) {
  try {
    const parsed = new URL(value, "http://localhost");
    return path.basename(parsed.searchParams.get("name") || parsed.searchParams.get("fileName") || parsed.pathname);
  } catch {
    return path.basename(value.split("?")[0] || "");
  }
}

function scopeFromUrl(value: string) {
  try {
    const parsed = new URL(value, "http://localhost");
    const scope = parsed.searchParams.get("scope");
    return scope === "user" || scope === "device" ? scope : null;
  } catch {
    return null;
  }
}

async function resolveScenePath(req: NextRequest, scene: SceneInput) {
  const direct = safeString(scene.videoPath);
  if (direct && path.isAbsolute(direct) && fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return direct;
  }

  const { sources } = await getGallerySourcesForRequest(req);
  const fileName = safeString(scene.fileName) || fileNameFromUrl(safeString(scene.videoUrl));
  if (!fileName) return "";

  const item = resolveGalleryItemByName({
    sources,
    name: fileName,
    scopeHint: scopeFromUrl(safeString(scene.videoUrl)),
  });
  return item?.path || "";
}

function parseFps(value: string) {
  const text = safeString(value);
  if (!text) return null;
  const [num, den] = text.split("/").map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return Math.round((num / den) * 100) / 100;
  const direct = Number(text);
  return Number.isFinite(direct) ? direct : null;
}

async function probeMedia(filePath: string) {
  const result = await runCmd(
    resolveFfprobePath(),
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
    { timeoutMs: 30000 },
  );
  if (result.code !== 0) throw new Error(result.stderr || "ffprobe failed.");

  const parsed = JSON.parse(result.stdout || "{}");
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream: any) => stream.codec_type === "video") || {};
  const audio = streams.find((stream: any) => stream.codec_type === "audio") || {};
  const durationSeconds = Number(parsed?.format?.duration);

  return {
    durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) / 1000 : null,
    width: Number.isFinite(Number(video.width)) ? Number(video.width) : null,
    height: Number.isFinite(Number(video.height)) ? Number(video.height) : null,
    fps: parseFps(String(video.avg_frame_rate || video.r_frame_rate || "")),
    hasAudio: Boolean(audio.codec_type),
    audioSampleRate: Number.isFinite(Number(audio.sample_rate)) ? Number(audio.sample_rate) : null,
    audioChannels: Number.isFinite(Number(audio.channels)) ? Number(audio.channels) : null,
  };
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();

  try {
    const body = await req.json().catch(() => ({}));
    const scenes = Array.isArray(body?.scenes) ? (body.scenes as SceneInput[]) : [];

    const clips = await Promise.all(
      scenes.map(async (scene, index) => {
        const clipIndex = Math.max(0, Number(scene.clipIndex ?? scene.card ?? index + 1) - 1);
        const filePath = await resolveScenePath(req, scene);
        const fileName = path.basename(filePath || safeString(scene.fileName) || fileNameFromUrl(safeString(scene.videoUrl)));

        if (!filePath) {
          return {
            clipIndex,
            ok: false,
            fileName,
            durationSeconds: null,
            width: null,
            height: null,
            fps: null,
            hasAudio: false,
            audioSampleRate: null,
            audioChannels: null,
            warnings: ["Source file could not be resolved."],
            error: "Missing source file.",
          };
        }

        try {
          const media = await probeMedia(filePath);
          const warnings: string[] = [];
          if (!media.durationSeconds || media.durationSeconds <= 0) warnings.push("Duration metadata is missing.");
          if (!media.width || !media.height) warnings.push("Video dimensions are missing.");
          if (media.fps && Math.abs(media.fps - 30) > 0.05) warnings.push(`FPS is ${media.fps}; Assemble will normalize when transitions render.`);
          if (!media.hasAudio) warnings.push("No audio stream detected.");
          if (media.audioSampleRate && media.audioSampleRate !== 48000) warnings.push(`Audio sample rate is ${media.audioSampleRate}; Assemble will normalize to 48000 Hz.`);

          return {
            clipIndex,
            ok: warnings.length === 0 || warnings.every((warning) => !/missing|could not/i.test(warning)),
            fileName,
            ...media,
            warnings,
          };
        } catch (error) {
          return {
            clipIndex,
            ok: false,
            fileName,
            durationSeconds: null,
            width: null,
            height: null,
            fps: null,
            hasAudio: false,
            audioSampleRate: null,
            audioChannels: null,
            warnings: ["ffprobe could not read this clip."],
            error: error instanceof Error ? error.message : "Probe failed.",
          };
        }
      }),
    );

    const warningCount = clips.reduce((sum, clip) => sum + clip.warnings.length + (clip.error ? 1 : 0), 0);

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      clips,
      summary: {
        clipCount: clips.length,
        readyCount: clips.filter((clip) => clip.ok).length,
        warningCount,
        hasBlockingIssue: clips.some((clip) => !clip.ok),
      },
    });
  } catch (error) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Preflight failed." }, { status: 500 });
  }
}
