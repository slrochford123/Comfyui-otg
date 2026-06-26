import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { getOwnerContext } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, safeJoin } from "@/lib/paths";
import { getQueuedContractJob, updateVoicePipelineJob } from "@/lib/jobs/voicePipelineJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LtxAudioProcessAction = "remove_background" | "enhance_voice";
type LtxAudioProcessProvider = "ltx" | "unnatural_ltx";

const LTX_AUDIO_PROCESS_OUTPUTS: Record<LtxAudioProcessAction, {
  fileName: "ltx-voice-isolated.wav" | "ltx-voice-enhanced.wav";
  pathKey: "isolatedAudioPath" | "enhancedAudioPath";
  urlKey: "isolatedAudioUrl" | "enhancedAudioUrl";
  successMessage: string;
  failureMessage: string;
}> = {
  remove_background: {
    fileName: "ltx-voice-isolated.wav",
    pathKey: "isolatedAudioPath",
    urlKey: "isolatedAudioUrl",
    successMessage: "Background sound/effects removal completed.",
    failureMessage: "Could not isolate voice. Original LTX audio is still available.",
  },
  enhance_voice: {
    fileName: "ltx-voice-enhanced.wav",
    pathKey: "enhancedAudioPath",
    urlKey: "enhancedAudioUrl",
    successMessage: "Voice enhancement completed.",
    failureMessage: "Voice enhancement failed. Previous audio is still available.",
  },
};

function jsonError(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { ok: false, error, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function safeSegment(value: unknown, fallback = "") {
  const text = String(value || fallback)
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return text || fallback;
}

function isBlockedOwner(value: string) {
  return !value || value === "profile_unresolved" || value === "web_characters_builder";
}

function isLtxAudioProvider(value: unknown): value is LtxAudioProcessProvider {
  return value === "ltx" || value === "unnatural_ltx";
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function resolveDataFilePath(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false as const, error: "Missing samplePath." };
  if (/^(https?:|blob:|data:)/i.test(raw)) {
    return { ok: false as const, error: "Remote, blob, and data URLs are not accepted for LTX audio processing." };
  }

  const dataRoot = path.resolve(OTG_DATA_ROOT);
  const resolved = path.resolve(path.isAbsolute(raw) ? raw : path.join(dataRoot, raw));
  const dataRootWithSep = dataRoot.endsWith(path.sep) ? dataRoot : dataRoot + path.sep;

  if (resolved !== dataRoot && !resolved.startsWith(dataRootWithSep)) {
    return { ok: false as const, error: "samplePath must be under the project data folder." };
  }

  return { ok: true as const, path: resolved };
}

function voiceSampleUrl(ownerKey: string, characterId: string, jobId: string, fileName: string) {
  const search = new URLSearchParams({
    owner: ownerKey,
    characterId,
    jobId,
    file: fileName,
  });
  return `/api/characters/voice-sample/file?${search.toString()}`;
}

function ffmpegArgsForAction(action: LtxAudioProcessAction, inputPath: string, outputPath: string) {
  // OTG_LTX_AUDIO_POST_PROCESSING: deterministic ffmpeg fallback for LTX sample cleanup/enhancement.
  const filter =
    action === "remove_background"
      ? "pan=mono|c0=0.5*c0+0.5*c1,highpass=f=110,lowpass=f=9000,afftdn=nf=-25,loudnorm=I=-18:TP=-1.5:LRA=10"
      : "pan=mono|c0=0.5*c0+0.5*c1,highpass=f=90,lowpass=f=11000,afftdn=nf=-20,acompressor=threshold=0.16:ratio=2.4:attack=5:release=80,dynaudnorm=f=150:g=9,loudnorm=I=-16:TP=-1.2:LRA=9";

  return [
    "-y",
    "-hide_banner",
    "-i",
    inputPath,
    "-vn",
    "-af",
    filter,
    "-ar",
    "48000",
    "-ac",
    "1",
    outputPath,
  ];
}

async function processLtxVoiceAudio(args: {
  action: LtxAudioProcessAction;
  inputPath: string;
  outputPath: string;
}) {
  const started = Date.now();
  const ffmpeg = resolveFfmpegPath();
  const result = await runCmd(ffmpeg, ffmpegArgsForAction(args.action, args.inputPath, args.outputPath), {
    timeoutMs: 5 * 60 * 1000,
  });
  const elapsedMs = Date.now() - started;

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "ffmpeg failed").slice(0, 2000));
  }

  if (!(await fileExists(args.outputPath))) {
    throw new Error("ffmpeg completed but did not create output audio.");
  }

  console.info("[OTG_LTX_AUDIO_POST_PROCESSING]", {
    action: args.action,
    inputPath: args.inputPath,
    outputPath: args.outputPath,
    method: "ffmpeg-fallback",
    elapsedMs,
  });

  return { method: "ffmpeg-fallback", elapsedMs };
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  let requestedAction: LtxAudioProcessAction | "" = "";
  try {
    // OTG_LTX_PROCESS_JSON_BODY: parse from a clone because owner resolution may inspect the original JSON body.
    const body = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return jsonError("Missing JSON body.");

    const owner = await getOwnerContext(req);
    const ownerKey = safeSegment(owner.ownerKey);
    if (isBlockedOwner(ownerKey)) {
      return jsonError("Resolved owner is not allowed to process LTX voice samples.", 409);
    }

    const provider = String(body.provider || "").trim();
    if (!provider) return jsonError("Missing required field: provider", 400);
    if (!isLtxAudioProvider(provider)) {
      return jsonError("Only LTX or Unnatural LTX voice samples can be post-processed here.", 400);
    }

    if (!String(body.action || "").trim()) return jsonError("Missing required field: action", 400);
    const action = String(body.action || "") as LtxAudioProcessAction;
    requestedAction = action;
    const config = LTX_AUDIO_PROCESS_OUTPUTS[action];
    if (!config) {
      return jsonError("Invalid LTX audio processing action.", 400);
    }

    if (!String(body.samplePath || "").trim()) return jsonError("Missing required field: samplePath", 400);
    if (!String(body.characterId || "").trim()) return jsonError("Missing required field: characterId", 400);
    const characterId = safeSegment(body.characterId, "character");
    const jobId = safeSegment(body.jobId, "");
    if (!jobId) return jsonError("Missing required field: jobId", 400);

    const job = getQueuedContractJob(ownerKey, jobId);
    if (!job) return jsonError("LTX voice sample job was not found for this owner.", 404);
    if (job.action !== "create_voice_sample") return jsonError("Job is not a voice sample creation job.", 400);

    const result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
      ? job.result as Record<string, unknown>
      : {};
    if (!isLtxAudioProvider(result.provider) || result.mock !== false || result.provider !== provider) {
      return jsonError("Only real completed LTX or Unnatural LTX voice samples can be post-processed.", 400);
    }

    const resolvedInput = resolveDataFilePath(
      action === "enhance_voice"
        ? body.samplePath || result.isolatedAudioPath || result.uploadedSamplePath || result.samplePath
        : body.samplePath || result.uploadedSamplePath || result.samplePath,
    );
    if (!resolvedInput.ok) return jsonError(resolvedInput.error, 400);
    if (!(await fileExists(resolvedInput.path))) {
      return jsonError("Input LTX audio file does not exist.", 404);
    }

    const outputDir = safeJoin(OTG_DATA_ROOT, "characters", ownerKey, "voice-samples", characterId, jobId);
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = safeJoin(outputDir, config.fileName);
    const method = await processLtxVoiceAudio({ action, inputPath: resolvedInput.path, outputPath });
    const audioUrl = voiceSampleUrl(ownerKey, characterId, jobId, config.fileName);

    const patch = {
      ...result,
      provider,
      mock: false,
      [config.pathKey]: outputPath,
      [config.urlKey]: audioUrl,
      ltxAudioPostProcessing: {
        ...((result.ltxAudioPostProcessing && typeof result.ltxAudioPostProcessing === "object" && !Array.isArray(result.ltxAudioPostProcessing))
          ? result.ltxAudioPostProcessing as Record<string, unknown>
          : {}),
        [action]: {
          path: outputPath,
          url: audioUrl,
          method: method.method,
          elapsedMs: method.elapsedMs,
          processedAt: new Date().toISOString(),
        },
      },
    };

    const updatedJob = updateVoicePipelineJob(ownerKey, jobId, {
      status: "completed",
      progress: 100,
      message: config.successMessage,
      result: patch,
    });

    return NextResponse.json({
      ok: true,
      action,
      provider,
      mock: false,
      audioPath: outputPath,
      audioUrl,
      method: method.method,
      elapsedMs: Date.now() - started,
      message: config.successMessage,
      job: updatedJob,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackMessage = requestedAction && LTX_AUDIO_PROCESS_OUTPUTS[requestedAction]
      ? LTX_AUDIO_PROCESS_OUTPUTS[requestedAction].failureMessage
      : "LTX audio post-processing failed.";
    console.warn("[OTG_LTX_AUDIO_POST_PROCESSING] failed", { message });
    return jsonError(fallbackMessage, 500, { detail: message.slice(0, 1000) });
  }
}
