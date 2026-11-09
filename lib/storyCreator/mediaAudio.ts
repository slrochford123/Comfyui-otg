import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { capabilities, cancelJob, reconcileJob, sessionJobs, startJob } from "@/lib/audioEditing/jobs";
import { assetFile, createSession, readSession, saveSession, sessionRoot } from "@/lib/audioEditing/store";
import { resolveFfprobePath } from "@/lib/ffmpeg";
import { updateStoryMedia, type StoryMediaRecord } from "./mediaStore";

import { storyElevenLabsConfigured } from "./mediaVoiceProviders";
const exec = promisify(execFile);
export function requireStoryAudioEngine(operation: "music" | "effects") {
  const caps = capabilities("story");
  if (storyElevenLabsConfigured()) return caps;
  if (!(process.env.OTG_ENV === "test" || process.env.OTG_ENV === "prod" && process.env.OTG_STORY_AUDIO_PROD === "1") || !caps.enabled ||
    !Object.values(caps.engines[operation] || {}).some(Boolean) ||
    (operation === "music" && caps.musicEngine !== "yue2")) {
    throw Error(operation === "music" ? "YuE2 is unavailable on this deployment." : "Sony Woosh is unavailable on this deployment.");
  }
  return caps;
}

export async function submitStoryAudio(record: StoryMediaRecord, video?: string) {
  const operation = record.command.operation;
  if (operation !== "music" && operation !== "effects") throw Error("This is not a Story audio request.");
  const caps = requireStoryAudioEngine(operation);
  const maxMusic = caps.musicMaxSeconds ?? 120;
  let seconds = record.command.durationSeconds || (operation === "music" ? 30 : 5);
  if (operation === "music" && (seconds < 10 || seconds > maxMusic))
    throw Error(`Choose a YuE2 duration from 10 to ${maxMusic} seconds.`);
  if (video) {
    const probe = await exec(resolveFfprobePath(), ["-v","error","-show_entries","format=duration","-of","csv=p=0",video], {timeout:10000});
    const duration = Number(probe.stdout.trim());
    if (!Number.isFinite(duration) || duration < .1) throw Error("The selected video has no usable duration.");
    seconds = record.command.durationSeconds || duration;
    if (seconds > duration + .03) throw Error("Sound effects cannot extend past the selected clip.");
  }
  if (operation === "effects" && (seconds < .1 || seconds > 30))
    throw Error("Choose a sound-effect preview from 0.1 to 30 seconds.");
  const session = createSession(record.ownerKey);
  session.title = record.command.name || (operation === "music" ? "Story music" : "Story sound effect");
  saveSession(record.ownerKey,session);
  // Save the session before dispatch so refresh can find the exact job after an interrupted response.
  const pending = updateStoryMedia(record,{status:"running",backendJob:{audioSessionId:session.id,engine:operation==="music"?"YuE2":"Sony Woosh"}});
  if(pending.status!=="running")return;
  let source: string | undefined;
  if (video) {
    source=path.join(sessionRoot(record.ownerKey,session.id),"story-source"+path.extname(video));
    fs.copyFileSync(video,source,fs.constants.COPYFILE_EXCL);
  }
  const job = await startJob(record.ownerKey,session.id,operation,source,{
    seconds, seed:randomInt(0,2**31),
    ...(operation==="effects"?{mode:video?"automatic":"manual"}:{}),
    prompt:record.command.prompt.slice(0,1900),
  },"auto","story");
  updateStoryMedia(pending,{backendJob:{...pending.backendJob,audioJobId:job.id,gpu:job.gpu}});
}

export function storyAudioJob(record: StoryMediaRecord) {
  const sessionId = String(record.backendJob?.audioSessionId || "");
  if (!sessionId) return null;
  const id = String(record.backendJob?.audioJobId || "");
  const state = id ? reconcileJob(record.ownerKey,sessionId,id) : sessionJobs(record.ownerKey,sessionId)[0];
  return state ? {sessionId,state} : null;
}

export function storyAudioOutput(record: StoryMediaRecord, sessionId: string, assets: NonNullable<ReturnType<typeof reconcileJob>["assets"]>) {
  const output = assets.find(a=>a.kind==="audio" && a.suggestedLane===(record.command.operation==="music"?"music":"effects"));
  if (!output || !Number.isFinite(output.duration) || output.duration<=0) throw Error("The audio worker returned no usable result.");
  return {path:assetFile(record.ownerKey,readSession(record.ownerKey,sessionId),output.id),duration:output.duration,license:output.license};
}

export function cancelStoryAudio(record: StoryMediaRecord) {
  const job = storyAudioJob(record);
  if (!job) throw Error("Waiting for the original audio job ID.");
  return cancelJob(record.ownerKey,job.sessionId,job.state.id);
}
