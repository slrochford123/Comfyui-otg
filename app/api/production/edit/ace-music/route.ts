import fs from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { extractReferenceAudio, generateAceMusic } from "@/lib/aceStep";
import { getGallerySourcesForRequest, resolveGalleryItemByName, safeGalleryName, writeMetaForFile } from "@/lib/gallery";
import { SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeJoin, safeSegment } from "@/lib/paths";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function numberOr(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function cleanName(value: unknown) {
  return path.basename(String(value || "").trim());
}

function sourceNameFromUrl(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl, "http://otg.local");
    return cleanName(parsed.searchParams.get("name") || parsed.searchParams.get("fileName") || parsed.pathname.split("/").pop());
  } catch {
    return cleanName(String(sourceUrl || "").split("?")[0]);
  }
}

function scopeFromUrl(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl, "http://otg.local");
    const scope = parsed.searchParams.get("scope");
    return scope === "user" || scope === "device" ? scope : "";
  } catch {
    return "";
  }
}

function outputPrefix(sceneId: string, clipIndex: number) {
  const scenePart = safeGalleryName(safeSegment(sceneId || "scene")).replace(/\.+$/g, "") || "scene";
  const clipPart = Math.max(0, Math.floor(numberOr(clipIndex, 0))) + 1;
  return `${scenePart}_clip_${clipPart}_ace_music`;
}

export async function POST(req: NextRequest) {
  try {
    if (!isProductionFeatureEnabled()) {
      return productionDisabledResponse();
    }
    if (process.env.ACE_STEP_ENABLED === "0") {
      return NextResponse.json({ ok: false, error: "ACE-Step is disabled." }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Background music prompt is required." }, { status: 400 });
    }

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const sourceFileName = cleanName(body?.sourceFileName) || sourceNameFromUrl(String(body?.sourceUrl || ""));
    if (!sourceFileName) {
      return NextResponse.json({ ok: false, error: "Source video filename is required." }, { status: 400 });
    }

    const scopeHint = String(body?.scope || body?.sourceScope || "").trim() || scopeFromUrl(String(body?.sourceUrl || ""));
    const sourceItem = resolveGalleryItemByName({ sources, name: sourceFileName, scopeHint });
    if (!sourceItem?.path) {
      return NextResponse.json({ ok: false, error: `Source video was not found in the gallery: ${sourceFileName}` }, { status: 404 });
    }

    const ownerKey = safeSegment(owner.ownerKey || "local");
    const jobId = `production-ace-music-${Date.now()}`;
    const jobDir = safeJoin(OTG_DATA_ROOT, "production_edit_jobs", ownerKey, jobId);
    ensureDir(jobDir);

    const referenceAudioPath = await extractReferenceAudio(sourceItem.path, safeJoin(jobDir, "reference.wav"), 4);
    const durationSeconds = Math.max(10, Math.min(600, numberOr(body?.durationSeconds, 30)));
    const generated = await generateAceMusic({
      prompt,
      durationSeconds,
      bpm: numberOr(body?.bpm, 95),
      keyscale: String(body?.keyscale || "E minor"),
      seed: numberOr(body?.seed, -1),
      referenceAudioPath,
    });

    const targetSource = sourceItem.scope === "user"
      ? sources.find((source) => source.scope === "user") || sources[0]
      : sources.find((source) => source.scope === "device") || sources[0];
    if (!targetSource) {
      return NextResponse.json({ ok: false, error: "No writable gallery source was available." }, { status: 500 });
    }

    const fileName = `${outputPrefix(String(body?.sceneId || "scene"), numberOr(body?.clipIndex, 0))}_${Date.now()}.mp3`;
    const audioPath = safeJoin(targetSource.dir, fileName);
    await fs.writeFile(audioPath, generated.audioBuffer);
    const stat = await fs.stat(audioPath);
    writeMetaForFile(audioPath, {
      mediaCategory: "audio",
      sourceType: "production-edit-ace-step-music",
      requestKind: "production-edit-background-music",
      positivePrompt: prompt,
      submitPayload: {
        prompt,
        durationSeconds,
        bpm: generated.bpm || numberOr(body?.bpm, 95),
        keyscale: String(body?.keyscale || "E minor"),
        sourceFileName,
        sceneId: String(body?.sceneId || ""),
        clipIndex: numberOr(body?.clipIndex, 0),
      },
      audioLibrary: {
        source: "ace-step-1.5-api",
        operation: "reference-music-bed",
        sourceFileName,
        durationSeconds: generated.durationSeconds || durationSeconds,
        model: generated.model || "acestep-v15-turbo",
      },
      ownerKey: owner.ownerKey,
      username: owner.username,
      deviceId: owner.deviceId,
    }, targetSource);

    const galleryUrl = `/api/gallery/file?name=${encodeURIComponent(fileName)}&scope=${encodeURIComponent(targetSource.scope)}`;
    return NextResponse.json({
      ok: true,
      jobId,
      fileName,
      audioPath,
      url: galleryUrl,
      galleryUrl,
      scope: targetSource.scope,
      prompt,
      durationSeconds: generated.durationSeconds || durationSeconds,
      bpm: generated.bpm || numberOr(body?.bpm, 95),
      sizeBytes: stat.size,
      referenceUsed: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "ACE-Step background music generation failed." }, { status: 500 });
  }
}
