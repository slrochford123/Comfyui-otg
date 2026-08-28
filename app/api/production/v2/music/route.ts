import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, safeJoin, safeSegment } from "@/lib/paths";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";
import { assertProductionV2OwnedFile, probeProductionV2Media, productionV2Root, resolveProductionV2Version } from "@/lib/production/postProduction";
import { updateProductionV2Assembly } from "@/lib/production/v2";
import { productionV2Store } from "@/lib/production/v2Store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MUSIC3_BASE_URL = String(process.env.MINIMAX_MUSIC3_BASE_URL || "http://127.0.0.1:8005").trim().replace(/\/+$/, "");

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, { ...init, headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) } });
}

async function fetchMusic3(pathname: string, init?: RequestInit, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${MUSIC3_BASE_URL}${pathname}`, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function assemblyDuration(ownerKey: string, productionId: string) {
  const production = productionV2Store.load(ownerKey, productionId);
  if (!production) throw new Error("Production not found.");
  let duration = 0;
  for (const clip of [...production.assembly.clips].sort((left, right) => left.order - right.order)) {
    if (!clip.mediaVersionId) continue;
    const resolved = resolveProductionV2Version(production, clip.sceneId, clip.mediaVersionId);
    const sourcePath = assertProductionV2OwnedFile(ownerKey, productionId, resolved.version.mediaPath);
    duration += (await probeProductionV2Media(sourcePath)).durationSeconds;
  }
  return Math.max(30, Math.min(300, duration || 30));
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const productionId = String(body?.productionId || "").trim();
    const prompt = String(body?.prompt || "").trim();
    if (!productionId || !prompt) return noStore({ ok: false, error: "productionId and a music description are required." }, { status: 400 });
    const production = productionV2Store.load(ownerKey, productionId);
    if (!production) return noStore({ ok: false, error: "Production not found." }, { status: 404 });
    if (production.status !== "draft") return noStore({ ok: false, error: "Completed Productions are read-only." }, { status: 409 });
    const health = await fetchMusic3("/health");
    const healthPayload = await health.json().catch(() => null) as { ok?: boolean; model?: string } | null;
    if (!health.ok || !healthPayload?.ok || healthPayload.model !== "MiniMaxAI/MiniMax-Music3") {
      return noStore({ ok: false, error: "The local MiniMax Music 3.0 service is not ready." }, { status: 503 });
    }
    const duration = await assemblyDuration(ownerKey, productionId);
    const form = new FormData();
    form.set("prompt", prompt);
    form.set("lyrics", "[Instrumental]");
    form.set("duration", duration.toFixed(3));
    form.set("seed", "-1");
    const response = await fetchMusic3("/generate", { method: "POST", body: form }, 60_000);
    const payload = await response.json().catch(() => null) as { id?: string; status?: string; seed?: number; detail?: string } | null;
    if (!response.ok || !payload?.id) return noStore({ ok: false, error: payload?.detail || `MiniMax Music 3.0 rejected the request (${response.status}).` }, { status: response.status || 500 });
    const saved = productionV2Store.save(ownerKey, updateProductionV2Assembly(production, {
      musicGeneration: { status: "generating", prompt, generationId: payload.id, requestedDurationSeconds: duration, error: null },
    }));
    return noStore({ ok: true, production: saved, generation: saved.assembly.musicGeneration }, { status: 202 });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({ ok: false, error: error instanceof Error ? error.message : "MiniMax Music 3.0 request failed." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const productionId = String(req.nextUrl.searchParams.get("productionId") || "").trim();
    const production = productionId ? productionV2Store.load(ownerKey, productionId) : null;
    if (!production) return noStore({ ok: false, error: "Production not found." }, { status: 404 });
    const generation = production.assembly.musicGeneration;
    if (!generation.generationId) return noStore({ ok: true, production, generation });
    const response = await fetchMusic3(`/job/${encodeURIComponent(generation.generationId)}`);
    const state = await response.json().catch(() => null) as { status?: string; error?: string; seed?: number } | null;
    if (!response.ok || !state) return noStore({ ok: false, error: "Could not read MiniMax Music 3.0 generation status." }, { status: 502 });
    if (state.status === "failed") {
      const saved = productionV2Store.save(ownerKey, updateProductionV2Assembly(production, { musicGeneration: { ...generation, status: "failed", error: state.error || "MiniMax Music 3.0 generation failed." } }));
      return noStore({ ok: true, production: saved, generation: saved.assembly.musicGeneration });
    }
    if (state.status !== "complete") return noStore({ ok: true, production, generation: { ...generation, status: "generating" } });
    const existing = production.assembly.musicTracks.find((track) => track.generationId === generation.generationId);
    if (existing) return noStore({ ok: true, production, generation: { ...generation, status: "ready" }, track: existing });
    const audioResponse = await fetchMusic3(`/audio/${encodeURIComponent(generation.generationId)}`, undefined, 120_000);
    if (!audioResponse.ok) return noStore({ ok: false, error: "MiniMax Music 3.0 completed but its audio could not be downloaded." }, { status: 502 });
    const musicRoot = safeJoin(productionV2Root(ownerKey, productionId), "assembly", "music");
    ensureDir(musicRoot);
    const trackId = `music-${randomUUID()}`;
    const mediaPath = safeJoin(musicRoot, `${safeSegment(generation.generationId)}.wav`);
    await fsp.writeFile(mediaPath, Buffer.from(await audioResponse.arrayBuffer()));
    const track = {
      id: trackId,
      mediaPath,
      previewUrl: `/api/production/v2/media?${new URLSearchParams({ productionId, musicTrackId: trackId }).toString()}`,
      startSeconds: 0,
      endSeconds: null,
      volume: 0.3,
      fadeInSeconds: 2,
      fadeOutSeconds: 2,
      model: "MiniMax Music 3.0" as const,
      prompt: generation.prompt,
      generationId: generation.generationId,
    };
    const saved = productionV2Store.save(ownerKey, updateProductionV2Assembly(production, {
      musicTracks: [...production.assembly.musicTracks, track],
      musicGeneration: { ...generation, status: "ready", error: null },
    }));
    return noStore({ ok: true, production: saved, generation: saved.assembly.musicGeneration, track });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({ ok: false, error: error instanceof Error ? error.message : "MiniMax Music 3.0 status failed." }, { status: 500 });
  }
}
