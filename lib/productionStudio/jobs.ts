import {productionStudioEnabled} from "./availability";
import {cinematicAudioFinish,remuxSoundtrack} from "./cinematicAudio";
import {audioFinishSettings,selectedAudioAsset} from "./audioFinishSettings";
import {prepareClipAudio} from "./clipAudio";
import {finishQueueDisplay} from "./finishQueue";
import {clipEditTimeline,storyboardCurrent} from "./workflow";
import {runWorkflowAssistant} from "./workflowAssistantServer";
import {resolveAssistantProvider,withAssistantProvider} from "@/lib/workers/assistantProvider";
import {withConversationAccount} from "@/lib/openai/conversationAccount";
import path from "node:path";
import fs from "node:fs/promises";
import { NextRequest } from "next/server";
import { randomUUID,randomInt } from "node:crypto";
import {
  allShots,
  DEFAULT_SHOT,
  EMPTY_TIMELINE,
  type Project,
  type Job,
  type JobKind,
  type Asset,
  type Timeline,
} from "./model";
import { StudioError, validateTimeline, type StudioStore } from "./store";
import { studio, assertStudioEnabled } from "./server";
import { validateExport, renderTimeline } from "./render";
import {
  assetDirectory,
  snapshotFile,
  assertAssetIntact,
  probe,
} from "./media";
import { runAssistant, ensureStoryLink } from "./planning";
import { runCreateAssistant } from "./createAssistant";
import { requireCurrentManifest } from "./createManifest";
import { isAudioRequirement, analysisCompletion } from "./createTypes";
import {buildProductionAssetPrompt,type AssetPrompt} from "./assetPrompts";
import {imageEditReferenceIds,buildAssetImageEditPrompt} from "./assetImageEdit";
import {prepareShotImage,prepareShotVideoPrompt} from "./shotPreparation";
import {runShotPromptAssistant} from "./shotPromptAssistant";
import {submitQwenStoryboard,refreshQwenStoryboard,type StoryboardPreparation} from "./storyboardExecution";
import {finishingGeometry,transformFinishVideo,verifyFinishedVideo} from "./finishing";
import { pollVideo } from "./generation";
import { playbackProxy } from "./proxy";
import {shotReviewProxy} from "./shotReview";
import {directionApproved,directionProblems,saveDirection,directionBrief} from "./shotDirection";
import {startingImageReady} from "./clipConfiguration";
import {runShotDirectionAssistant} from "./shotDirectionAssistant";
import { addStoryCreatorMessage } from "@/lib/storyCreator/store";
import {
  createStoryMedia,
  getStoryMedia,
  updateStoryMedia,
  claimStoryMedia,
  type StoryMediaRecord,
} from "@/lib/storyCreator/mediaStore";
import {
  executeStoryMedia,
  refreshStoryMedia,
  storyMediaFile,
  cancelStoryMedia,
} from "@/lib/storyCreator/mediaExecution";
import {
  generateStoryVoice,
  storyVoiceActive,
} from "@/lib/storyCreator/mediaVoice";
import { assertShotJobSafe, plannedSeconds, takeReviewSeconds } from "./shotPolicy";
import { shotContext, continuitySource } from "./shotDirector";
import { parseMediaGpuChoice, type MediaGpuChoice } from "@/lib/mediaGpuRouting";

function storyRecord(
  s: StudioStore,
  owner: string,
  project: string,
  kind: "image" | "voice",
  prompt: string,
  text: string,
  name: string,
  key: string,
  subject: "scene"|"character"|"object" = "scene",
) {
  const storyId = ensureStoryLink(s, owner, project);
  const content = `Generate ${kind} ${name}. ${prompt} ${text}`;
  const message = addStoryCreatorMessage({
    ownerKey: owner,
    projectId: storyId,
    role: "user",
    content,
  });
  return createStoryMedia(
    {
      ownerKey: owner,
      projectId: storyId,
      sourceMessageId: message.id,
      command: {
        operation: kind,
        subject,
        name,
        prompt,
        text,
        sourceId: "",
        evidence: content,
      },
    },
    `studio:${key}`,
  ).record;
}
export async function enqueueStudioJob(
  s: StudioStore,
  owner: string,
  project: string,
  b: Record<string, unknown>,
  cookie: string,
  context?: { voiceGpuChoice?: MediaGpuChoice; accountId?: string },
) {
  let p = s.get(owner, project);
  if (p.revision !== b.revision)
    throw new StudioError(
      "Save and review the latest production before starting this action.",
      409,
    );
  const kind = String(b.kind) as JobKind;
  if(b.editClipId){
    if(!["audio-preview","export"].includes(kind))throw new StudioError("Choose an edit preview operation.");
    p={...p,timeline:clipEditTimeline(p,String(b.editClipId))};
  }
  let exactRetakePrompt:string|undefined,retakeReferenceManifest:unknown,retakePromptSource:string|undefined,retakePreserveExactPrompt:boolean|undefined;
  if(b.retakeTakeId){
    if(!["preview","regenerate"].includes(kind))throw new StudioError("Choose video generation to retake a clip.");
    const clip=allShots(p).find(c=>c.id===b.shotId),take=clip?.takes.find(t=>t.id===b.retakeTakeId);
    if(!take?.assetId||!take.generationJobId)throw new StudioError("Choose an existing take with saved generation settings.");
    const source=s.job(owner,take.generationJobId);if(source.projectId!==project)throw new StudioError("The source take belongs to another production.",403);
    const a=s.asset(owner,project,take.assetId).asset,submission=a.metadata.submission as {prompt?:string;references?:unknown;preserveExactPrompt?:boolean}|undefined;
    exactRetakePrompt=submission?.prompt||String(a.metadata.exactSubmittedPrompt||"");
    if(!exactRetakePrompt||!source.input.snapshot)throw new StudioError("This older take has no saved exact prompt. Choose Change with AI or paste your prompt manually.");
    p=structuredClone(source.input.snapshot as Project);
    if(p.id!==project||!p.shots[String(b.shotId)])throw new StudioError("The saved clip configuration is unavailable.");
    const settings=p.shots[String(b.shotId)];retakePromptSource=settings.promptSource||"director";retakePreserveExactPrompt=submission?.preserveExactPrompt===true;settings.promptSource="manual";settings.videoPromptOverride=exactRetakePrompt;
    settings.seed=randomInt(0,4294967295);if(settings.seed===Number(a.metadata.seed))settings.seed=(settings.seed+1)%4294967295;
    saveDirection(p,String(b.shotId),directionBrief(p,String(b.shotId)),true);
    retakeReferenceManifest=submission?.references;
  }
  if (
    ![
      "export",
      "video-edit",
      "audio-prepare",
      "audio-preview",
      "animatic",
      "assistant",
      "asset-analysis",
      "asset-assistant",
      "asset-image",
      "preview",
      "regenerate",
      "finish",
      "audio-finish",
      "storyboard",
      "voice",
      "review",
    ].includes(kind)
  )
    throw new StudioError("Unsupported job.");
  if (b.approved !== true)
    throw new StudioError("Confirm this action before starting it.", 403);
  const key = String(b.requestKey || "");
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key))
    throw new StudioError("A stable request key is required.");
  const shot = allShots(p).find((x) => x.id === b.shotId);
  if (["video-edit","preview", "regenerate", "finish", "audio-finish", "storyboard", "review"].includes(kind) && !shot)
    throw new StudioError("Choose a shot.");
  if (
    ["preview", "regenerate"].includes(kind) &&
    (!startingImageReady(p,shot!.id) || p.plan.status !== "approved")
  )
    throw new StudioError(
      "Approve the story and select an approved starting image when the chosen method requires one.",
    );
  if (kind === "finish" && !p.shots[shot!.id]?.approvedTakeId)
    throw new StudioError("Approve a take before finishing.");
  const input: Record<string, unknown> = { snapshot: p, shotId: shot?.id,...(exactRetakePrompt?{exactRetakePrompt,retakeReferenceManifest,retakePromptSource,retakePreserveExactPrompt,retakeTakeId:b.retakeTakeId}:{}) };
  if(context?.accountId) input.conversationAccountId=context.accountId;
  if(["assistant","asset-analysis","asset-assistant"].includes(kind))input.aiProvider=resolveAssistantProvider(b.aiProvider);
  if(b.editClipId)input.editClipId=String(b.editClipId);
  if(kind==="video-edit"){
    input.message=String(b.message||"").trim().slice(0,4000);if(!input.message)throw new StudioError("Describe the visual correction.");
    const clip=clipEditTimeline(p,shot!.id).clips[0];input.sourceAssetId=clip.assetId;
    const editedSnapshot=structuredClone(p),editedShot=allShots(editedSnapshot).find(v=>v.id===shot!.id)!;
    editedShot.plannedDurationSeconds=clip.out-clip.in;input.snapshot=editedSnapshot;
    if(clip.out-clip.in<2||clip.out-clip.in>10)throw new StudioError("This video-edit service supports 2–10 second clips. Audio and manual editing remain available.");
    if(s.jobs(owner,project).some(j=>j.kind==="video-edit"&&["queued","running","canceling","attention"].includes(j.status)))throw new StudioError("Finish or reconcile the current video edit before another submission.",409);
  }
  if(kind==="audio-prepare"){
    const a=await assertAssetIntact(s,owner,project,String(b.assetId||""));
    if(!['video','audio'].includes(a.asset.kind))throw new StudioError("Choose saved video or audio.");
    if(s.jobs(owner,project).some(j=>j.kind==="audio-prepare"&&["queued","running","canceling"].includes(j.status)))throw new StudioError("An audio preparation is already active. Wait or cancel it before retrying.",409);
    input.assetId=a.asset.id;input.separate=b.separate===true;
  }
  if(kind==="audio-preview"){
    validateTimeline(p.timeline,new Set(s.assets(owner,project).map(a=>a.id)));
    if(!p.timeline.clips.length)throw new StudioError("Add a clip before previewing the mix.");
    if(s.jobs(owner,project).some(j=>j.kind==="audio-preview"&&["queued","running","canceling"].includes(j.status)))throw new StudioError("A mix preview is already rendering.",409);
    input.original=b.original===true;
  }
  assertShotJobSafe(kind,input);
  if(["preview","regenerate"].includes(kind)){
    if(!b.retakeTakeId&&p.workflow?.version===2&&!storyboardCurrent(p,shot!.id))throw new StudioError("Review and approve this clip’s image and sequence in Storyboard before generating.",422);
    if(!directionApproved(p,shot!.id))throw new StudioError("Review and approve this shot's video direction first. "+directionProblems(p,shot!.id).join(" "),422);
  }
  if(kind==="audio-finish"){
    const assetId=String(b.assetId||"");
    if(!shot!.takes.some(t=>t.assetId===assetId)&&p.shots[shot!.id]?.finalAssetId!==assetId)throw new StudioError("Choose a saved original take or finish from this clip.");
    const a=await assertAssetIntact(s,owner,project,assetId);if(a.asset.kind!=="video")throw new StudioError("Choose a video.");
    if(s.jobs(owner,project).some(j=>j.kind==="audio-finish"&&["queued","running","canceling"].includes(j.status)))throw new StudioError("An audio finish is already running.",409);
    input.assetId=assetId;input.audioSettings=audioFinishSettings(b.audioSettings);
    if(b.adjustment){if(typeof b.adjustment!=="string"||b.adjustment.length>2000)throw new StudioError("Keep the audio adjustment under 2000 characters.");input.adjustment=b.adjustment;}
  }
  if(kind==="review"){
    const assetId=String(b.assetId||"");
    if(!shot!.takes.some(t=>t.assetId===assetId)&&p.shots[shot!.id]?.finalAssetId!==assetId)throw new StudioError("Choose a saved take from this shot.");
    const asset=s.asset(owner,project,assetId).asset;
    if(asset.kind!=="video")throw new StudioError("Choose a video take.");
    input.assetId=assetId;input.seconds=takeReviewSeconds(asset.metadata,plannedSeconds(shot!));
  }
  if(kind==="storyboard"){
    const prepared=prepareShotImage(p,shot!.id,s.assets(owner,project));
    if(prepared.errors.length)throw new StudioError(prepared.errors.join(" "),422);
    if(prepared.warnings.length&&b.confirmReferenceWarnings!==true)throw new StudioError(prepared.warnings.join(" ")+" Confirm this reference choice before generating.",422);
    for(const id of prepared.referenceIds)await assertAssetIntact(s,owner,project,id);
    input.storyboardPreparation=prepared;
  }
  if (["preview","regenerate"].includes(kind) && shot && continuitySource(p,shot.id) && !p.shots[shot.id]?.continuityReviewed)
    throw new StudioError("Review the starting image against the selected earlier shot, then confirm continuity or accept intentional changes.");
  if (["preview", "regenerate"].includes(kind) && shot) {
    const settings = shotContext(p,shot.id).settings;
    for (const id of [
      ...(shot.generationApproach==="reference-to-video"?settings.referenceIds:[]),
      ...(shot.generationApproach!=="text-to-video"?[settings.firstImageId,settings.lastImageId]:[]),
    ].filter(Boolean) as string[]) {
      if (
        !p.bindings.some((b) => b.assetId === id && b.approved) &&
        !Object.values(p.shots).some(v=>v.storyboardId===id&&v.storyboardApproved)
      )
        throw new StudioError(
          "Approve selected character and image references in Cast & World first.",
        );
    }
  }
  if (kind === "export") {
    input.settings = validateExport(b.settings);
    if(b.assemblyId){const assembly=p.assemblies?.find(a=>a.id===b.assemblyId);if(!assembly)throw new StudioError("Saved assembly not found.");input.snapshot={...p,timeline:assembly.timeline};input.assemblyId=assembly.id;}
  }
  if (["assistant","asset-analysis","asset-assistant"].includes(kind) && s.jobs(owner,project).some(j => ["assistant","asset-analysis","asset-assistant"].includes(j.kind) && ["queued","running","canceling"].includes(j.status)))
    throw new StudioError("A filmmaker request is already running. Wait or cancel it before asking again.",409);
  if (kind === "asset-analysis" && p.plan.status !== "approved") throw new StudioError("Approve your story before preparing assets.");
  if (["asset-assistant","asset-image"].includes(kind) || (kind === "voice" && b.requirementId)) {
    const manifest = requireCurrentManifest(p), item = manifest.items.find(i => i.id === b.requirementId);
    if (!item) throw new StudioError("Choose a creation item from this story.");
    input.requirementId = item.id; input.sourceStoryKey = manifest.storyKey;
    if (kind === "asset-assistant") {
      input.message = String(b.message || "").trim().slice(0,12000);
      if (!input.message) throw new StudioError("Tell the filmmaker what to change.");
    }
    if (kind === "asset-image") {
      if (isAudioRequirement(item.kind)) throw new StudioError("Choose a visual asset. Audio requirements can use saved files or be deferred.");
      if(!String(b.prompt || item.prompt).trim()) throw new StudioError("Describe this asset, accept an appearance suggestion, upload a reference, or choose an existing asset first.");
      if(b.editMode!==true&&b.referenceIds!==undefined)throw new StudioError("Choose Edit with FIBO Turbo to combine multiple references.");
      const references=b.editMode===true?imageEditReferenceIds(b.referenceIds):b.referenceId?[String(b.referenceId)]:[];
      const sourceAssets=[];
      for(const id of references)sourceAssets.push((await assertAssetIntact(s,owner,project,id)).asset);
      const assetPrompt=b.editMode===true?buildAssetImageEditPrompt(item,b.prompt,sourceAssets):buildProductionAssetPrompt(p,item,String(b.prompt || item.prompt).trim());
      input.assetPrompt=assetPrompt;input.prompt=assetPrompt.prompt;input.name=item.name.slice(0,120);
      input.referenceIds=references;input.editMode=b.editMode===true;
      if (!input.prompt) throw new StudioError("Describe the image first.");
    }
  }
  if (kind === "assistant") {
    if (s.jobs(owner, project).some(j => j.kind === "assistant" && ["queued", "running", "canceling"].includes(j.status)))
      throw new StudioError("A filmmaker request is already running. Wait for it or cancel it before asking again.", 409);
    input.message = String(b.message || "").slice(0, 12000);
    input.planMode = b.planMode === true;
    if(b.workspaceMode==="Edit"||b.workspaceMode==="Finish"){
      if(b.planMode||b.directionMode||b.promptTarget)throw new StudioError("Choose one assistant context.");
      if(b.workspaceMode==="Edit"&&!shot)throw new StudioError("Choose a clip to edit.");
      input.workspaceMode=b.workspaceMode;
    }
    if(b.directionMode===true){
      if(!shot||b.planMode||b.planningScope||b.promptTarget)throw new StudioError("Choose one shot for video direction.");
      input.directionMode=true;
    }
    if(b.promptTarget!==undefined){
      if(!shot||!["storyboard","video"].includes(String(b.promptTarget))||b.planMode===true||b.planningScope)throw new StudioError("Choose a shot and either its starting-image or video prompt.");
      input.promptTarget=b.promptTarget;
    }
    if(b.planningScope && typeof b.planningScope === "object") {
      const scope=b.planningScope as {mode?:string;sceneId?:string};
      if(scope.mode && !["outline","segment","scene"].includes(scope.mode))throw new StudioError("Choose outline, segment or scene planning.");
      input.planningScope={mode:scope.mode,sceneId:scope.sceneId?String(scope.sceneId):undefined};
    }
    if (b.proposalId) input.proposalId = String(b.proposalId);
    if (!input.message) throw new StudioError("Enter an idea or question.");
  }
  if (kind === "voice") {
    // Persist only a normalized preference captured by the authenticated route.
    // Legacy queued jobs default to Automatic; client body overrides are ignored.
    input.voiceGpuChoice = parseMediaGpuChoice(context?.voiceGpuChoice);
    input.text = String(b.text || "").slice(0, 4000);
    input.prompt = String(b.prompt || "").slice(0, 4000);
    input.name = String(b.name || "Voice audition").slice(0, 100);
    input.voiceReferenceId = b.voiceReferenceId
      ? String(b.voiceReferenceId)
      : null;
    if (b.characterId) {
      const character = s.asset(owner, project, String(b.characterId)).asset;
      if (character.kind !== "character")
        throw new StudioError("Choose a pinned character.");
      const assigned = p.characterVoices?.[character.id];
      if (!assigned || assigned !== input.voiceReferenceId)
        throw new StudioError(
          "Use the approved voice assigned to this character, or explicitly change the assignment first.",
        );
      input.characterId = character.id;
    }
    if (!input.text)
      throw new StudioError("Enter the exact dialogue or audition text.");
    if (input.voiceReferenceId) {
      const a = s.asset(owner, project, String(input.voiceReferenceId));
      if (
        a.asset.kind !== "audio" ||
        !p.bindings.some((b) => b.assetId === a.asset.id && b.approved)
      )
        throw new StudioError("Choose an approved saved voice reference.");
    }
  }
  const job = s.enqueue(owner, project, kind, input, key);
  if(kind==="video-edit"&&!job.backendId&&job.status==="queued"){
    s.updateJob(owner,job.id,{status:"running",message:"Preparing the approved source for video editing"},Date.now()+300000);
    try{await (await import("./videoEditing")).submitClipVideoEdit(s,owner,p,job,cookie);s.updateJob(owner,job.id,{status:"queued"},0);}
    catch(e){s.updateJob(owner,job.id,{status:/unconfirmed/i.test(String(e))?"attention":"failed",message:e instanceof Error?e.message:"Video edit could not be prepared"},0);}
  }
  if (kind === "asset-image" && !job.backendId && job.status === "queued") {
    const intent=input.assetPrompt as AssetPrompt;
    const subject=intent.role.endsWith("character")||intent.role==="background-group"?"character":intent.role==="environment"?"scene":"object";
    const record = storyRecord(s,owner,project,"image",String(input.prompt),"",String(input.name),key,subject);
    s.updateJob(owner,job.id,{backendId:`story:${record.id}`,input:{...job.input,storyId:record.projectId}});
    void executeStoryboard(s,owner,p,"",record,cookie,input.referenceIds as string[],intent).catch(() => {});
  }
  if (kind === "storyboard" && !job.backendId && job.status === "queued") {
    // Use the current authenticated request for the existing image adapter; credentials are never persisted.
    const record = storyRecord(
      s,
      owner,
      project,
      "image",
      (input.storyboardPreparation as StoryboardPreparation).prompt,
      "",
      `Storyboard ${shot!.shotNumber}`,
      key,
    );
    s.updateJob(owner, job.id, {
      backendId: `story:${record.id}`,
      input: { ...job.input, storyId: record.projectId },
    });
    const prepared=input.storyboardPreparation as StoryboardPreparation;
    if(prepared.mode==="text")await executeStoryMedia(record,cookie);
    else if(claimStoryMedia(record)){
      const current=getStoryMedia(owner,record.projectId,record.id);
      try{await submitQwenStoryboard(s,owner,p,current,cookie,prepared);}
      catch(e){updateStoryMedia(current,{status:"unknown",error:e instanceof Error?e.message:"Storyboard submission could not be confirmed."});}
    }
  }
  bootstrapStudioWorker();
  return s.job(owner, job.id);
}
async function executeStoryboard(
  s: StudioStore,
  owner: string,
  p: Project,
  shotId: string,
  record: StoryMediaRecord,
  cookie: string,
  overrideReferences?: string[],
  assetPrompt?:AssetPrompt,
) {
  const settings = shotId ? shotContext(p,shotId).settings : DEFAULT_SHOT;
  const source = shotId ? continuitySource(p,shotId) : undefined;
  const ids = overrideReferences || [
    ...new Set(
      [settings.firstImageId, source?.settings.storyboardApproved ? source.settings.storyboardId : undefined, ...settings.referenceIds].filter(
        Boolean,
      ) as string[],
    ),
  ];
  if (!ids.length && !assetPrompt) return executeStoryMedia(record, cookie);
  if (!claimStoryMedia(record)) return;
  record = getStoryMedia(owner, record.projectId, record.id);
  try {
    if(assetPrompt&&!ids.length){
      const {POST}=await import("@/app/api/assets/create-image/route");
      const host=new URL(process.env.OTG_MEDIA_3090_IMAGE_URL||"http://100.75.162.64:8188").hostname;
      const response=await POST(new NextRequest(`http://${host}:3001/api/assets/create-image`,{method:"POST",headers:{cookie,"Content-Type":"application/json"},body:JSON.stringify({model:"krea-2",name:record.command.name,prompt:record.command.prompt,artStyle:"",visualKind:assetPrompt.policy,persistOutput:true})}));
      const result=await response.json();
      if(!response.ok||result.ok===false){updateStoryMedia(record,{status:response.status<500?"failed":"unknown",error:String(result.error||"Image submission could not be confirmed.")});return;}
      updateStoryMedia(record,{status:"running",backendJob:result});return;
    }
    const references = [];
    for (const id of ids) {
      const a = await assertAssetIntact(s, owner, p.id, id);
      if (!["image", "character"].includes(a.asset.kind))
        throw new StudioError(
          "Storyboard references must be images or pinned characters.",
        );
      references.push(a);
    }
    if (references.length > 4)
      throw new StudioError(
        "FIBO storyboards accept up to four references. Deselect extras; none were discarded.",
      );
    const form = new FormData();
    form.set("model", "fibo2-edit-turbo");
    form.set("clientRequestId", record.id);
    form.set(
      "prompt",
      record.command.prompt + ". " + (assetPrompt ? assetPrompt.editInstruction :
        "Preserve the visual identity of the supplied characters and references; compose this shot without inventing replacement characters."),
    );
    for (const [i, a] of references.entries())
      form.set(
        ["image", "imageB", "imageC", "imageD"][i],
        new File([await fs.readFile(a.path)], path.basename(a.path), {
          type: a.asset.mime,
        }),
      );
    record = updateStoryMedia(record, {
      command: { ...record.command, operation: "edit" },
    });
    const { POST } = await import("@/app/api/images/native/route");
    const host = new URL(
      process.env.OTG_MEDIA_3090_IMAGE_URL || "http://100.75.162.64:8188",
    ).hostname;
    const response = await POST(
      new NextRequest(`http://${host}:3001/api/images/native`, {
        method: "POST",
        headers: { cookie },
        body: form,
      }),
    );
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      record = updateStoryMedia(record, {
        status: response.status < 500 ? "failed" : "unknown",
        error: String(
          result.error || "Image submission could not be confirmed.",
        ),
      });
      return;
    }
    updateStoryMedia(record, { status: "running", backendJob: result });
  } catch (error) {
    updateStoryMedia(record, {
      status: error instanceof StudioError ? "failed" : "unknown",
      error:
        error instanceof Error
          ? error.message
          : "Image submission could not be confirmed.",
    });
  }
}
function canceled(s: StudioStore, owner: string, id: string) {
  return ["canceling", "canceled"].includes(s.job(owner, id).status);
}
async function waitStory(s: StudioStore, owner: string, job: Job) {
  if (!job.backendId)
    throw new StudioError(
      "Image submission was interrupted. Retry explicitly after checking the original request.",
    );
  for (;;) {
    let r = getStoryMedia(
      owner,
      String(job.input.storyId),
      job.backendId.slice(6),
    );
    if (canceled(s, owner, job.id)) {
      try {
        r = await cancelStoryMedia(r);
      } catch {
        throw new Error(
          "Cancellation is unconfirmed. Check the original image job before retrying.",
        );
      }
      if (r.status === "canceled") throw new Error("Canceled");
      if (r.status !== "ready")
        throw new Error(
          "Cancellation is unconfirmed. Check the original image job before retrying.",
        );
      s.updateJob(owner, job.id, {
        status: "running",
        message: "Completed before cancellation; collecting original image",
      });
    }
    r = job.kind==="storyboard"&&(job.input.storyboardPreparation as StoryboardPreparation|undefined)?.mode!=="text"&&job.input.storyboardPreparation ? await refreshQwenStoryboard(s,owner,job.projectId,r) : await refreshStoryMedia(r);
    if(r.status==="unknown")throw new Error("Image submission is unconfirmed. Check the original media request before retrying; no duplicate was sent.");
    if (["failed", "unknown", "canceled"].includes(r.status))
      throw new Error(r.error || `Image ${r.status}`);
    if (r.status === "queued" && Date.now() - r.createdAt > 60000)
      throw new Error(
        "Image submission needs attention; no automatic duplicate was sent.",
      );
    if (r.status === "ready")
      return snapshotFile(
        s,
        owner,
        job.projectId,
        storyMediaFile(r),
        job.kind === "asset-image" ? `${job.input.name}.png` : `Storyboard ${job.input.shotId}.png`,
        "image",
        { storyMediaId: r.id, requirementId: job.input.requirementId, sourceStoryKey: job.input.sourceStoryKey, ...(job.kind==="asset-image"?{assetPrompt:job.input.assetPrompt,visualCompliance:"unreviewed"}:{shotId:job.input.shotId,storyboardPreparation:job.input.storyboardPreparation,engine:r.backendJob?.engine||"krea-2",seed:r.backendJob?.seed}) },
      );
    s.updateJob(owner, job.id, {
      message: `${r.backendJob?.engine==="qwen-image-edit-2.1-turbo"?"Qwen Image Edit 2.1 Turbo":r.command.operation === "edit" ? "FIBO 2.0" : "Krea 2 Turbo"} · ${r.status}`,
    });
    await new Promise((r) => setTimeout(r, 2500));
  }
}
async function voice(s: StudioStore, owner: string, job: Job) {
  let r: StoryMediaRecord;
  const initial = !job.backendId;
  if (initial) {
    r = storyRecord(
      s,
      owner,
      job.projectId,
      "voice",
      String(job.input.prompt),
      String(job.input.text),
      String(job.input.name),
      job.id,
    );
    r = updateStoryMedia(r, { status: "running" });
    s.updateJob(owner, job.id, {
      backendId: `voice:${r.id}`,
      input: { ...job.input, storyId: r.projectId },
    });
  } else
    r = getStoryMedia(
      owner,
      String(job.input.storyId),
      job.backendId!.slice(6),
    );
  if (!initial && r.status !== "ready" && !storyVoiceActive(r.id))
    throw new StudioError(
      "Interrupted voice execution needs review before retrying. No replacement voice was generated.",
      409,
    );
  if (initial) {
    try {
      let source: { voice?: string; refText?: string } = {};
      if (job.input.voiceReferenceId) {
        const a = await assertAssetIntact(
          s,
          owner,
          job.projectId,
          String(job.input.voiceReferenceId),
        );
        source = {
          voice: a.path,
          refText: String(
            a.asset.metadata.referenceText || a.asset.metadata.refText || "",
          ),
        };
      }
      const file = await generateStoryVoice(r, source, {
        gpuChoice: parseMediaGpuChoice(job.input.voiceGpuChoice),
      });
      r = updateStoryMedia(r, { status: "ready", filePath: file });
    } catch (error) {
      const current = getStoryMedia(owner, r.projectId, r.id);
      if (current.status === "running") updateStoryMedia(current, {
        status: error instanceof Error && error.name === "UnconfirmedStoryVoice" ? "unknown"
          : error instanceof Error && error.name === "AbortError" ? "canceled" : "failed",
        error: error instanceof Error ? error.message : "Voice generation failed.",
      });
      throw error;
    }
  }
  if (canceled(s, owner, job.id)) throw new Error("Canceled");
  const file = storyMediaFile(r),
    p = await probe(file);
  return snapshotFile(
    s,
    owner,
    job.projectId,
    file,
    String(job.input.name) + ".wav",
    "audio",
    {
      purpose: job.input.voiceReferenceId ? "dialogue" : "voice-reference",
      referenceText: String(job.input.text),
      sourceVoiceId: job.input.voiceReferenceId,
      characterId: job.input.characterId,
      requirementId: job.input.requirementId,
      sourceStoryKey: job.input.sourceStoryKey,
      duration: Number(p.format.duration),
    },
  );
}
async function finish(s: StudioStore, owner: string, job: Job) {
  const p = job.input.snapshot as Project,
    shot = allShots(p).find((x) => x.id === job.input.shotId)!,
    take = shot.takes.find((t) => t.id === p.shots[shot.id]?.approvedTakeId);
  if (!take?.assetId) throw new StudioError("Approved source take missing.");
  const entry = await assertAssetIntact(s, owner, p.id, take.assetId),
    info = await probe(entry.path);
  assertShotJobSafe(job.kind,job.input);
  if(Number(info.format.duration)>10.2)throw new StudioError("This legacy source exceeds ten seconds. Create a reviewed short shot before H3 finishing; the original is preserved.");
  const stream = info.streams.find((s) => s.codec_type === "video");
  if (!stream?.width || !stream.height)throw new StudioError("Source video dimensions are unavailable.");
  if(stream.width*stream.height>=995000){
    const [n,d=1]=String(stream.avg_frame_rate||"24/1").split("/").map(Number);
    return snapshotFile(s,owner,p.id,entry.path,`${shot.shotNumber} full-quality approved source.mp4`,"video",{...entry.asset.metadata,sourceTakeId:take.id,sourceAssetId:entry.asset.id,finishing:"Approved source already at 1 MP or higher; no upscale performed",finishingVerified:true,alreadyAtQuality:true,width:stream.width,height:stream.height,megapixels:stream.width*stream.height/1e6,duration:Number(info.format.duration),fps:n/d});
  }
  const geometry=finishingGeometry(stream.width,stream.height);
  const { uploadH3Input, submitH3Prompt, getH3PromptHistory, downloadH3Video } =
    await import("@/lib/production/h3Comfy");
  const { buildH3VsrWorkflow, H3_BACKEND_PROFILES } = await import(
    "@/lib/production/h3Workflows"
  );
  const backend = "rtx5060ti";
  const {getMediaQueueJob} = await import("@/lib/workers/mediaGpuQueue");
  let promptId = job.backendId;
  if (!promptId) {
    const canvas=path.join(assetDirectory(s,p.id),`${job.id}-vsr-canvas.mp4`);
    await transformFinishVideo(entry.path,canvas,geometry.prepare);
    if(canceled(s,owner,job.id))throw new Error("Canceled");
    const uploaded = await uploadH3Input({
        backend,
        sourcePath: canvas,
        mediaType: "video",
        uploadName: `studio_${job.id}`,
      }),
      built = buildH3VsrWorkflow({
        videoInputFilename: uploaded,
        outputPrefix: `production_studio/${job.id}`,
      });
    const accepted = await submitH3Prompt({
      backend,
      graph: built.graph,
      clientId: `studio-${job.id}`,
      jobId: job.id,
      ownerKey: owner,
      workerId: "production-studio-finish",
      beforeSubmit: async () => {
        if (canceled(s, owner, job.id)) throw new Error("Canceled");
      },
      onAccepted: (id) => {
        s.updateJob(owner, job.id, { backendId: id });
      },
    });
    promptId = s.job(owner, job.id).backendId;
    if (!promptId)
      throw new Error(
        "Upscale submission could not be confirmed. Check the original request before retrying.",
      );
    void accepted;
  }
  for (;;) {
    if (canceled(s, owner, job.id)) {
      const { cancelComfyPrompt } = await import("@/lib/comfySafeCancel");
      let result;
      try {
        result = await cancelComfyPrompt(
          H3_BACKEND_PROFILES[backend].baseUrl,
          promptId,
        );
      } catch {
        throw new Error(
          "Cancellation is unconfirmed. Check the original upscale job before retrying.",
        );
      }
      if (result.status === "canceled") throw new Error("Canceled");
      if (result.status === "canceling") {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      s.updateJob(owner, job.id, {
        status: "running",
        message: "Completed before cancellation; collecting original upscale",
      });
    }
    const queued = getMediaQueueJob(promptId);
    if (queued && ["failed","canceled"].includes(queued.status))
      throw new Error(queued.error || "The upscale ended before completion; your approved take is preserved.");
    s.updateJob(owner,job.id,finishQueueDisplay(queued));
    if (queued && ["queued","dispatching"].includes(queued.status)) {
      await new Promise((r) => setTimeout(r,2500));
      continue;
    }
    const h = await getH3PromptHistory(backend, promptId, fetch, "9");
    if (h.state === "failed")
      throw new Error("RTX VSR failed; the approved source take is preserved.");
    if (h.video) {
      const file = await downloadH3Video({
        backend,
        file: h.video,
        ownerKey: owner,
        productionId: p.id,
        sceneId: shot.id,
        generationJobId: job.id,
      });
      const result=await probe(file),vsr=result.streams.find(v=>v.codec_type==="video");
      if(vsr?.width!==1920||vsr?.height!==1080)throw new StudioError("RTX VSR returned unexpected output dimensions; no finish was approved.");
      const intermediate=await snapshotFile(s,owner,p.id,file,`${shot.shotNumber} VSR intermediate.mp4`,"video",{sourceTakeId:take.id,sourceAssetId:entry.asset.id,finishingIntermediate:true});
      const finished=path.join(assetDirectory(s,p.id),`${job.id}-1mp.mp4`);
      await transformFinishVideo(file,finished,geometry.finish);
      const restored=path.join(assetDirectory(s,p.id),`${job.id}-audio-restored.mp4`);
      await remuxSoundtrack(finished,entry.path,restored);
      const verified=await verifyFinishedVideo(entry.path,restored,geometry);
      if(canceled(s,owner,job.id))throw new Error("Canceled");
      const nativeFinal=await snapshotFile(
        s,
        owner,
        p.id,
        restored,
        `${shot.shotNumber} finished.mp4`,
        "video",
        {
          sourceTakeId: take.id,
          sourceAssetId:entry.asset.id,
          intermediateAssetId:intermediate.id,
          finishing: "RTX VSR + aspect-preserving 1 MP finish",
          finishingVerified:true,
          ...verified,
          trimIn: Number(entry.asset.metadata.trimIn)||0,
          trimOut: Number(entry.asset.metadata.trimOut)||plannedSeconds(shot),
        },
      );
      const selected=selectedAudioAsset(p.shots[shot.id],entry.asset.id);
      if(selected!==entry.asset.id){
        const soundtrack=await assertAssetIntact(s,owner,p.id,selected),enhanced=path.join(assetDirectory(s,p.id),`${job.id}-cinematic.mp4`);
        await remuxSoundtrack(restored,soundtrack.path,enhanced);
        const variant=await snapshotFile(s,owner,p.id,enhanced,`${shot.shotNumber} finished · Cinematic Audio.mp4`,"video",{...nativeFinal.metadata,cinematicFor:nativeFinal.id,sourceSha256:nativeFinal.sha256,cinematicAudio:soundtrack.asset.metadata.cinematicAudio,inheritedAudioAssetId:selected,visualSourceAssetId:nativeFinal.id});
        nativeFinal.metadata.cinematicVariantId=variant.id;
        s.db.prepare("UPDATE assets SET json=? WHERE id=? AND owner=? AND project=?").run(JSON.stringify(nativeFinal),nativeFinal.id,owner,p.id);
      }
      return nativeFinal;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}
function animatic(p: Project): Timeline {
  const t = structuredClone(EMPTY_TIMELINE);
  for (const shot of allShots(p)) {
    const image = p.shots[shot.id]?.storyboardId;
    if (!image)
      throw new StudioError(`Shot ${shot.shotNumber} needs a storyboard.`);
    t.clips.push({
      id: randomUUID(),
      assetId: image,
      shotId: shot.id,
      in: 0,
      out: plannedSeconds(shot),
      transition: "cut",
      transitionSeconds: 0,
      volume: 0,
    });
  }
  t.audio = p.timeline.audio;
  t.titles = p.timeline.titles;
  return t;
}
export async function executeStudioJob(
  s: StudioStore,
  owner: string,
  job: Job,
) {
  return withConversationAccount(typeof job.input.conversationAccountId==="string"?job.input.conversationAccountId:undefined,
    ()=>withAssistantProvider(job.input.aiProvider==="local3060"?"local3060":"openai",()=>executeScopedStudioJob(s,owner,job)),
    {feature:"production-studio",requestKey:job.id,onRoute:(provider,model)=>{const current=s.job(owner,job.id);
      s.updateJob(owner,job.id,{input:{...current.input,routedProvider:provider,routedModel:model}});}});
}

async function executeScopedStudioJob(s:StudioStore,owner:string,job:Job) {
  const cancel = () => canceled(s, owner, job.id);
  const lease = setInterval(() => {
    try {
      s.updateJob(owner, job.id, {}, Date.now() + 60000);
    } catch {}
  }, 15000);
  let asset: Asset | undefined;
  try {
    assertShotJobSafe(job.kind,job.input);
    if (cancel() && !job.backendId) throw new Error("Canceled");
    if (job.outputAssetId)
      asset = s.asset(owner, job.projectId, job.outputAssetId).asset;
    else if (job.kind === "assistant") {
      if(job.input.workspaceMode==="Edit"||job.input.workspaceMode==="Finish")await runWorkflowAssistant(s,owner,job.input.snapshot as Project,job.input.workspaceMode,String(job.input.shotId||""),String(job.input.message),cancel,message=>s.updateJob(owner,job.id,{message}));
      else if(job.input.directionMode===true)await runShotDirectionAssistant(s,owner,job.input.snapshot as Project,String(job.input.shotId),String(job.input.message),cancel,message=>{s.updateJob(owner,job.id,{message});});
      else if(job.input.promptTarget==="storyboard"||job.input.promptTarget==="video")await runShotPromptAssistant(s,owner,job.input.snapshot as Project,String(job.input.shotId),job.input.promptTarget,String(job.input.message),cancel,message=>{s.updateJob(owner,job.id,{message});});
      else await runAssistant(
        s,
        owner,
        job.projectId,
        job.input.snapshot as Project,
        String(job.input.message),
        job.input.planMode === true,
        cancel,
        typeof job.input.proposalId === "string" ? job.input.proposalId : undefined,
        (message) => { s.updateJob(owner, job.id, { message }); },
        job.input.planningScope as {mode?:string;sceneId?:string}|undefined,
      );
    } else if (job.kind === "asset-analysis" || job.kind === "asset-assistant") {
      const manifest = await runCreateAssistant(s,owner,job.input.snapshot as Project,job.kind === "asset-assistant" ? String(job.input.requirementId) : undefined,String(job.input.message || "Prepare the approved story's reusable assets."),cancel,message => {s.updateJob(owner,job.id,{message});});
      if (job.kind === "asset-analysis" && manifest) {
        // The inventory is committed before publishing completion. A late Cancel
        // must not relabel an already saved result as a failed/unprocessed job.
        const state = analysisCompletion(manifest.items);
        s.updateJob(owner,job.id,{status:"completed",progress:100,message:state,analysisResult:{state,storyKey:manifest.storyKey,storyVersion:manifest.storyVersion,sourceRevision:manifest.sourceRevision ?? (job.input.snapshot as Project).revision,itemCount:manifest.items.length}},0);
        return;
      }
    } else if (job.kind === "preview" || job.kind === "regenerate" || job.kind === "video-edit")
      asset = await pollVideo(s, owner, job, cancel);
    else if(job.kind==="review")asset=await shotReviewProxy(s,owner,job.projectId,String(job.input.assetId),Number(job.input.seconds),job.id,cancel);
    else if (job.kind === "proxy")
      asset = await playbackProxy(
        s,
        owner,
        job.projectId,
        String(job.input.assetId),
        job.id,
        cancel,
      );
    else if (job.kind === "storyboard" || job.kind === "asset-image") asset = await waitStory(s, owner, job);
    else if (job.kind === "voice") asset = await voice(s, owner, job);
    else if (job.kind === "audio-finish") asset = await cinematicAudioFinish(s,owner,job,cancel);
    else if (job.kind === "audio-prepare") asset = await prepareClipAudio(s,owner,job,cancel);
    else if (job.kind === "audio-preview") {
      const p=job.input.snapshot as Project,t=job.input.original?{...p.timeline,audio:[],mixTracks:{},clips:p.timeline.clips.map(c=>({...c,volume:1,audioMode:"original" as const}))}:p.timeline;
      const file=await renderTimeline(s,owner,p.id,t,{aspect:p.brief.aspect,resolution:720,fps:24,format:"mp4",filename:"Audio mix preview"},path.join(assetDirectory(s,p.id),job.id),progress=>s.updateJob(owner,job.id,{progress,message:"Rendering audio-only preview on CPU"}),cancel,true,!!job.input.original);
      asset=await snapshotFile(s,owner,p.id,file,job.input.original?"Original timeline soundtrack":"Edited timeline soundtrack","audio",{audioPreview:true,sourceRevision:p.revision,timelineKey:JSON.stringify(p.timeline),original:!!job.input.original});
    }
    else if (job.kind === "finish") asset = await finish(s, owner, job);
    else {
      const p = job.input.snapshot as Project,
        settings = validateExport(
          job.kind === "animatic"
            ? {
                aspect: p.brief.aspect,
                resolution: 720,
                fps: 24,
                format: "mp4",
                filename: p.name + " animatic",
              }
            : job.input.settings,
        );
      const file = await renderTimeline(
        s,
        owner,
        p.id,
        job.kind === "animatic" ? animatic(p) : p.timeline,
        settings,
        path.join(assetDirectory(s, p.id), job.id),
        (progress) =>
          s.updateJob(owner, job.id, {
            progress,
            message: `Rendering ${Math.round(progress)}%`,
          }),
        cancel,
      );
      asset = await snapshotFile(
        s,
        owner,
        p.id,
        file,
        settings.filename + "." + settings.format,
        "video",
        {
          exportSettings: settings,
          sourceRevision: p.revision,
          kind: job.kind,
        },
      );
    }
    if (cancel()) throw new Error("Canceled");
    if (asset) {
      if (asset.kind === "video" && job.kind !== "proxy" && job.kind !== "review")
        s.enqueue(
          owner,
          job.projectId,
          "proxy",
          { assetId: asset.id },
          `proxy-${asset.id}`,
        );
      if(asset.kind==="video"&&["preview","regenerate","finish","video-edit"].includes(job.kind)&&job.input.shotId){
        const seconds=plannedSeconds(allShots(job.input.snapshot as Project).find(v=>v.id===job.input.shotId)!);
        s.enqueue(owner,job.projectId,"review",{assetId:asset.id,shotId:job.input.shotId,seconds},`review-${asset.id}-${seconds}`);
      }
      s.updateJob(owner, job.id, { outputAssetId: asset.id });
      const a = asset;
      if (job.kind === "asset-image" && job.input.requirementId) s.internalUpdate(owner,job.projectId,p => {
        const item = p.creation?.items.find(i => i.id === job.input.requirementId);
        if (item && p.creation?.storyKey === job.input.sourceStoryKey) item.candidateIds = [...new Set([...item.candidateIds,a.id])];
      });
      if (job.input.shotId && !["audio-finish","audio-prepare"].includes(job.kind))
        s.internalUpdate(owner, job.projectId, (p) => {
          const shot = allShots(p).find((x) => x.id === job.input.shotId);
          if (!shot) return;
          if (job.kind === "storyboard") {
            const previous = (job.input.snapshot as Project).shots[shot.id]
              ?.storyboardId;
            const settings = p.shots[shot.id] || DEFAULT_SHOT;
            p.shots[shot.id]={...settings,storyboardCandidates:[...new Set([...settings.storyboardCandidates||[],a.id])]};
            if (p.shots[shot.id]?.storyboardId === previous && !p.shots[shot.id]?.storyboardApproved)
              p.shots[shot.id] = {
                ...(p.shots[shot.id] || DEFAULT_SHOT),
                storyboardId: a.id,
                storyboardApproved: false,
              };
          }
          if (
            ["preview", "regenerate"].includes(job.kind) &&
            !shot.takes.some((t) => t.generationJobId === job.id)
          )
            shot.takes.push({
              id: job.id,
              version: shot.takes.length + 1,
              status: "complete",
              assetId: a.id,
              generationJobId: job.id,
              productionId: p.id,
              productionSceneId: null,
              previewUrl: null,
              createdAt: Date.now(),
            });
          if (
            job.kind === "finish" &&
            p.shots[shot.id]?.approvedTakeId ===
              (job.input.snapshot as Project).shots[shot.id]?.approvedTakeId &&
            plannedSeconds(shot) === plannedSeconds(allShots(job.input.snapshot as Project).find(v=>v.id===shot.id)!)
          )
            {p.shots[shot.id].finalAssetId = a.id;
             if(a.metadata.cinematicVariantId&&JSON.stringify(p.shots[shot.id].audioSelections||{})===JSON.stringify((job.input.snapshot as Project).shots[shot.id].audioSelections||{}))p.shots[shot.id].audioSelections={...p.shots[shot.id].audioSelections,[a.id]:String(a.metadata.cinematicVariantId)};}

        });
    }
    s.updateJob(
      owner,
      job.id,
      { status: "completed", progress: 100, message: "Complete" },
      0,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Job failed";
    s.updateJob(
      owner,
      job.id,
      {
        status:
          job.kind !== "asset-analysis" && /unconfirmed|interrupted|could not be confirmed|needs attention/i.test(
            message,
          )
            ? "attention"
            : cancel()
              ? "canceled"
              : "failed",
        message: message
          .replace(
            /(?:\/home\/|\/mnt\/|\/opt\/|\/var\/)[^\s)]+/g,
            "[private file]",
          )
          .slice(0, 600),
      },
      0,
    );
  } finally {
    clearInterval(lease);
  }
}
const state = globalThis as typeof globalThis & {
  __productionStudioWorker?: {
    timer: ReturnType<typeof setInterval>;
    active: Set<string>;
  };
};
export function bootstrapStudioWorker() {
  if (
    !productionStudioEnabled() ||
    process.env.OTG_STUDIO_WORKER_DISABLED === "1" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    state.__productionStudioWorker
  )
    return;
  const active = new Set<string>();
  const tick = () => {
    try {
      assertStudioEnabled();
      if (active.size >= 3) return;
      const claimed = studio().claim();
      if (!claimed) return;
      active.add(claimed.job.id);
      void executeStudioJob(studio(), claimed.owner, claimed.job).finally(() =>
        active.delete(claimed.job.id),
      );
    } catch {}
  };
  const timer = setInterval(tick, 2000);
  timer.unref();
  state.__productionStudioWorker = { timer, active };
}
