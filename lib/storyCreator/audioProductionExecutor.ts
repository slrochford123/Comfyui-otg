import fs from "node:fs";
import path from "node:path";

import { probeDurationSeconds } from "@/lib/ffmpeg";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { downloadH3VideoFromBaseUrl, getH3PromptHistoryFromBaseUrl } from "@/lib/production/h3Comfy";
import {
  claimStoryAudioAssetExecution,
  getStoryAudioAsset,
  listStoryAudioAssets,
  listStoryVoiceAssignments,
  recordStoryAudioResult,
} from "@/lib/storyCreator/audioProduction";
import { getStoryVideoTake, recordStoryAudioDrivenVideoTake } from "@/lib/storyCreator/videoProduction";
import { getStoryVisualVersion } from "@/lib/storyCreator/store";
import { loadVoicesLibrary, resolveVoicesFile } from "@/lib/voicesStudio";
import type { StoryAudioAsset } from "@/lib/storyCreator/audioProductionTypes";

type DispatchContext = {
  ownerKey: string;
  projectId: string;
  assetId: string;
  cookie: string;
};

const active = new Set<string>();

function localOrigin() {
  const port = String(process.env.PORT || "3001").replace(/[^0-9]/g, "") || "3001";
  return `http://127.0.0.1:${port}`;
}

async function providerRequest(endpoint: string, cookie: string, init: RequestInit) {
  const response = await fetch(`${localOrigin()}${endpoint}`, {
    ...init,
    headers: { ...(init.headers || {}), cookie },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    throw new Error(String(payload.error || `Provider request failed (${response.status}).`));
  }
  return payload;
}

function requireFile(filePath: string | null | undefined, label: string) {
  const resolved = path.resolve(String(filePath || ""));
  if (!filePath || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label} was not found.`);
  }
  return resolved;
}

function acceptedVideoPath(context: DispatchContext, asset: StoryAudioAsset) {
  if (!asset.videoTakeId) throw new Error("Select an accepted video take before running this audio operation.");
  const take = getStoryVideoTake({ ...context, takeId: asset.videoTakeId });
  if (take.status !== "accepted") throw new Error("The selected video take is not accepted.");
  return requireFile(take.outputPath, "The accepted video take");
}

function ownedAudioSources(context: DispatchContext, asset: StoryAudioAsset) {
  const selected = new Set(asset.sourceAssetIds);
  return listStoryAudioAssets(context)
    .filter((candidate) => selected.has(candidate.id))
    .filter((candidate) => ["completed", "accepted", "rejected"].includes(candidate.status))
    .map((candidate) => ({ asset: candidate, filePath: requireFile(candidate.outputPath, "A source audio asset") }));
}

function approvedImagePath(context: DispatchContext, versionId: unknown) {
  const version = getStoryVisualVersion({ ...context, versionId });
  if (version.status !== "approved") throw new Error("Select an approved visual asset owned by this Story project.");
  return requireFile(version.filePath, "The approved visual asset");
}

async function finishAudio(context: DispatchContext, asset: StoryAudioAsset, outputPath: string, externalJobId?: unknown) {
  const verified = requireFile(outputPath, "Provider output");
  const durationSeconds = await probeDurationSeconds(verified).catch(() => null);
  return recordStoryAudioResult({
    ...context,
    status: "completed",
    outputPath: verified,
    durationSeconds: durationSeconds ?? asset.durationSeconds,
    externalJobId,
  });
}

async function executeSpeech(context: DispatchContext, asset: StoryAudioAsset) {
  const assignment = listStoryVoiceAssignments(context).find((item) => item.id === asset.voiceAssignmentId);
  if (!assignment?.authorizedReference) throw new Error("The assigned voice reference is not authorized.");
  const voice = loadVoicesLibrary(context.ownerKey).voices.find((item) => item.voiceId === assignment.voiceId);
  if (!voice) throw new Error("The assigned voice no longer exists in this user's voice library.");
  const form = new FormData();
  form.set("text", asset.exactText);
  form.set("provider", asset.providerContract.provider === "omnivoice" ? "omnivoice" : "indextts2");
  form.set("voice_sample_path", resolveVoicesFile(voice.refAudioRel));
  form.set("model_name", assignment.voiceName);
  form.set("title", `${asset.speakerName || "narration"}_${asset.id}`);
  form.set("emotion", asset.emotion || asset.delivery || "serious");
  form.set("speed", String(asset.providerContract.request.speed || 1));
  const result = await providerRequest("/api/voice/tts", context.cookie, { method: "POST", body: form });
  return finishAudio(context, asset, String(result.audioPath || ""), result.jobId);
}

async function executeMusic(context: DispatchContext, asset: StoryAudioAsset) {
  const request = asset.providerContract.request;
  const result = await providerRequest("/api/production/background-audio/ace-generate", context.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: asset.prompt,
      durationSeconds: request.durationSeconds,
      bpm: request.bpm,
      keyScale: request.keyScale,
      lyrics: request.lyrics,
      productionId: `story-${asset.projectId}`,
    }),
  });
  return finishAudio(context, asset, String(result.audioPath || ""), result.taskId);
}

async function executeSoundEffect(context: DispatchContext, asset: StoryAudioAsset) {
  const videoPath = acceptedVideoPath(context, asset);
  const form = new FormData();
  form.set("prompt", asset.prompt);
  form.set("durationSeconds", String(asset.durationSeconds || asset.shotDurationSeconds));
  form.set("keepOriginalAudio", asset.keepOriginalAudio ? "1" : "0");
  form.set("video_source", "upload");
  form.set("title", `story_${asset.id}`);
  form.set("video_file", new File([fs.readFileSync(videoPath)], path.basename(videoPath), { type: "video/mp4" }));
  const result = await providerRequest("/api/edit-video/woosh-sfx", context.cookie, { method: "POST", body: form });
  const outputPath = path.join(
    OTG_DATA_ROOT,
    "edit_video_jobs",
    safeSegment(context.ownerKey),
    String(result.jobId || ""),
    String(result.fileName || ""),
  );
  return finishAudio(context, asset, outputPath, result.promptId || result.jobId);
}

async function executeMixOrEnhancement(context: DispatchContext, asset: StoryAudioAsset) {
  const videoPath = acceptedVideoPath(context, asset);
  const endpoint = asset.kind === "mix" ? "/api/edit-video/audio-mix" : "/api/edit-video/enhance-audio";
  const sources = ownedAudioSources(context, asset);
  if (asset.kind === "mix" && !sources.length) throw new Error("Select a completed owned audio asset before mixing.");
  const body = asset.kind === "mix"
    ? { video: videoPath, music: sources[0].filePath }
    : { videoPath };
  const result = await providerRequest(endpoint, context.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return finishAudio(context, asset, String(result.output || ""));
}

async function executeLipSync(context: DispatchContext, asset: StoryAudioAsset) {
  const request = asset.providerContract.request;
  acceptedVideoPath(context, asset);
  const imagePath = approvedImagePath(context, request.visualVersionId);
  const sources = ownedAudioSources(context, asset);
  const audio = sources.find((source) => source.asset.id === String(request.audioAssetId || ""));
  if (!audio) throw new Error("Select a completed dialogue asset owned by this Story project.");
  const form = new FormData();
  form.set("workflowId", "production-lipsync-image-to-video");
  form.set("workflowFile", "production-lipsync.json");
  form.set("workflowLabel", "Storyteller Audio-Driven Video");
  form.set("requestKind", "story-audio-driven-video");
  form.set("prompt", asset.prompt);
  form.set("durationSeconds", String(asset.durationSeconds || asset.shotDurationSeconds));
  form.set("imageA", new File([fs.readFileSync(imagePath)], path.basename(imagePath)));
  form.set("audioA", new File([fs.readFileSync(audio.filePath)], path.basename(audio.filePath)));
  const result = await providerRequest("/api/comfy", context.cookie, { method: "POST", body: form });
  const promptId = String(result.prompt_id || result.promptId || "");
  if (!promptId) throw new Error("LTX accepted the request without returning a trackable prompt id.");
  recordStoryAudioResult({ ...context, status: "running", externalJobId: promptId });
  const videoBackend = result.videoBackend as { baseUrl?: unknown } | null;
  const baseUrl = String(videoBackend?.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("LTX submitted successfully, but its selected Comfy backend was not returned for completion tracking.");
  const timeoutMs = Math.max(60_000, Number(process.env.STORY_AUDIO_LIPSYNC_TIMEOUT_MS || 1_800_000));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const history = await getH3PromptHistoryFromBaseUrl(baseUrl, promptId, fetch, "75");
    if (history.state === "failed") throw new Error("LTX audio-driven video generation failed in ComfyUI.");
    if (history.state === "completed" && history.video) {
      const outputPath = await downloadH3VideoFromBaseUrl({
        baseUrl,
        file: history.video,
        ownerKey: context.ownerKey,
        productionId: `story-${asset.projectId}`,
        sceneId: asset.sceneId,
        generationJobId: asset.jobId || asset.id,
        artifactSuffix: "audio-driven",
      });
      const derived = recordStoryAudioDrivenVideoTake({
        ...context,
        sourceTakeId: asset.videoTakeId,
        outputPath,
        prompt: asset.prompt,
        externalJobId: promptId,
        idempotencyKey: `story-audio-derived:${asset.id}`,
      });
      return recordStoryAudioResult({
        ...context,
        status: "completed",
        outputPath,
        durationSeconds: asset.durationSeconds,
        derivedVideoTakeId: derived.id,
        externalJobId: promptId,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("LTX audio-driven video timed out before a verified output was available.");
}

export async function executeStoryAudioAsset(context: DispatchContext) {
  const executionKey = `${context.ownerKey}:${context.assetId}`;
  if (active.has(executionKey)) return getStoryAudioAsset(context);
  active.add(executionKey);
  try {
    const claim = claimStoryAudioAssetExecution(context);
    if (!claim.claimed) return claim.asset;
    const asset = claim.asset;
    if (asset.kind === "dialogue" || asset.kind === "narration") return await executeSpeech(context, asset);
    if (asset.kind === "music") return await executeMusic(context, asset);
    if (asset.kind === "sound-effect" || asset.kind === "ambience") return await executeSoundEffect(context, asset);
    if (asset.kind === "mix" || asset.kind === "enhancement") return await executeMixOrEnhancement(context, asset);
    return await executeLipSync(context, asset);
  } catch (error) {
    return recordStoryAudioResult({
      ...context,
      status: "failed",
      error: error instanceof Error ? error.message : "Audio provider execution failed.",
    });
  } finally {
    active.delete(executionKey);
  }
}

export function dispatchStoryAudioAssets(input: Omit<DispatchContext, "assetId"> & { assetIds: string[] }) {
  const assetIds = [...new Set(input.assetIds)].slice(0, 20);
  setImmediate(async () => {
    for (const assetId of assetIds) {
      await executeStoryAudioAsset({ ...input, assetId });
    }
  });
}
