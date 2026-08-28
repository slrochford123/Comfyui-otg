import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";
import {
  adjustProductionV2Volume,
  assertProductionV2OwnedFile,
  probeProductionV2Media,
  removeProductionV2BackgroundMusic,
  renderProductionV2Assembly,
  resolveProductionV2Version,
  trimProductionV2Video,
} from "@/lib/production/postProduction";
import {
  appendProductionV2SceneMediaVersion,
  approveProductionV2FinalRender,
  syncProductionV2AssemblyClips,
  updateProductionV2Assembly,
  type ProductionV2SceneMediaVersionType,
} from "@/lib/production/v2";
import { productionV2Store } from "@/lib/production/v2Store";
import { generateProductionV2WooshSfx } from "@/lib/production/wooshV2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, { ...init, headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) } });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function finite(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("A required numeric value is invalid.");
  return number;
}

function versionPreview(productionId: string, sceneId: string, versionId: string) {
  const query = new URLSearchParams({ productionId, sceneId, versionId });
  return `/api/production/v2/media?${query.toString()}`;
}

function appendDerived(args: {
  ownerKey: string;
  productionId: string;
  sceneId: string;
  parentVersionId: string;
  outputPath: string;
  versionType: ProductionV2SceneMediaVersionType;
  sourceOperation: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const production = productionV2Store.load(args.ownerKey, args.productionId);
  if (!production) throw new Error("Production not found.");
  const versionId = `media-${randomUUID()}`;
  const scenes = production.scenes.map((scene) => scene.id === args.sceneId
    ? appendProductionV2SceneMediaVersion(scene, {
        id: versionId,
        parentVersionId: args.parentVersionId,
        mediaPath: args.outputPath,
        previewUrl: versionPreview(args.productionId, args.sceneId, versionId),
        versionType: args.versionType,
        createdAt: new Date().toISOString(),
        sourceOperation: args.sourceOperation,
        metadata: args.metadata,
      }, { selectActive: true })
    : scene);
  const saved = productionV2Store.save(args.ownerKey, syncProductionV2AssemblyClips({ ...production, lifecycleStage: "editing", scenes }));
  const scene = saved.scenes.find((item) => item.id === args.sceneId)!;
  return { production: saved, version: scene.mediaVersions.find((item) => item.id === versionId)! };
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const action = text(body?.action);
    const productionId = text(body?.productionId);
    const sceneId = text(body?.sceneId);
    const versionId = text(body?.versionId);
    if (!productionId) return noStore({ ok: false, error: "productionId is required" }, { status: 400 });
    const production = productionV2Store.load(ownerKey, productionId);
    if (!production) return noStore({ ok: false, error: "Production not found" }, { status: 404 });

    if (action === "approve-final") {
      const saved = productionV2Store.save(ownerKey, approveProductionV2FinalRender(production));
      return noStore({ ok: true, production: saved });
    }

    if (production.status === "completed") return noStore({ ok: false, error: "Completed Productions are read-only." }, { status: 409 });

    if (action === "render-assembly") {
      const rendering = productionV2Store.save(ownerKey, updateProductionV2Assembly(production, { renderStatus: "rendering", finalMedia: null, userVerifiedAt: null }));
      try {
        const clips = [...rendering.assembly.clips].sort((left, right) => left.order - right.order);
        const clipSources = clips.map((clip) => {
          if (!clip.mediaVersionId) throw new Error("Every Assembly Scene requires a selected media version.");
          const resolved = resolveProductionV2Version(rendering, clip.sceneId, clip.mediaVersionId);
          return { ...resolved, sourcePath: assertProductionV2OwnedFile(ownerKey, productionId, resolved.version.mediaPath) };
        });
        const musicTracks = rendering.assembly.musicTracks.map((track) => ({
          ...track,
          sourcePath: assertProductionV2OwnedFile(ownerKey, productionId, track.mediaPath),
        }));
        const assemblySceneIds = new Set(clips.map((clip) => clip.sceneId));
        const sfxTracks = rendering.assembly.sfxTracks
          .filter((track) => assemblySceneIds.has(track.sceneId))
          .map((track) => ({
            ...track,
            sourcePath: assertProductionV2OwnedFile(ownerKey, productionId, track.mediaPath),
          }));
        const result = await renderProductionV2Assembly({
          ownerKey,
          production: rendering,
          clipSources,
          musicTracks,
          sfxTracks,
        });
        const now = new Date().toISOString();
        const finalMedia = {
          id: `assembly-${randomUUID()}`,
          path: result.outputPath,
          previewUrl: `/api/production/v2/media?${new URLSearchParams({ productionId, final: "1" }).toString()}`,
          createdAt: now,
        };
        const saved = productionV2Store.save(ownerKey, {
          ...rendering,
          lifecycleStage: "assembly-rendered",
          assembly: { ...rendering.assembly, renderStatus: "rendered", finalMedia, userVerifiedAt: null },
        });
        return noStore({ ok: true, production: saved, finalMedia, probe: result.probe });
      } catch (error) {
        productionV2Store.save(ownerKey, updateProductionV2Assembly(rendering, { renderStatus: "failed", finalMedia: null, userVerifiedAt: null }));
        throw error;
      }
    }

    if (!sceneId || !versionId) return noStore({ ok: false, error: "sceneId and versionId are required" }, { status: 400 });
    const { version } = resolveProductionV2Version(production, sceneId, versionId);
    const sourcePath = assertProductionV2OwnedFile(ownerKey, productionId, version.mediaPath);

    if (action === "probe") {
      return noStore({ ok: true, probe: await probeProductionV2Media(sourcePath) });
    }

    if (action === "trim") {
      const result = await trimProductionV2Video({ ownerKey, productionId, sceneId, sourcePath, startSeconds: finite(body?.startSeconds), endSeconds: finite(body?.endSeconds) });
      return noStore({ ok: true, ...appendDerived({ ownerKey, productionId, sceneId, parentVersionId: version.id, outputPath: result.outputPath, versionType: "trimmed", sourceOperation: "ffmpeg-trim", metadata: { startSeconds: result.startSeconds, endSeconds: result.endSeconds, durationSeconds: result.probe.durationSeconds } }), probe: result.probe });
    }

    if (action === "volume") {
      const result = await adjustProductionV2Volume({ ownerKey, productionId, sceneId, sourcePath, volumePercent: finite(body?.volumePercent) });
      return noStore({ ok: true, ...appendDerived({ ownerKey, productionId, sceneId, parentVersionId: version.id, outputPath: result.outputPath, versionType: "audio-edit", sourceOperation: "ffmpeg-volume", metadata: { volumePercent: result.volumePercent } }), probe: result.probe });
    }

    if (action === "remove-background-music") {
      const result = await removeProductionV2BackgroundMusic({ ownerKey, productionId, sceneId, sourcePath });
      return noStore({ ok: true, ...appendDerived({ ownerKey, productionId, sceneId, parentVersionId: version.id, outputPath: result.outputPath, versionType: "audio-edit", sourceOperation: "demucs-remove-background-music", metadata: { separationModel: result.model } }), probe: result.probe });
    }

    if (action === "woosh-sfx") {
      const prompt = text(body?.prompt);
      const sfxVolume = body?.sfxVolume === undefined ? 80 : finite(body.sfxVolume);
      if (sfxVolume < 0 || sfxVolume > 200) return noStore({ ok: false, error: "Sound-effects volume must be between 0% and 200%." }, { status: 400 });

      const result = await generateProductionV2WooshSfx({
        ownerKey,
        productionId,
        sceneId,
        sourcePath,
        prompt,
        sfxVolume: sfxVolume / 100,
      });

      const derived = appendDerived({
        ownerKey,
        productionId,
        sceneId,
        parentVersionId: version.id,
        outputPath: result.outputPath,
        versionType: "audio-edit",
        sourceOperation: "woosh-vflow-sfx",
        metadata: {
          wooshModel: result.model,
          prompt: result.prompt,
          promptId: result.promptId,
          rawSfxAudioPath: result.rawSfxAudioPath,
          sfxVolumePercent: sfxVolume,
          generatedDurationSeconds: result.generatedDurationSeconds,
          durationWasCapped: result.durationWasCapped,
        },
      });

      const sfxTrackId = `sfx-${randomUUID()}`;
      const sfxTrack = {
        id: sfxTrackId,
        sceneId,
        sourceVersionId: version.id,
        mixedVersionId: derived.version.id,
        mediaPath: result.rawSfxAudioPath,
        previewUrl: `/api/production/v2/media?${new URLSearchParams({
          productionId,
          sfxTrackId,
        }).toString()}`,
        startSeconds: 0,
        endSeconds: Math.min(
          result.sourceDurationSeconds,
          result.generatedDurationSeconds,
        ),
        volume: sfxVolume / 100,
        model: result.model,
        prompt: result.prompt,
        promptId: result.promptId,
        sourceOperation: "woosh-vflow-sfx" as const,
      };

      const saved = productionV2Store.save(
        ownerKey,
        updateProductionV2Assembly(derived.production, {
          sfxTracks: [
            ...derived.production.assembly.sfxTracks,
            sfxTrack,
          ],
        }),
      );

      return noStore({
        ok: true,
        production: saved,
        version: derived.version,
        sfxTrack,
        probe: result.probe,
        provenance: result,
      });
    }

    return noStore({ ok: false, error: "Unsupported post-production action" }, { status: 400 });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({ ok: false, error: error instanceof Error ? error.message : "Post-production operation failed." }, { status: 500 });
  }
}
