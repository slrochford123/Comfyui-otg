import { randomInt } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import path from "node:path";
import {
  createH3DirectJob,
  validateH3DirectInput,
  startH3DirectJob,
  getH3DirectJob,
  ensureH3DirectJobRunner,
  cancelH3DirectJob,
} from "@/lib/h3DirectJobs";
import {
  makeH3SmartReferenceInput,
  characterRefSelectionBackend,
} from "@/lib/h3SmartReferencesServer";
import { resolveProductionRefMod } from "./pinnedRefMods";
import { allShots, type Project, type Job } from "./model";
import { StudioError, type StudioStore } from "./store";
import {
  assertAssetIntact,
  assetDirectory,
  snapshotFile,
  probe,
} from "./media";
const exec = promisify(execFile);
import { assertShotSafe, plannedSeconds } from "./shotPolicy";
import { shotContext, continuitySource } from "./shotDirector";
import {prepareShotVideoPrompt} from "./shotPreparation";
import {directionApproved,directionBrief,directionReferences,directionKey} from "./shotDirection";
import {clipConfiguration,clipVisualStyle} from "./clipConfiguration";
import {manualPromptProblems} from "./clipPlan";
import {selectClipReferenceBackend} from "./clipReferenceBackend";
import {compileVideoDirection,referenceCameraShots,H3_PROMPT_GUIDANCE,type SubmittedReference} from "./videoPrompt";
export async function startVideo(s: StudioStore, owner: string, job: Job) {
  const p = job.input.snapshot as Project,
    shot = allShots(p).find((x) => x.id === job.input.shotId);
  if (!shot) throw new StudioError("Shot not found.");
  const nativeDuration = assertShotSafe(shot);
  const directed=!!p.shots[shot.id]?.direction;
  if(directed&&!directionApproved(p,shot.id))throw new StudioError("The video direction changed. Review and approve it before generating.",422);
  const preparedPrompt=directed?undefined:prepareShotVideoPrompt(p,shot.id);
  if(preparedPrompt?.errors.length)throw new StudioError(preparedPrompt.errors.join(" "),422);
  const brief=directed?directionBrief(p,shot.id):undefined;
  const settings = shotContext(p,shot.id).settings;
  const configuration=clipConfiguration(p,shot.id);
  if (configuration.orientation === "square")
    throw new StudioError(
      "Native square H3 generation is not qualified. Use landscape or portrait shots and choose square fitting during export.",
    );
  const reference = async (id: string) => {
    const a = await assertAssetIntact(s, owner, p.id, id);
    return {
      path: a.path,
      name: a.asset.name,
      description: String(a.asset.metadata.description || a.asset.name),
    };
  };
  const images: Awaited<ReturnType<typeof reference>>[] = [],videos:Awaited<ReturnType<typeof reference>>[]=[],audios:Awaited<ReturnType<typeof reference>>[]=[],
    refMods: Array<Record<string, unknown>> = [];
  const chosen=shot.generationApproach==="reference-to-video"?(directed?directionReferences(p,shot.id,s.assets(owner,p.id),brief,job.input.exactRetakePrompt?job.input.retakePromptSource==="manual":undefined):settings.referenceIds.map(assetId=>({assetId,name:"",role:"identity",audioOnly:false}))):[];
  const provenance:Array<SubmittedReference&{path?:string;bundleKey?:string}>=[];
  for (const selected of chosen) {
    const id=selected.assetId;
    const entry = await assertAssetIntact(s, owner, p.id, id);
    if (entry.asset.kind === "character") {
      if (entry.asset.metadata.bundleId && (settings.refModIds?settings.refModIds.includes(id):settings.referenceInput!=="images")) {
        const bundle = await assertAssetIntact(
            s,
            owner,
            p.id,
            String(entry.asset.metadata.bundleId),
          ),
          name = await resolveProductionRefMod(owner, {
            libraryName: bundle.asset.metadata.libraryName,
            sha256: bundle.asset.sha256,
            characterId: bundle.asset.metadata.characterId,
          });
        refMods.push({
          id: bundle.asset.id,
          name,
          strength: 1,
          components: selected.audioOnly?"Audio":brief&&!brief.dialogue.some(d=>d.speaker===selected.name)?"Visual":"All",
          visualStrength: selected.audioOnly?0:1,
          audioStrength: selected.audioOnly||!brief||brief.dialogue.some(d=>d.speaker===selected.name)?1:0,
          copies: 1,
          characterId: String(bundle.asset.metadata.characterId || ""),
          description: directed?`${selected.name}: ${selected.audioOnly?"off-screen voice only, never visible":"on-screen identity and wardrobe only"}`:String(entry.asset.metadata.description || entry.asset.name),
        });
        provenance.push({tag:"",name:selected.name||entry.asset.name,role:selected.audioOnly?"voice":"character identity and wardrobe",kind:"video",assetId:id,sha256:bundle.asset.sha256,libraryName:name,bundleKey:String(bundle.asset.metadata.characterId||"")});
      } else {
        if(selected.audioOnly)continue;
        const views=entry.asset.metadata.imageIds as string[]|undefined;
        const imageId=views?.[0]||id,image=await reference(imageId);images.push(image);
        provenance.push({tag:`<Picture ${images.length}>`,name:selected.name||entry.asset.name,role:"character identity and wardrobe",kind:"image",assetId:imageId,sha256:s.asset(owner,p.id,imageId).asset.sha256,path:image.path});
      }
    } else if (entry.asset.kind === "image") {const image=await reference(id);images.push(image);provenance.push({tag:`<Picture ${images.length}>`,name:selected.name||entry.asset.name,role:selected.role,kind:"image",assetId:id,sha256:entry.asset.sha256,path:image.path});}
    else if(entry.asset.kind==="video"||entry.asset.kind==="audio"){
      const kind=entry.asset.kind,media=await reference(id),list=kind==="video"?videos:audios;list.push(media);provenance.push({tag:`<${kind==="video"?"Video":"Audio"} ${list.length}>`,name:selected.name||entry.asset.name,role:settings.referenceRoles?.[id]?.role||(kind==="video"?"camera structure":"sound reference"),kind,assetId:id,sha256:entry.asset.sha256,path:media.path});
    } else throw new StudioError("Choose image, character, video or audio references.");
  }
  const firstId=settings.firstImageId || (settings.storyboardApproved ? settings.storyboardId : undefined);
  const useFirst=shot.generationApproach==="image-to-video" || shot.generationApproach==="reference-to-video" && (settings.useStoryboardFirstFrame??!!settings.firstImageId);
  let first = useFirst && firstId
    ? await reference(firstId)
    : null;
  const last = shot.generationApproach !== "text-to-video" && settings.lastImageId
    ? await reference(settings.lastImageId)
    : null;
  if (settings.continuity === "previous-frame" && useFirst && !first) {
    const previous = continuitySource(p,shot.id), take = previous?.take;
    if (!take?.assetId)
      throw new StudioError("Approve a take in the previous shot first.");
    const source = await assertAssetIntact(s, owner, p.id, take.assetId),
      file = path.join(assetDirectory(s, p.id), `${job.id}-continuity.png`);
    const info=await probe(source.path),end=Math.min(Number(info.format.duration), Number(source.asset.metadata.trimOut)||plannedSeconds(previous!.shot));
    const frame=settings.continuityFrameSeconds??Math.max(0,end-0.1);
    if(!Number.isFinite(frame)||frame<0||frame>=end)throw new StudioError("Selected continuity frame is outside the approved source trim.");
    await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-ss",
        String(frame),
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        source.path,
        "-frames:v",
        "1",
        file,
      ],
      { timeout: 30000 },
    );
    first = {
      path: file,
      name: "Approved previous shot frame",
      description: "Continue from the approved shot",
    };
  }
  if (settings.model === "fasth3" && refMods.length)
    throw new StudioError(
      "Saved RefMod bundles are not qualified with Fast H3 in this studio. Choose Standard or Singularity.",
    );
  if(directed&&shot.generationApproach==="reference-to-video"&&last)throw new StudioError("Last-frame plus Ref2VA is not qualified here. Choose Start From My Image for first/last-frame control, or remove the last frame.");
  const actualLoader=refMods.length?(images.length?"combined":"refmods"):"native";
  if(settings.referenceLoader&&settings.referenceLoader!=="auto"&&settings.referenceLoader!==actualLoader)throw new StudioError(`Selected ${settings.referenceLoader} loader does not match these inputs (${actualLoader}). Choose the matching loader or change the references; no loader was substituted.`);
  const selection = refMods.length || directed&&shot.generationApproach==="reference-to-video"&&(!!first||videos.length>0||audios.length>0)
    ? { useFirstFrame: !!first, refMods }
    : undefined;
  const backend = selection
    ? await selectClipReferenceBackend(selection,images,videos.length,audios.length,!!first,owner)
    : undefined;
  const smartReferences =
    selection && backend
      ? await makeH3SmartReferenceInput(
          selection,
          backend,
          images,
          first,
          videos.length,
          audios.length,
          {videos,audios},
          owner,
        )
      : undefined;
  const mode =
    shot.generationApproach === "reference-to-video"
      ? "h3-reference-to-video"
      : shot.generationApproach === "image-to-video"
        ? "h3-image-to-video"
        : "h3-text-to-video";
  if (mode === "h3-image-to-video" && !first)
    throw new StudioError("Choose a first frame for image-to-video.");
  const manifest:SubmittedReference[]=smartReferences?.referenceMap?smartReferences.referenceMap.map(r=>{
    const found=provenance.find(v=>r.source==="image"||r.source==="media"?v.tag===r.tag&&v.kind===r.kind:v.libraryName===r.name||v.bundleKey&&v.bundleKey===r.characterKey||v.name===r.characterName||v.name===r.name);
    if(directed&&!found)throw new StudioError(`Cannot identify the approved source for ${r.tag}. Nothing was submitted.`);
    return {tag:r.tag,name:found?.name||r.name,role:r.kind==="audio"?"voice":found?.role||r.kind,kind:r.kind,assetId:found?.assetId,sha256:found?.sha256,libraryName:found?.libraryName};
  }):provenance.map(({path:_path,bundleKey:_key,...r})=>r);
  if(directed&&shot.generationApproach==="reference-to-video"&&!manifest.some(r=>r.kind!=="audio"))throw new StudioError("Choose at least one approved visual reference, or use Generate From Text.");
  let picture=Math.max(0,...manifest.map(r=>Number(r.tag.match(/<Picture (\d+)>/)?.[1])||0));
  // A Ref2VA timeline guide is not an extra tokenized Picture reference. Do not
  // invent a Picture tag outside the worker's resolved reference map.
  if(first)manifest.push({tag:shot.generationApproach==="reference-to-video"?"Native frame-zero guide":`<Picture ${++picture}>`,name:first.name,role:"first-frame",kind:"image",assetId:firstId,sha256:firstId?s.asset(owner,p.id,firstId).asset.sha256:undefined});
  if(last)manifest.push({tag:`<Picture ${++picture}>`,name:last.name,role:"last-frame",kind:"image",assetId:settings.lastImageId});
  for(const r of manifest)if(brief)r.cameraShotIds=referenceCameraShots(brief,r).map(c=>c.id);
  const compiled=String(job.input.exactRetakePrompt|| (settings.promptSource==="manual"?settings.videoPromptOverride:brief?compileVideoDirection(brief,shot.generationApproach,manifest,nativeDuration,!!first,!!last,clipVisualStyle(p,shot.id)):preparedPrompt!.prompt)||"");
  const promptErrors=manualPromptProblems(compiled,plannedSeconds(shot));if(promptErrors.length)throw new StudioError(promptErrors.join(" "));
  for(const tag of compiled.match(/<(?:Picture|Video|Audio) \d+>/g)||[]){
    if(!manifest.some(r=>r.tag===tag))throw new StudioError(`${tag} has no submitted reference. Correct the technical prompt or select that reference; nothing was submitted.`);
  }
  if(job.input.retakeReferenceManifest){const old=job.input.retakeReferenceManifest as SubmittedReference[];for(const r of old)if(!manifest.some(v=>v.tag===r.tag&&v.assetId===r.assetId&&v.sha256===r.sha256))throw new StudioError("The saved take's reference mapping changed. Review it before retaking; no new generation was submitted.");}
  const preserveExactPrompt=directed&&(!job.input.exactRetakePrompt||job.input.retakePreserveExactPrompt!==false);
  const submission=directed?{clipId:shot.id,brief,briefVersion:2,prompt:compiled,preserveExactPrompt,promptSource:settings.promptSource||"director",configuration:{...configuration,quality:job.kind==="preview"?"sh":"hq",resolvedLoader:actualLoader},promptFormat:H3_PROMPT_GUIDANCE.version,guidance:H3_PROMPT_GUIDANCE,references:manifest,firstFrame:!!first,nativeDuration,plannedDuration:plannedSeconds(shot),approvedAt:p.shots[shot.id].direction?.approvedAt}:undefined;
  if(submission)s.updateJob(owner,job.id,{input:{...job.input,submission}});
  const input = validateH3DirectInput({
    mode,
    quality: job.kind === "preview" ? "sh" : "hq",
    orientation: configuration.orientation as "landscape"|"portrait",
    durationSeconds: nativeDuration,
    prompt: compiled,
    preserveExactPrompt,
    ...(directed?{promptFormat:"minimax-official-v1" as const}:{}),
    seed: settings.seed ?? randomInt(0, 4294967296),
    targetBackend: backend,
    h3Settings: {
      renderMode: settings.model === "fasth3" ? "turbo" : settings.renderMode||"native",
      checkpointMode: settings.model,
      combatLoraEnabled: false,
      refMod: { enabled: false, strength: "balanced" },
      motionLab: { enabled: false },
    },
    optionalLoras: [],
    firstImage: first,
    lastImage: last,
    images,
    videos,
    audios,
    smartReferences,
  });
  const child = await createH3DirectJob(owner, input);
  if(directed&&!job.input.exactRetakePrompt)s.internalUpdate(owner,p.id,next=>{
    if(directionKey(next,shot.id)!==directionKey(p,shot.id))return;
    const d=next.shots[shot.id].direction!;d.compiledPrompt=compiled;d.configuration=submission!.configuration;
    d.promptHistory=[...(d.promptHistory||[]),{prompt:compiled,at:new Date().toISOString(),source:settings.promptSource||"director"}];
  });
  s.updateJob(owner, job.id, {
    backendId: child.id,
    message: "Queued with shared H3 scheduler",
  });
  startH3DirectJob(child);
  return child.id;
}
export async function pollVideo(
  s: StudioStore,
  owner: string,
  job: Job,
  canceled: () => boolean,
) {
  let id = job.backendId;
  if(!id&&job.kind==="video-edit")throw new Error("Video edit submission is unconfirmed. Inspect the original request before retrying; no new generation was submitted.");
  if (!id) id = await startVideo(s, owner, job);
  for (;;) {
    const child = await getH3DirectJob(owner, id);
    if (!child) throw new Error("The linked H3 job could not be found.");
    if (canceled()) {
      let result;
      try {
        result = await cancelH3DirectJob(owner, id);
      } catch {
        throw new Error(
          "Cancellation is unconfirmed. Check the original H3 job before retrying; no duplicate was sent.",
        );
      }
      if (result.status === "canceled") throw new Error("Canceled");
      if (
        result.status === "completed" ||
        (result.status === "running" &&
          result.statusMessage.includes("completed before cancellation"))
      ) {
        s.updateJob(owner, job.id, {
          status: "running",
          message: "Completed before cancellation; collecting original result",
        });
      } else {
        s.updateJob(owner, job.id, {
          message: "Waiting for confirmed H3 cancellation",
        });
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
    }
    ensureH3DirectJobRunner(child);
    s.updateJob(owner, job.id, {
      progress: child.progressPercent || 0,
      message: child.statusMessage,
    });
    if (child.status === "failed")
      throw new Error(child.error || "H3 generation failed.");
    if (child.status === "canceled") throw new Error("Canceled");
    if (child.status === "completed" && child.outputPath) {
      const p = await probe(child.outputPath);
      const submitted=s.jobs(owner,job.projectId).find(j=>j.id===job.id)?.input.submission as Record<string,unknown>|undefined;
      return snapshotFile(
        s,
        owner,
        job.projectId,
        child.outputPath,
        `Shot ${job.input.shotId} take.mp4`,
        "video",
        {
          duration: Number(p.format.duration),
          seed: child.input.seed,
          backend: child.backend,
          quality: child.input.quality,
          h3JobId: child.id,
          submission:submitted?{...submitted,requestedPrompt:submitted.prompt,prompt:child.submittedPrompt||child.input.prompt,preserveExactPrompt:true}:undefined,
          exactSubmittedPrompt:child.submittedPrompt||child.input.prompt,
          promptFormat:child.input.promptFormat,
          model: child.input.h3Settings?.checkpointMode,
          shotId:job.input.shotId,
          sourceStoryboardId:(job.input.snapshot as Project).shots[String(job.input.shotId)]?.storyboardId,
          generationMethod:child.input.mode,
          sourceReferenceIds:shotContext(job.input.snapshot as Project,String(job.input.shotId)).settings.referenceIds,
          plannedDuration: plannedSeconds(allShots(job.input.snapshot as Project).find(s=>s.id===job.input.shotId)!),
          trimIn: 0,
          trimOut: plannedSeconds(allShots(job.input.snapshot as Project).find(s=>s.id===job.input.shotId)!),
        },
      );
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}
