import {requireTestLab} from "@/lib/experiments/store";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getGallerySourcesForRequest } from "@/lib/gallery";
import { getH3DirectJob, saveH3DirectJobToGallery } from "@/lib/h3DirectJobs";
import type { H3VoiceAcceptedTake, H3VoiceSequence, H3VoiceSequenceDraft } from "@/lib/h3CharacterVoiceSequence";
import { readH3StudioJson } from "@/lib/h3StudioRequests";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { RequestError, withOwner } from "@/lib/routeSecurity";
import { requireTestingVoiceTools } from "@/lib/testingVoiceToolsAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Checkpoint = Omit<H3VoiceSequence, "accepted">;
const jobIdPattern = /^h3-direct-[\da-f-]{36}$/;
const nothing: Checkpoint = { draft: null };

function directory(owner: string) {
  return path.join(OTG_DATA_ROOT, "h3-character-voices", safeSegment(owner), "sequence");
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(file: string, data: unknown, once = false) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + "." + randomUUID() + ".part";
  try {
    await fs.writeFile(temporary, JSON.stringify(data), { flag: "wx", mode: 0o600 });
    if (!once) {
      await fs.rename(temporary, file);
    } else {
      try { await fs.link(temporary, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function optionalToken(value: unknown, limit: number) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > limit || /[\x00-\x1f]/.test(value)) throw new RequestError("The saved scene has an invalid asset identifier.", 400);
  return value;
}

function readDraft(value: unknown): H3VoiceSequenceDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("A scene draft is required.", 400);
  const input = value as Record<string, unknown>;
  const { mode, recipe, durationSeconds, prompt, seed, checkpointMode } = input;
  if (!["h3-reference-to-video", "h3-image-to-video", "h3-text-to-video"].includes(String(mode)) ||
      !["auto", "native", "visual-refmod", "visual-refmod-wav", "combined-refmod", "fix-voices"].includes(String(recipe)) ||
      (durationSeconds !== 5 && durationSeconds !== 10) ||
      (checkpointMode !== undefined && checkpointMode !== "standard" &&
        (checkpointMode !== "singularity-v1.3" || mode !== "h3-reference-to-video")) ||
      typeof prompt !== "string" || prompt.length > 4000 ||
      (seed !== undefined && (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0)) ||
      !Array.isArray(input.cast) || input.cast.length > 3) throw new RequestError("Review the scene settings before saving.", 400);
  const cast = input.cast.map(slot => {
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) throw new RequestError("Choose existing Character Cards.", 400);
    const characterId = optionalToken(slot.characterId, 160);
    if (!characterId) throw new RequestError("Choose a Character Card.", 400);
    return { characterId, voiceId: optionalToken(slot.voiceId, 240), visualRefMod: optionalToken(slot.visualRefMod, 360), audioRefMod: optionalToken(slot.audioRefMod, 360) };
  });
  if (new Set(cast.map(slot => slot.characterId)).size !== cast.length) throw new RequestError("Choose different Character Cards.", 400);
  const openingTakeId = optionalToken(input.openingTakeId, 60);
  if (openingTakeId && !jobIdPattern.test(openingTakeId)) throw new RequestError("That opening take cannot be resumed.", 400);
  let firstImage: H3VoiceSequenceDraft["firstImage"];
  if (input.firstImage) {
    const frame = input.firstImage as Record<string, unknown>;
    const id = optionalToken(frame.id, 128), name = optionalToken(frame.name, 240), type = optionalToken(frame.type, 60);
    if (!id || !name || frame.kind !== "image" || typeof frame.size !== "number" || !Number.isSafeInteger(frame.size) || frame.size <= 0) {
      throw new RequestError("The saved opening frame is invalid. Choose it again.", 400);
    }
    firstImage = { id, name, kind: "image", size: frame.size, type: type || "" };
  }
  return { mode: mode as H3VoiceSequenceDraft["mode"], recipe: recipe as H3VoiceSequenceDraft["recipe"],
    cast, durationSeconds, prompt, stylePresetId: optionalToken(input.stylePresetId, 120) || "none",
    seed: seed as number | undefined, checkpointMode: checkpointMode as H3VoiceSequenceDraft["checkpointMode"], firstImage, openingTakeId };
}

function acceptedPath(root: string, id: string) {
  return path.join(root, "accepted", id + ".json");
}

async function ownedJob(owner: string, id: unknown) {
  if (typeof id !== "string" || !jobIdPattern.test(id)) throw new RequestError("That H3 take is unavailable.", 404);
  const job = await getH3DirectJob(owner, id);
  if (!job?.input.characterVoices) throw new RequestError("That H3 Character Voices take is unavailable.", 404);
  return job;
}

async function sequence(root: string): Promise<H3VoiceSequence> {
  const [checkpoint, names] = await Promise.all([
    readJson<Checkpoint>(path.join(root, "draft.json")),
    fs.readdir(path.join(root, "accepted")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    }),
  ]);
  const accepted = (await Promise.all(names.filter(name => name.endsWith(".json") && jobIdPattern.test(name.slice(0, -5)))
    .map(name => readJson<H3VoiceAcceptedTake>(path.join(root, "accepted", name)))))
    .filter((take): take is H3VoiceAcceptedTake => !!take)
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt));
  return { ...(checkpoint || nothing), accepted };
}

export const GET = withOwner(async (request, owner) => {
  requireTestLab();
  await requireTestingVoiceTools(request);
  return NextResponse.json({ ok: true, ...await sequence(directory(owner.ownerKey)) });
});

export const POST = withOwner(async (request, owner) => {
  requireTestLab();
  await requireTestingVoiceTools(request);
  const body = await readH3StudioJson(request, 28_000);
  const root = directory(owner.ownerKey);
  const checkpointFile = path.join(root, "draft.json");
  const draft = readDraft(body.draft);
  if (body.action === "checkpoint") {
    const activeJobId = body.activeJobId ? (await ownedJob(owner.ownerKey, body.activeJobId)).id : undefined;
    let submission: Checkpoint["submission"];
    if (body.submission) {
      const data = body.submission as Record<string, unknown>;
      if (typeof data.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.requestId) ||
          typeof data.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint)) throw new RequestError("Invalid scene submission receipt.", 400);
      submission = { requestId: data.requestId, fingerprint: data.fingerprint };
    }
    await writeJson(checkpointFile, { draft, activeJobId, submission });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "accept") {
    const job = await ownedJob(owner.ownerKey, body.jobId);
    if (job.status !== "completed" || !job.outputPath) throw new RequestError("Review the completed take before keeping it.", 409);
    const nextDraft = readDraft(body.nextDraft);
    const attempts = job.input.characterVoices!.bindings;
    if (job.input.mode !== draft.mode || job.input.durationSeconds !== draft.durationSeconds ||
        job.input.seed !== draft.seed || (job.input.h3Settings?.checkpointMode || "standard") !== (draft.checkpointMode || "standard") || attempts.length !== draft.cast.length ||
        attempts.some((binding, index) => binding.characterId !== draft.cast[index].characterId)) {
      throw new RequestError("This draft does not match the completed take. Reopen the take and try again.", 409);
    }
    if (!await readJson<H3VoiceAcceptedTake>(acceptedPath(root, job.id))) {
      const { sources } = await getGallerySourcesForRequest(request);
      const target = sources.find(source => source.scope === "user" && source.ownerKey === owner.ownerKey);
      if (!target) throw new RequestError("Your Gallery is unavailable.", 404);
      const saved = await saveH3DirectJobToGallery(job, target);
      const take: H3VoiceAcceptedTake = {
        jobId: job.id, title: draft.prompt.split("\n", 1)[0].slice(0, 90) || "Accepted take",
        acceptedAt: new Date().toISOString(), galleryUrl: saved.url, draft,
      };
      await writeJson(acceptedPath(root, job.id), take, true);
    }
    await writeJson(checkpointFile, { draft: nextDraft });
    return NextResponse.json({ ok: true, ...await sequence(root) });
  }
  throw new RequestError("Choose a scene checkpoint action.", 400);
});
