import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createCharacter, loadCharacter } from "@/lib/characters/store";
import { h3ContinuationEnabled } from "@/lib/h3ContinuationAvailability";
import { getH3DirectJob } from "@/lib/h3DirectJobs";
import { H3_CONTINUATION_MODES, type H3ContinuationReview } from "@/lib/h3ContinuationContract";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { RequestError } from "@/lib/requestError";
import type { SessionUser } from "@/lib/sessionUser";
import { extractFinalFrameToImage } from "@/lib/videoFrame";
import { act, folder, locked, mediaFile, newWorkspace, read, refresh, write } from "@/lib/videoCharacters/store";
import type { Workspace } from "@/lib/videoCharacters/contract";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function workspaceOwner(user: SessionUser) {
  if (!h3ContinuationEnabled()) throw new RequestError("Not found.", 404);
  if (!user.accountId || user.scope !== "user") throw new RequestError("Sign in to continue a scene.", 401);
  return user.accountId;
}

async function getWorkspace(owner: string, id: string) {
  if (!uuid.test(id)) throw new RequestError("Invalid continuation workspace.", 400);
  const workspace = await read(owner, id);
  if (!workspace.continuation) throw new RequestError("Continuation not found.", 404);
  return workspace;
}

export async function startH3Continuation(user: SessionUser, jobId: unknown) {
  const owner = workspaceOwner(user);
  const id = typeof jobId === "string" && jobId.startsWith("h3-direct-") ? jobId.slice("h3-direct-".length) : "";
  const job = uuid.test(id) ? await getH3DirectJob(user.ownerKey, String(jobId)) : null;
  if (!job?.outputPath || job.status !== "completed" || job.ownerKey !== user.ownerKey ||
      !H3_CONTINUATION_MODES.some(mode => mode === job.input.mode) || job.input.videoEdit ||
      job.input.studioMedia?.simpleEdit || job.input.studioPlan?.workflowId === "reference-edit") {
    throw new RequestError("Completed H3 scene not found.", 404);
  }
  const source = await fs.realpath(job.outputPath).catch(() => null);
  const root = await fs.realpath(OTG_DATA_ROOT);
  if (!source?.startsWith(root + path.sep)) throw new RequestError("Completed H3 video is unavailable.", 404);
  return locked(owner, id, async () => {
    const existing = await read(owner, id).catch(() => null);
    if (existing?.continuation?.jobId === job.id) return existing;
    const continuation = {
      jobId: job.id,
      mode: job.input.mode,
      prompt: (job.input.smartReferences?.originalPrompt || job.input.prompt).slice(0, 6000),
      stylePresetId: job.input.directorContext?.stylePresetId || "none",
      orientation: job.input.orientation,
      directorConversationId: job.input.directorContext?.conversationId,
      directorSynopsis: job.input.directorContext?.synopsis,
      refMods: job.input.smartReferences?.refMods,
    };
    try {
      return await newWorkspace(owner, `H3 scene ${job.id}`, source, "", [], {id, continuation, libraryOwner: user.ownerKey});
    } catch (error) {
      // The derived directory belongs to this source and was never published.
      if (!existing) await fs.rm(folder(owner, id), {recursive: true, force: true});
      throw error;
    }
  });
}

export async function readH3Continuation(user: SessionUser, id: string, file?: string) {
  const owner = workspaceOwner(user);
  return locked(owner, id, async () => {
    const workspace = await getWorkspace(owner, id);
    if (file) return { workspace, media: await mediaFile(workspace, file) };
    return { workspace: await refresh(workspace), media: null };
  });
}

export async function analyzeH3Continuation(user: SessionUser, id: string) {
  const owner = workspaceOwner(user);
  return locked(owner, id, async () => {
    const workspace = await refresh(await getWorkspace(owner, id));
    if (workspace.state === "analyzing" || workspace.state === "review") return workspace;
    return act(workspace, { action: "analyze", revision: workspace.revision });
  });
}

function reviewPath(workspace: Workspace, id: string) {
  if (!uuid.test(id)) throw new RequestError("Invalid continuation review.", 400);
  return path.join(folder(workspace.owner, workspace.id), `continuation-${id}.json`);
}

export async function loadH3Continuation(user: SessionUser, value: unknown): Promise<H3ContinuationReview> {
  const owner = workspaceOwner(user);
  const params = value as { workspaceId?: unknown; reviewId?: unknown } | null;
  if (typeof params?.workspaceId !== "string" || typeof params.reviewId !== "string") {
    throw new RequestError("Choose a reviewed continuation.", 400);
  }
  const workspace = await getWorkspace(owner, params.workspaceId);
  const file = reviewPath(workspace, params.reviewId);
  const review = await fs.readFile(file, "utf8").then(text => JSON.parse(text) as H3ContinuationReview, () => null);
  if (!review || review.workspaceId !== workspace.id || review.id !== params.reviewId || review.sourceSha256 !== workspace.sourceSha256) {
    throw new RequestError("Continuation review not found.", 404);
  }
  return review;
}

export async function reviewH3Continuation(user: SessionUser, body: Record<string, unknown>) {
  const owner = workspaceOwner(user);
  const id = String(body.workspaceId || ""), reviewId = String(body.reviewId || "");
  return locked(owner, id, async () => {
    const workspace = await getWorkspace(owner, id);
    const file = reviewPath(workspace, reviewId);
    // The same review submission cannot create additional permanent cards.
    const previous = await fs.readFile(file, "utf8").catch(() => "");
    if (previous) return JSON.parse(previous) as H3ContinuationReview;
    const selections = body.characters;
    if (!Array.isArray(selections) || selections.length > 9 || new Set(selections.map(item => item?.candidateId)).size !== selections.length) {
      throw new RequestError("Choose up to nine distinct character appearances.", 400);
    }
    const review: H3ContinuationReview = {
      id: reviewId, workspaceId: workspace.id, source: workspace.continuation!,
      sourceSha256: workspace.sourceSha256, characters: [], includeVideo: body.includeVideo === true, cardWarnings: [],
    };
    const selectedRefMods = body.refModIds ?? [];
    if (!Array.isArray(selectedRefMods) || new Set(selectedRefMods).size !== selectedRefMods.length ||
        selectedRefMods.some(id => !review.source.refMods?.some(ref => ref.id === id))) {
      throw new RequestError("Choose RefMods from the completed scene.", 400);
    }
    review.refMods = review.source.refMods?.filter(slot => selectedRefMods.includes(slot.id));
    if (review.includeVideo && workspace.duration < 5) throw new RequestError("This clip is too short for a five-second video reference. You can continue with images.", 400);
    if (workspace.state === "analyzing" && selections.length) throw new RequestError("Wait for character analysis or continue with manual references.", 409);
    for (const selection of selections) {
      const candidate = workspace.candidates.find(item => item.id === selection?.candidateId);
      const voice = workspace.voices.find(item => item.id === selection?.voiceId);
      if (!candidate || (selection.voiceId !== null && !voice)) throw new RequestError("Select an appearance and confirm a numbered voice or No Voice.", 400);
      const name = String(selection.name || candidate.name).trim().slice(0, 96);
      if (!name) throw new RequestError("Give each carried appearance a name.", 400);
      const image = candidate.extractedFile || candidate.file;
      await mediaFile(workspace, image);
      if (voice) await mediaFile(workspace, voice.file);
      review.characters.push({candidateId: candidate.id, name, description: String(selection.description ?? candidate.description).trim().slice(0, 2000),
        images: [image], voice: voice ? {id: voice.id, name: voice.name, file: voice.file} : null});
    }
    const assigned = review.characters.flatMap(item => item.voice ? [item.voice.id] : []);
    if (new Set(assigned).size !== assigned.length) throw new RequestError("A numbered voice can belong to only one carried character. Choose No Voice if it is uncertain.", 400);
    if (body.lastFrame === true) {
      const frameFile = "continuation-last-frame.png";
      const directory = folder(owner, workspace.id);
      if (!workspace.continuationLastFrame) {
        const temporary = path.join(directory, randomUUID() + ".png");
        try {
          await extractFinalFrameToImage({inputPath: path.join(directory, "source.mp4"), outputPath: temporary});
          await fs.rename(temporary, path.join(directory, frameFile));
          workspace.continuationLastFrame = frameFile;
          await write(workspace);
        } catch {
          throw new RequestError("The last frame could not be extracted. Continue with it unchecked or add a snapshot manually.", 422);
        } finally {
          await fs.rm(temporary, {force: true});
        }
      }
      review.firstFrame = frameFile;
    }
    for (const [index, item] of review.characters.entries()) {
      if (selections[index].saveCard !== true) continue;
      const candidate = workspace.candidates.find(candidate => candidate.id === item.candidateId)!;
      try {
        const cardId = candidate.globalId || randomUUID();
        if (!loadCharacter(user.ownerKey, cardId)) {
          const {file: imagePath} = await mediaFile(workspace, item.images[0]);
          const audio = item.voice ? await mediaFile(workspace, item.voice.file) : undefined;
          createCharacter(user.ownerKey, {id: cardId, name: item.name, imagePath, originalSourceImagePath: imagePath,
            description: item.description, referenceAudioPath: audio?.file, source: "h3-continuation",
            metadata: {sourceVideo: {workspace: workspace.id, sha256: workspace.sourceSha256, jobId: review.source.jobId},
              sourceFrame: candidate.extractedFrame || candidate.frame, voiceReview: item.voice?.id || "no-voice"}});
          candidate.globalId = cardId;
          await write(workspace);
        } else {
          review.cardWarnings.push(`${item.name}: the existing Character Card was kept. This scene uses your newly reviewed references.`);
        }
      } catch (error) {
        review.cardWarnings.push(`${item.name}: ${error instanceof Error ? error.message : "The Character Card could not be saved."} The temporary reference is ready.`);
      }
    }
    await fs.writeFile(file, JSON.stringify(review), {mode: 0o600, flag: "wx"});
    return review;
  });
}
