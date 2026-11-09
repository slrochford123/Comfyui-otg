import {selectedAudioAsset} from "./audioFinishSettings";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { changeStory, installStory } from "./storyPlanning";
import { assertStoryComplete } from "./storyPreview";
import { changeCreate, approvedStoryKey } from "./createManifest";
import { analysisCompletion } from "./createTypes";
import { validStoryVoice } from "@/lib/storyCreator/speechVoices";
import { assertShotJobSafe, nativeShotSeconds, plannedSeconds } from "./shotPolicy";
import { approvedSequence, continuitySource } from "./shotDirector";
import { rememberSegment } from "./filmStructure";
import {promptField,shotPromptKey,validPromptOverride} from "./shotPrompts";
import {saveDirection,directionBrief,directionKey} from "./shotDirection";
import {applyDirectionChange,applyDialogueMove,retimedBrief,timingOptions} from "./directionTiming";
import {clipConfiguration} from "./clipConfiguration";
import {resizeCameraTimeline} from "./clipPlan";
import {validateAudioMix} from "./audioMix";
import {WORKSPACES,workingClips,storyboardClip,storyboardKey,storyboardProblems,clipEditTimeline,assembleClips} from "./workflow";
import {workflowAssistantKey,workflowTimeline,applyWorkflowChanges} from "./workflowAssistant";
import {
  normalizeStoryProductionPlan,
  type StoryProductionShot,
} from "@/lib/storyCreator/productionPlan";
import {
  allShots,
  DEFAULT_SHOT,
  EMPTY_TIMELINE,
  type Project,
  type Operation,
  type Timeline,
  type Asset,
  type Job,
  type JobKind,
} from "./model";

export class StudioError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const now = () => new Date().toISOString();
const text = (v: unknown, max = 12000) => String(v ?? "").slice(0, max);
function finite(v: unknown, min: number, max: number) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new StudioError("Invalid numeric setting.");
  return v;
}
function oneOf<T extends string>(v: unknown, values: T[]): T {
  if (!values.includes(v as T)) throw new StudioError("Unsupported option.");
  return v as T;
}
/** Keep camera coverage and readable timing in the same recoverable story version. */
function syncCoverage(p: Project) {
  const preview=p.plan.storyPreview;
  let start=0;
  for(const scene of p.plan.acts.flatMap(a=>a.scenes)) {
    const sceneStory=Object.values(p.film?.segments||{}).find(m=>m.sceneIds.includes(scene.id))?.story || preview;
    const pending=sceneStory?.coveragePending ? sceneStory.segments.filter(b=>(scene.id===b.sceneId||scene.id.endsWith(`--${b.sceneId}`)||scene.id.endsWith(`-${b.id}`))&&!scene.shots.some(s=>s.storySegmentId===b.id)).reduce((n,b)=>n+b.durationSeconds,0) || 0 : 0;
    scene.durationTargetSeconds=scene.shots.reduce((n,s)=>n+plannedSeconds(s),0)+pending;
    for(const shot of scene.shots){shot.plannedStartSeconds=start;start+=plannedSeconds(shot);}
    start+=pending;
  }
  if(preview){
    const scoped=p.film?.activeSegmentId?p.plan.acts.flatMap(a=>a.scenes).filter(c=>p.film!.segments[p.film!.activeSegmentId!]?.sceneIds.includes(c.id)).flatMap(c=>c.shots):allShots(p);
    for(const beat of preview.segments){
      const shots=scoped.filter(s=>s.storySegmentId===beat.id);
      if(!shots.length)continue;
      beat.shots=shots.map(s=>({id:s.id,title:s.shotNumber,action:s.description,durationSeconds:plannedSeconds(s),framing:s.cameraFraming,movement:s.cameraMovement,cameraSetup:p.shots[s.id]?.cameraSetup||s.cameraFraming,continuity:beat.continuity}));
      beat.durationSeconds=shots.reduce((n,s)=>n+plannedSeconds(s),0);
    }
    preview.version++;
    if(p.brief.durationOptional||p.film?.activeSegmentId)preview.targetSeconds=preview.segments.reduce((n,b)=>n+b.durationSeconds,0);
    rememberSegment(p,false);
  }
  p.plan.targetDurationSeconds=start;
}
export function validateTimeline(
  value: unknown,
  assetIds: Set<string>,
): Timeline {
  const t = value as Timeline;
  if (
    !t ||
    !Array.isArray(t.clips) ||
    !Array.isArray(t.audio) ||
    !Array.isArray(t.titles)
  )
    throw new StudioError("Invalid timeline.");
  if (t.clips.length > 1000 || t.audio.length > 2000 || t.titles.length > 2000)
    throw new StudioError("Timeline is too large.");
  const ids = new Set<string>();
  for (const c of [...t.clips, ...t.audio, ...t.titles]) {
    if (!c.id || ids.has(c.id))
      throw new StudioError("Timeline item IDs must be unique.");
    ids.add(c.id);
  }
  for (const c of [...t.clips, ...t.audio]) {
    if (!assetIds.has(c.assetId))
      throw new StudioError(
        "A timeline asset does not belong to this production.",
      );
    finite(c.in, 0, 86400);
    finite(c.out, c.in + 0.01, 86400);
    finite(c.volume, 0, 4);
  }
  for (const [i, c] of t.clips.entries()) {
    oneOf(c.transition, ["cut", "fade", "dissolve"]);
    finite(c.transitionSeconds, 0, 5);
    if (
      c.transition !== "cut" &&
      i > 0 &&
      c.transitionSeconds >=
        Math.min(c.out - c.in, t.clips[i - 1].out - t.clips[i - 1].in) / 2
    )
      throw new StudioError(
        "Transition must be shorter than half either clip.",
      );
  }
  for (const c of t.audio) {
    oneOf(c.track, ["dialogue", "music", "sfx", "ambience"]);
    finite(c.start, c.parentClipId ? -1 : 0, 86400);
    finite(c.fadeIn, 0, c.out - c.in);
    finite(c.fadeOut, 0, c.out - c.in);
  }
  for (const c of t.titles) {
    finite(c.start, 0, 86400);
    finite(c.end, c.start + 0.01, 86400);
    oneOf(c.position, ["top", "center", "bottom"]);
    if (c.text.length > 2000) throw new StudioError("Title is too long.");
  }
  try { validateAudioMix(t); } catch(e) { throw new StudioError((e as Error).message); }
  return JSON.parse(JSON.stringify({ ...t, duckMusic: !!t.duckMusic }));
}
export function createStudioStore(root: string) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const db = new Database(path.join(root, "studio.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner TEXT NOT NULL,revision INTEGER NOT NULL,updated TEXT NOT NULL,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,project TEXT NOT NULL,owner TEXT NOT NULL,path TEXT NOT NULL,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project TEXT NOT NULL,owner TEXT NOT NULL,request_key TEXT NOT NULL,status TEXT NOT NULL,lease INTEGER NOT NULL DEFAULT 0,json TEXT NOT NULL,UNIQUE(owner,request_key));
    CREATE INDEX IF NOT EXISTS studio_projects_owner ON projects(owner);
    CREATE TABLE IF NOT EXISTS revisions(project TEXT NOT NULL,owner TEXT NOT NULL,revision INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(project,revision));
    CREATE INDEX IF NOT EXISTS studio_jobs_status ON jobs(status,lease);`);
  function get(owner: string, id: string): Project {
    const row = db
      .prepare("SELECT json FROM projects WHERE id=? AND owner=?")
      .get(id, owner) as { json: string } | undefined;
    if (!row) throw new StudioError("Production not found.", 404);
    return JSON.parse(row.json);
  }
  function assets(owner: string, id: string): Asset[] {
    get(owner, id);
    return (
      db
        .prepare(
          "SELECT json FROM assets WHERE project=? AND owner=? ORDER BY rowid",
        )
        .all(id, owner) as { json: string }[]
    ).map((r) => JSON.parse(r.json));
  }
  function asset(owner: string, project: string, id: string) {
    get(owner, project);
    const row = db
      .prepare(
        "SELECT path,json FROM assets WHERE id=? AND project=? AND owner=?",
      )
      .get(id, project, owner) as { path: string; json: string } | undefined;
    if (!row) throw new StudioError("Asset not found.", 404);
    return { asset: JSON.parse(row.json) as Asset, path: row.path };
  }
  function write(owner: string, p: Project) {
    db.prepare(
      "INSERT OR IGNORE INTO revisions SELECT id,owner,revision,json FROM projects WHERE id=? AND owner=?",
    ).run(p.id, owner);
    p.revision++;
    p.updatedAt = now();
    db.prepare(
      "UPDATE projects SET revision=?,updated=?,json=? WHERE id=? AND owner=?",
    ).run(p.revision, p.updatedAt, JSON.stringify(p), p.id, owner);
    return p;
  }
  function mutate(
    owner: string,
    id: string,
    revision: number,
    operation: Operation,
  ): Project {
    return db.transaction(() => {
      const p = get(owner, id);
      if (p.revision !== revision)
        throw new StudioError(
          "This production changed elsewhere. Your draft is preserved; reload or reapply it.",
          409,
        );
      const shot = () => {
        const s = allShots(p).find((s) => s.id === operation.shotId);
        if (!s) throw new StudioError("Shot not found.", 404);
        return s;
      };
      switch (operation.type) {
        case "workflow.proposal.accept":
        case "workflow.proposal.reject": {
          const m=p.assistant.find(m=>m.id===operation.messageId),v=m?.workflowSuggestion;
          if(!m||!v||m.decision)throw new StudioError("Choose an unapplied editing proposal.");
          if(operation.type==="workflow.proposal.reject"){m.decision="rejected";break;}
          if(workflowAssistantKey(p,v.workspace,v.clipId)!==v.basedOnKey)throw new StudioError("The edit changed. Ask the filmmaker again; nothing was overwritten.",409);
          const timeline=applyWorkflowChanges(workflowTimeline(p,v.workspace,v.clipId),v.changes);
          validateTimeline(timeline,new Set(assets(owner,p.id).map(a=>a.id)));
          if(v.workspace==="Edit"){
            p.clipEdits ||= {};const e=p.clipEdits[v.clipId] ||= {revision:1,sourceTakeId:p.shots[v.clipId]?.approvedTakeId,timeline:clipEditTimeline(p,v.clipId),history:[],future:[]};
            e.history.push(structuredClone(e.timeline));e.timeline=timeline;e.future=[];e.revision++;
            const prompt=v.changes.find(c=>c.type==="video-prompt");if(prompt)e.videoPrompt=text(prompt.text,4000);
          }else{if(v.changes.some(c=>c.type==="video-prompt"))throw new StudioError("Video corrections belong in Edit.");p.history.push(structuredClone(p.timeline));p.future=[];p.timeline=timeline;}
          m.decision="accepted";p.lastChange="Applied approved filmmaking edit proposal";break;
        }
        case "workflow.navigate": {
          const workspace=oneOf(operation.workspace,WORKSPACES),clipId=operation.clipId?String(operation.clipId):p.workflow?.clipId;
          if(clipId&&!allShots(p).some(s=>s.id===clipId))throw new StudioError("Choose a current video clip.");
          p.workflow={version:2,workspace,...(clipId?{clipId}:{})};break;
        }
        case "storyboard.approve": {
          if(p.plan.status!=="approved")throw new StudioError("Approve the updated clip structure before approving its storyboard.");
          const ids=operation.shotId?[String(operation.shotId)]:workingClips(p).map(s=>s.id);
          if(!ids.length)throw new StudioError("Plan at least one clip.");
          const at=now(),versionId=randomUUID();
          for(const id of ids){
            if(!allShots(p).some(s=>s.id===id))throw new StudioError("Choose a current clip.");
            const problems=storyboardProblems(p,id);if(problems.length)throw new StudioError(problems.join(" "));
            const image=asset(owner,p.id,p.shots[id].storyboardId!).asset;
            if(!image.mime.startsWith("image/"))throw new StudioError("Choose an actual storyboard image.");
            saveDirection(p,id,directionBrief(p,id),true);
            p.shots[id].storyboardApproval={key:storyboardKey(p,id),versionId,at};
          }
          p.storyboards=[...p.storyboards||[],{id:versionId,at,revision:p.revision+1,clips:ids.map(id=>structuredClone(storyboardClip(p,id)))}];
          p.lastChange="Approved storyboard images and timed sequences; no generation started";break;
        }
        case "clip.edit.open": {
          const id=shot().id;
          p.clipEdits ||= {};p.clipEdits[id] ||= {revision:1,sourceTakeId:p.shots[id]?.approvedTakeId,timeline:clipEditTimeline(p,id),history:[],future:[]};break;
        }
        case "clip.edit.rebase": {
          const id=shot().id,e=p.clipEdits?.[id];if(!e)throw new StudioError("Open this clip edit first.");
          e.history.push(structuredClone(e.timeline));e.future=[];e.timeline=clipEditTimeline(p,id,true);e.sourceTakeId=p.shots[id]?.approvedTakeId;e.revision++;break;
        }
        case "clip.edit.keepSource": {
          const id=shot().id,e=p.clipEdits?.[id];if(!e)throw new StudioError("Open the clip edit first.");e.reviewedAgainstTakeId=p.shots[id]?.approvedTakeId;break;
        }
        case "clip.edit.timeline":
        case "clip.edit.undo":
        case "clip.edit.redo": {
          const id=shot().id;p.clipEdits ||= {};
          const e=p.clipEdits[id] ||= {revision:1,sourceTakeId:p.shots[id]?.approvedTakeId,timeline:clipEditTimeline(p,id),history:[],future:[]};
          if(operation.type==="clip.edit.timeline"){
            const next=validateTimeline(operation.timeline,new Set(assets(owner,p.id).map(a=>a.id)));
            if(next.clips.length!==1||next.clips[0].shotId!==id)throw new StudioError("Clip Edit changes one clip. Assemble the movie in Finish.");
            const source=asset(owner,p.id,next.clips[0].assetId).asset;
            if(source.kind!=="video")throw new StudioError("Choose a video source for clip editing.");
            e.history.push(structuredClone(e.timeline));e.future=[];e.timeline=next;
          }else if(operation.type==="clip.edit.undo"&&e.history.length){e.future.push(e.timeline);e.timeline=e.history.pop()!;}
          else if(operation.type==="clip.edit.redo"&&e.future.length){e.history.push(e.timeline);e.timeline=e.future.pop()!;}
          e.revision++;p.lastChange="Saved non-destructive clip edits; original take preserved";break;
        }
        case "clip.edit.prompt": {
          const id=shot().id;p.clipEdits ||= {};const e=p.clipEdits[id] ||= {revision:1,sourceTakeId:p.shots[id]?.approvedTakeId,timeline:clipEditTimeline(p,id),history:[],future:[]};e.videoPrompt=text(operation.prompt,4000);break;
        }
        case "finish.assemble": {
          const ids=operation.shotIds as string[];
          if(!Array.isArray(ids)||ids.some(id=>!allShots(p).some(s=>s.id===id)))throw new StudioError("Choose current clips to assemble.");
          const timeline=assembleClips(p,ids);validateTimeline(timeline,new Set(assets(owner,p.id).map(a=>a.id)));
          p.history.push(structuredClone(p.timeline));p.future=[];p.timeline=timeline;p.lastChange="Assembled approved source clips and edits; continuous music preserved";break;
        }
        case "clip.insert": {
          const previous=shot(),scene=p.plan.acts.flatMap(a=>a.scenes).find(s=>s.shots.includes(previous))!;
          const next=blankShot(scene.shots.length+1),duration=finite(operation.duration,1,10);
          next.description=text(operation.description,3000);if(!next.description.trim())throw new StudioError("Describe the new clip.");
          next.characterActions=next.description;next.plannedDurationSeconds=duration;next.requestedDurationSeconds=nativeShotSeconds(duration);next.storySegmentId=previous.storySegmentId;
          scene.shots.splice(scene.shots.indexOf(previous)+1,0,next);p.shots[next.id]={...DEFAULT_SHOT,referenceIds:[]};scene.shots.forEach((s,i)=>s.order=i);
          p.plan.status="draft";syncCoverage(p);p.workflow={version:2,workspace:"Storyboard",clipId:next.id};break;
        }
        case "clip.method": {
          const clip=shot(),settings=p.shots[clip.id] ||= {...DEFAULT_SHOT,referenceIds:[]};
          const mode=oneOf(operation.method,["image","storyboard-reference","references","text"]);
          if(mode==="image"){
            if(!settings.storyboardApproved&&!settings.firstImageId)throw new StudioError("Approve a storyboard image or select an earlier frame first.");
            clip.generationApproach="image-to-video";
          }else if(mode==="storyboard-reference"){
            if(!settings.storyboardId||!settings.storyboardApproved)throw new StudioError("Approve the storyboard image first.");
            clip.generationApproach="reference-to-video";settings.useStoryboardFirstFrame=false;settings.firstImageId=undefined;
            settings.referenceIds=[settings.storyboardId];settings.referenceSelectionExplicit=true;settings.referenceInput="images";settings.refModIds=[];
            settings.referenceRoles={...settings.referenceRoles,[settings.storyboardId]:{name:directionBrief(p,clip.id).location,role:"environment"}};
          }else if(mode==="references"){
            clip.generationApproach="reference-to-video";settings.useStoryboardFirstFrame=false;settings.firstImageId=undefined;
            if(settings.referenceIds.length===1&&settings.referenceIds[0]===settings.storyboardId){settings.referenceIds=[];settings.referenceSelectionExplicit=false;}
          }else{clip.generationApproach="text-to-video";settings.useStoryboardFirstFrame=false;}
          p.lastChange="Selected video conditioning method; review before generation";break;
        }
        case "brief": {
          const b = operation.patch as Record<string, unknown>;
          for (const [k, v] of Object.entries(b || {})) {
            if (k === "name") p.name = text(v, 200) || "Untitled production";
            else if (["description", "style", "atmosphere", "clipName"].includes(k))
              (p.brief as unknown as Record<string, unknown>)[k] = text(v);
            else if (k === "format")
              p.brief.format = oneOf(v, [
                "movie",
                "anime",
                "commercial",
                "music-video",
                "custom",
              ]);
            else if (k === "aspect")
              p.brief.aspect = oneOf(v, ["landscape", "portrait", "square"]);
            else if (k === "targetSeconds")
              { p.brief.targetSeconds = finite(v, 1, Number.MAX_SAFE_INTEGER / 1000); p.brief.durationOptional = false; }
            else if (k === "durationOptional") p.brief.durationOptional = v === true;
            else throw new StudioError("Unknown project setting.");
          }
          if (p.plan.storyPreview) {
            if (p.plan.status === "approved") p.planningReview = "Planning settings changed. Review the story and any dependent media before approving again.";
            p.plan.status = "draft";
            if (!p.brief.durationOptional && !p.film?.activeSegmentId) {
              p.plan.storyPreview.targetSeconds = p.brief.targetSeconds;
              p.plan.targetDurationSeconds = p.brief.targetSeconds;
            }
          }
          p.lastChange = "Updated Set the Stage";
          break;
        }
        case "plan.replace": {
          const oldShots = new Map(allShots(p).map((s) => [s.id, s]));
          const incoming = normalizeStoryProductionPlan(operation.plan, p.id);
          if (incoming.storyPreview) {
            installStory(p, incoming.storyPreview);
            p.lastChange = "Imported story as a draft for review";
            break;
          }
          p.plan = normalizeStoryProductionPlan(operation.plan, p.id);
          for (const s of allShots(p)) {
            const old = oldShots.get(s.id);
            s.takes = old?.takes || [];
            s.acceptedTakeId = old?.acceptedTakeId || null;
          }
          p.plan.status = "draft";
          const ids = new Set(allShots(p).map(s => s.id));
          p.retiredPlanShots = [...p.retiredPlanShots || [], ...oldShots.values()].filter(s => !ids.has(s.id) && s.takes.length > 0);
          p.brief.targetSeconds = p.plan.targetDurationSeconds;
          p.lastChange = "Imported legacy story as a draft for review";
          break;
        }
        case "plan.approve":
          if (p.plan.storyPreview) assertStoryComplete(p.plan.storyPreview);
          p.plan.status = "approved";
          break;
        case "revision.restore": {
          const row = db
            .prepare(
              "SELECT json FROM revisions WHERE project=? AND owner=? AND revision=?",
            )
            .get(id, owner, Number(operation.revision)) as
            | { json: string }
            | undefined;
          if (!row) throw new StudioError("Saved revision not found.", 404);
          const old: Project = JSON.parse(row.json);
          Object.assign(p, old, {
            revision: p.revision,
            updatedAt: p.updatedAt,
          });
          break;
        }
        case "shot.add": {
          const scene =
            p.plan.acts
              .flatMap((a) => a.scenes)
              .find((s) => s.id === operation.sceneId) ||
            p.plan.acts[0]?.scenes[0];
          if (!scene) throw new StudioError("Add a story scene first.");
          const s = blankShot(scene.shots.length + 1);
          if(p.film?.activeSegmentId)s.id=`${p.film.activeSegmentId}--${s.id}`;
          s.storySegmentId = scene.shots.at(-1)?.storySegmentId;
          s.plannedDurationSeconds = 5; s.requestedDurationSeconds = 5;
          scene.shots.push(s);
          p.shots[s.id] = { ...DEFAULT_SHOT };
          p.plan.status = "draft";
          syncCoverage(p);
          break;
        }
        case "scene.add": {
          if (!p.plan.acts.length)
            throw new StudioError("Create a story act first.");
          const normalized = normalizeStoryProductionPlan(
            {
              acts: [
                { scenes: [{ title: "New scene", shots: [blankShot(1)] }] },
              ],
            },
            p.id,
          );
          p.plan.acts[0].scenes.push(normalized.acts[0].scenes[0]);
          p.plan.status = "draft";
          break;
        }
        case "scene.patch": {
          if (p.plan.storyPreview) throw new StudioError("Edit this scene in the Plan story editor so its narrative and details stay together.");
          const scene = p.plan.acts
            .flatMap((a) => a.scenes)
            .find((s) => s.id === operation.sceneId);
          if (!scene) throw new StudioError("Scene not found.", 404);
          for (const [k, v] of Object.entries(
            (operation.patch as Record<string, unknown>) || {},
          )) {
            if (
              [
                "title",
                "purpose",
                "location",
                "timeOfDay",
                "action",
                "emotionalTone",
              ].includes(k)
            )
              (scene as unknown as Record<string, unknown>)[k] = text(v);
            else if (k === "continuityRequirements" || k === "characters") {
              if (!Array.isArray(v)) throw new StudioError("Expected a list.");
              scene[k] = v.slice(0, 100).map((v) => text(v, 2000));
            } else throw new StudioError("Unknown scene setting.");
          }
          p.plan.status = "draft";
          break;
        }
        case "shot.patch": {
          const s = shot(),
            patch = operation.patch as Record<string, unknown>;
          for (const [k, v] of Object.entries(patch || {})) {
            if (
              [
                "description",
                "cameraFraming",
                "cameraMovement",
                "characterActions",
                "screenplayExcerpt",
              ].includes(k)
            )
              (s as unknown as Record<string, unknown>)[k] = text(v);
            else if (k === "requestedDurationSeconds" || k === "plannedDurationSeconds") {
              s.plannedDurationSeconds = finite(v, 1, 10);
              s.requestedDurationSeconds = nativeShotSeconds(s.plannedDurationSeconds);
            }
            else if (k === "dialogue") {
              if (!Array.isArray(v) || v.length > 100)
                throw new StudioError("Invalid dialogue.");
              s.dialogue = v.map((l) => ({
                speaker: text(l.speaker, 200),
                line: text(l.line, 3000),
                delivery: text(l.delivery, 500),
              }));
            } else if (k === "generationApproach")
              s.generationApproach = oneOf(v, [
                "text-to-video",
                "image-to-video",
                "reference-to-video",
              ]);
            else throw new StudioError("Unknown shot setting.");
          }
          if (Object.keys(patch).some(k=>k!=="generationApproach")) {
            p.plan.status = "draft";
            if(p.shots[s.id]) {p.shots[s.id].storyboardApproved=false;p.shots[s.id].continuityReviewed=false;}
            syncCoverage(p);
          }
          break;
        }
        case "shot.clip.duration": {
          const current=shot(),duration=finite(operation.duration,1,10),brief=directionBrief(p,current.id),views=resizeCameraTimeline(brief,duration);
          if(views===null)throw new StudioError("A camera cut falls beyond that duration. Ask the Director to retime or split the sequence; no cut was removed.");
          current.plannedDurationSeconds=duration;current.requestedDurationSeconds=nativeShotSeconds(duration);
          saveDirection(p,current.id,{...brief,duration,...(views?{cameraShots:views}:{})});
          let elapsed=0;for(const scene of p.plan.acts.flatMap(a=>a.scenes)){scene.durationTargetSeconds=scene.shots.reduce((n,s)=>n+plannedSeconds(s),0);for(const clip of scene.shots){clip.plannedStartSeconds=elapsed;elapsed+=plannedSeconds(clip);}}p.plan.targetDurationSeconds=elapsed;
          p.lastChange="Saved clip duration; review dialogue and camera timing before generation";break;
        }
        case "shot.direction.save":
        case "shot.direction.approve": {
          const current=shot();p.shots[current.id] ||= {...DEFAULT_SHOT};
          if(operation.type==="shot.direction.approve"){
            applyDirectionChange(p,current.id,operation.brief||directionBrief(p,current.id),operation.durationConsent,true);
            const d=p.shots[current.id].direction!;d.configuration=clipConfiguration(p,current.id);
            if(p.shots[current.id].promptSource==="manual"){
              d.compiledPrompt=p.shots[current.id].videoPromptOverride!;d.promptHistory=[...(d.promptHistory||[]),{prompt:d.compiledPrompt,at:now(),source:"manual"}];
            }
            if(p.workflow?.workspace==="Action"&&p.shots[current.id].storyboardApproved&&p.shots[current.id].storyboardApproval){
              const at=now(),versionId=randomUUID();p.shots[current.id].storyboardApproval={key:storyboardKey(p,current.id),at,versionId};
              p.storyboards=[...p.storyboards||[],{id:versionId,at,revision:p.revision+1,clips:[structuredClone(storyboardClip(p,current.id))]}];
            }
          }
          else saveDirection(p,current.id,operation.brief||directionBrief(p,current.id));
          break;
        }
        case "shot.direction.timing": {
          const current=shot();
          if(operation.basedOnKey!==directionKey(p,current.id))throw new StudioError("The shot changed. Review this timing correction again.",409);
          if(operation.choice==="move")applyDialogueMove(p,current.id,operation.targetId,operation.targetKey,operation.approveBothShots);
          else {
            const brief=directionBrief(p,current.id),next=operation.choice==="extend"?timingOptions(brief).extend:operation.choice==="keep"?retimedBrief(brief,brief.duration):null;
            if(!next)throw new StudioError("These exact lines do not fit. Ask the Director to adjust dialogue for your approval, or edit manually.");
            applyDirectionChange(p,current.id,next,operation.durationConsent);
          }
          break;
        }
        case "shot.direction.accept":
        case "shot.direction.reject": {
          const message=p.assistant.find(m=>m.id===operation.messageId),proposal=message?.directionSuggestion;
          if(!message||!proposal||message.decision)throw new StudioError("Choose an undecided direction proposal.",409);
          if(operation.type==="shot.direction.reject"){message.decision="rejected";break;}
          if(directionKey(p,proposal.shotId)!==proposal.basedOnKey)throw new StudioError("The shot or its references changed. Ask the director again; nothing was replaced.",409);
          if(p.shots[proposal.shotId].promptSource==="manual")throw new StudioError("Switch to AI direction before applying an AI proposal. Your manual prompt remains saved.");
          applyDirectionChange(p,proposal.shotId,proposal.brief,operation.durationConsent);
          p.shots[proposal.shotId].direction!.imageChange=proposal.imageChange;
          message.decision="accepted";
          message.appliedDirection={at:now(),revision:p.revision+1,duration:proposal.brief.duration};
          for(const other of p.assistant)if(other!==message&&!other.decision&&other.directionSuggestion?.shotId===proposal.shotId)other.decision="superseded";
          break;
        }
        case "shot.prompt.accept":
        case "shot.prompt.reject": {
          const message=p.assistant.find(m=>m.id===operation.messageId),proposal=message?.shotPromptSuggestion;
          if(!message||!proposal||message.decision)throw new StudioError("Choose an undecided prompt proposal.",409);
          if(operation.type==="shot.prompt.reject"){message.decision="rejected";break;}
          if(shotPromptKey(p,proposal.shotId,proposal.target,assets(owner,id))!==proposal.basedOnKey)throw new StudioError("This shot's prompt or references changed. Ask the director again with the latest prompt; nothing was replaced.",409);
          const settings=p.shots[proposal.shotId]||{...DEFAULT_SHOT};
          settings[promptField(proposal.target)]=validPromptOverride(proposal.prompt);
          p.shots[proposal.shotId]=settings;
          message.decision="accepted";
          for(const other of p.assistant)if(other!==message&&!other.decision&&other.shotPromptSuggestion?.shotId===proposal.shotId&&other.shotPromptSuggestion.target===proposal.target)other.decision="superseded";
          p.lastChange=`Applied director's ${proposal.target==="video"?"video":"starting-image"} prompt; approved plan and media unchanged`;
          break;
        }
        case "shot.settings": {
          const s = shot(),
            previous = p.shots[s.id] || DEFAULT_SHOT,
            patch = operation.patch as Record<string, unknown>,
            next = { ...previous };
          for (const [k, v] of Object.entries(patch || {})) {
            if(k === "shotStage") next.shotStage=oneOf<"image"|"direction"|"review">(v,["image","direction","review"]);
            else if(k === "retakeMode") next.retakeMode=v===true;
            else if(k === "orientation") next.orientation=oneOf<"landscape"|"portrait">(v,["landscape","portrait"]);
            else if(k === "renderMode") next.renderMode=oneOf<"native"|"turbo">(v,["native","turbo"]);
            else if(k === "quality") next.quality=oneOf<"sh"|"hq">(v,["sh","hq"]);
            else if(k === "referenceLoader") next.referenceLoader=oneOf<"auto"|"native"|"refmods"|"combined">(v,["auto","native","refmods","combined"]);
            else if(k === "referenceInput") next.referenceInput=oneOf<"images"|"refmods">(v,["images","refmods"]);
            else if(k === "promptSource") next.promptSource=oneOf<"director"|"manual">(v,["director","manual"]);
            else if(k === "referenceRoles"){
              if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).length>12)throw new StudioError("Choose valid reference roles.");
              next.referenceRoles={};for(const [key,value]of Object.entries(v as Record<string,{name:string;role:string}>)){asset(owner,p.id,key);next.referenceRoles[key]={name:text(value.name,200),role:oneOf(value.role,["character identity and wardrobe","environment","prop","camera structure","voice","sound reference","music reference"])};}
            }
            else if(k === "referenceSelectionExplicit") next.referenceSelectionExplicit=v===true;
            else if(k === "refModIds") {
              if(v===undefined||v===null){next.refModIds=undefined;continue;}
              if(!Array.isArray(v)||v.length>8)throw new StudioError("Choose up to eight pinned character RefMods.");
              v.forEach(id=>{const a=asset(owner,p.id,String(id)).asset;if(a.kind!=="character"||!a.metadata.bundleId)throw new StudioError("Choose a character with a validated saved RefMod bundle.");});next.refModIds=v.map(String);
            }
            else if (k === "model")
              next.model = oneOf(v, [
                "standard",
                "singularity",
                "singularity-v1.3",
                "fasth3",
              ]);
            else if (k === "continuity")
              next.continuity = oneOf(v, [
                "new-scene",
                "new-angle",
                "previous-frame",
              ]);
            else if (k === "continuitySourceShotId") next.continuitySourceShotId = v ? String(v) : undefined;
            else if (k === "continuityFrameSeconds") next.continuityFrameSeconds = v === null ? undefined : finite(v,0,10);
            else if (k === "cameraSetup" || k === "continuityNotes" || k === "storyboardInstructions") next[k] = text(v,6000);
            else if (k === "storyboardPromptOverride" || k === "videoPromptOverride") next[k]=validPromptOverride(v);
            else if (k === "storyboardMode") next.storyboardMode=oneOf<"auto"|"references"|"text">(v,["auto","references","text"]);
            else if(k==="storyboardFrames"){
              if(!Array.isArray(v)||v.length>16)throw new StudioError("Choose up to 16 optional storyboard frames.");
              next.storyboardFrames=v.map(f=>{
                const a=asset(owner,p.id,String(f.assetId)).asset;if(!a.mime.startsWith("image/"))throw new StudioError("Choose an image for a storyboard frame.");
                return {assetId:a.id,seconds:finite(f.seconds,0,plannedSeconds(s)),caption:text(f.caption,500)};
              }).sort((a,b)=>a.seconds-b.seconds);
            }
            else if (k === "useStoryboardFirstFrame") next.useStoryboardFirstFrame=v===true;
            else if (k === "storyboardReferenceIds") {
              if(!Array.isArray(v)||v.length>16||new Set(v).size!==v.length)throw new StudioError("Choose up to 16 distinct storyboard references; none were discarded.");
              v.forEach(id=>{const a=asset(owner,p.id,String(id)).asset;if(!a.mime.startsWith("image/"))throw new StudioError("Choose image references.");});
              next.storyboardReferenceIds=v.map(String);
            }
            else if (k === "continuityReviewed") next.continuityReviewed = v === true;
            else if (k === "seed")
              next.seed = v === null ? null : finite(v, 0, 4294967295);
            else if (
              ["firstImageId", "lastImageId", "storyboardId"].includes(k)
            ) {
              if (v) asset(owner, id, String(v));
              (next as unknown as Record<string, unknown>)[k] = v
                ? String(v)
                : undefined;
            } else if (k === "referenceIds") {
              if (!Array.isArray(v) || v.length > 12)
                throw new StudioError("Too many references.");
              v.forEach((a) => asset(owner, id, String(a)));
              next.referenceIds = v.map(String);
              next.referenceSelectionExplicit = true;
            } else if (k === "storyboardApproved")
              next.storyboardApproved = v === true;
            else throw new StudioError("Unknown generation setting.");
          }
          if(next.storyboardId!==previous.storyboardId){
            next.storyboardCandidates=[...new Set([...previous.storyboardCandidates||[],previous.storyboardId,next.storyboardId].filter(Boolean) as string[])];
            next.storyboardApproved=patch.storyboardApproved===true;
            if(next.firstImageId===previous.storyboardId)next.firstImageId=undefined;
          }
          p.shots[s.id] = next;
          continuitySource(p,s.id); // validates source ordering even before a frame is extracted
          if (Object.keys(patch).some(k=>["continuitySourceShotId","continuityFrameSeconds","continuityNotes","storyboardId","referenceIds","storyboardReferenceIds","storyboardInstructions","cameraSetup"].includes(k))) next.continuityReviewed=false;
          break;
        }
        case "shot.move": {
          const s = shot(),
            scene = p.plan.acts
              .flatMap((a) => a.scenes)
              .find((c) => c.shots.some((x) => x.id === s.id))!;
          const index = scene.shots.findIndex((x) => x.id === s.id),
            to = Math.max(
              0,
              Math.min(
                scene.shots.length - 1,
                index + (operation.direction === -1 ? -1 : 1),
              ),
            );
          scene.shots.splice(index, 1);
          scene.shots.splice(to, 0, s);
          scene.shots.forEach((s, i) => (s.order = i));
          for(const shot of allShots(p))continuitySource(p,shot.id);
          p.plan.status = "draft";
          syncCoverage(p);
          break;
        }
        case "shot.remove": {
          const target=shot(), scene=p.plan.acts.flatMap(a=>a.scenes).find(s=>s.shots.includes(target))!;
          if(Object.values(p.shots).some(s=>s.continuitySourceShotId===target.id))throw new StudioError("Another shot uses this continuity source. Select its replacement source before removing this shot.");
          if(target.storySegmentId && scene.shots.filter(s=>s.storySegmentId===target.storySegmentId).length===1)throw new StudioError("This is the last camera shot for its story beat. Revise that beat in Plan, or add replacement coverage before removing it.");
          scene.shots=scene.shots.filter(s=>s.id!==target.id);
          if(p.workflow?.clipId===target.id)p.workflow.clipId=scene.shots[0]?.id||allShots(p)[0]?.id;
          p.retiredPlanShots=[...p.retiredPlanShots||[],target];
          p.plan.status="draft";syncCoverage(p);p.lastChange="Removed planned shot; takes and history retained";break;
        }
        case "shots.approve": {
          const shots=allShots(p).filter(s=>!p.film?.activeSegmentId || p.film.segments[p.film.activeSegmentId]?.sceneIds.some(id=>p.plan.acts.flatMap(a=>a.scenes).find(c=>c.id===id)?.shots.includes(s)));
          if(!shots.length||shots.some(s=>!s.description.trim()||!s.cameraFraming.trim()))throw new StudioError("Give each shot an action and camera framing before approving coverage.");
          shots.forEach(s=>nativeShotSeconds(plannedSeconds(s)));syncCoverage(p);
          if(p.plan.storyPreview)assertStoryComplete(p.plan.storyPreview);
          p.plan.status="approved";rememberSegment(p,true);p.lastChange="Approved camera coverage; no generation started";break;
        }
        case "assembly.save": {
          if(!Array.isArray(operation.shotIds))throw new StudioError("Select shots for this assembly.");
          const timeline=approvedSequence(p,assets(owner,id),operation.shotIds.map(String),operation.maxSeconds===undefined?undefined:Number(operation.maxSeconds));
          validateTimeline(timeline,new Set(assets(owner,id).map(a=>a.id)));
          p.assemblies=[...p.assemblies||[],{id:randomUUID(),name:text(operation.name,200)||"Approved sequence",createdAt:now(),revision:p.revision,timeline}];
          p.lastChange="Saved recoverable review sequence using original sources";break;
        }
        case "assembly.edit": {
          const assembly=p.assemblies?.find(a=>a.id===operation.assemblyId);
          if(!assembly)throw new StudioError("Saved assembly not found.");
          p.history.push(structuredClone(p.timeline));p.future=[];
          if(operation.append===true){
            const offset=p.timeline.clips.reduce((n,c,i)=>n+c.out-c.in-(i&&c.transition!=="cut"?c.transitionSeconds:0),0),next=structuredClone(assembly.timeline);
            p.timeline.clips.push(...next.clips.map(c=>({...c,id:randomUUID()})));
            p.timeline.audio.push(...next.audio.map(c=>({...c,id:randomUUID(),start:c.start+offset})));
            p.timeline.titles.push(...next.titles.map(c=>({...c,id:randomUUID(),start:c.start+offset,end:c.end+offset})));
          }else p.timeline=structuredClone(assembly.timeline);
          p.lastChange="Loaded source-linked assembly into Edit; previous timeline kept in undo/history";break;
        }
        case "audio.select": {
          const sh=shot(),sourceId=String(operation.sourceId),chosen=String(operation.assetId),settings=p.shots[sh.id];
          if(!sh.takes.some(t=>t.assetId===sourceId)&&settings.finalAssetId!==sourceId)throw new StudioError("Choose a saved clip take or finish.");
          const source=asset(owner,id,sourceId).asset,variant=asset(owner,id,chosen).asset;
          if(chosen!==sourceId&&(variant.metadata.cinematicFor!==sourceId||variant.metadata.sourceSha256!==source.sha256||variant.metadata.visualSourceAssetId!==sourceId))throw new StudioError("This soundtrack belongs to another video version.");
          const prior=selectedAudioAsset(settings,sourceId);
          let finalUpdate:{sourceId:string;prior:string;chosen:string}|undefined;
          const approved=sh.takes.find(t=>t.id===settings.approvedTakeId);
          if(approved?.assetId===sourceId&&settings.finalAssetId){
            const finalId=settings.finalAssetId,final=asset(owner,id,finalId).asset;
            if(chosen!==sourceId){
              if(variant.metadata.cinematicFinalSourceId!==finalId||!variant.metadata.cinematicFinalVariantId)throw new StudioError("This clip has a newer finished video. Enhance audio on that finished video below, or render a new audio comparison for this take.");
              const companion=asset(owner,id,String(variant.metadata.cinematicFinalVariantId)).asset;
              if(companion.metadata.cinematicFor!==finalId||companion.metadata.sourceSha256!==final.sha256||companion.metadata.inheritedAudioAssetId!==chosen)throw new StudioError("The finished soundtrack version does not match this video.");
              finalUpdate={sourceId:finalId,prior:selectedAudioAsset(settings,finalId),chosen:companion.id};
            }else if(prior!==sourceId){
              const previous=asset(owner,id,prior).asset;
              if(previous.metadata.cinematicFinalSourceId===finalId&&selectedAudioAsset(settings,finalId)===previous.metadata.cinematicFinalVariantId)finalUpdate={sourceId:finalId,prior:selectedAudioAsset(settings,finalId),chosen:finalId};
            }
          }
          settings.audioSelections={...settings.audioSelections,[sourceId]:chosen};
          if(finalUpdate)settings.audioSelections[finalUpdate.sourceId]=finalUpdate.chosen;
          settings.audioDecisions=[...settings.audioDecisions||[],{sourceId,assetId:chosen,decision:chosen===sourceId?"original":"cinematic",at:now()}];
          p.history.push(structuredClone(p.timeline));p.future=[];
          for(const c of p.timeline.clips)if([sourceId,prior].includes(c.assetId))c.assetId=chosen;
          if(finalUpdate)for(const c of p.timeline.clips)if([finalUpdate.sourceId,finalUpdate.prior].includes(c.assetId))c.assetId=finalUpdate.chosen;
          p.lastChange=chosen===sourceId?"Original audio selected; cinematic versions retained":"Cinematic audio selected for this video; original retained";
          break;
        }
        case "take.approve": {
          const s = shot(),
            take = s.takes.find((t) => t.id === operation.takeId);
          if (!take?.assetId || !["complete", "accepted"].includes(take.status))
            throw new StudioError("Only a completed take can be approved.");
          s.acceptedTakeId = take.id;
          take.status = "accepted";
          p.shots[s.id] = {
            ...(p.shots[s.id] || DEFAULT_SHOT),
            approvedTakeId: take.id,
            finalAssetId: p.shots[s.id]?.approvedTakeId===take.id?p.shots[s.id]?.finalAssetId:undefined,
          };
          break;
        }
        case "asset.bind": {
          const a = asset(owner, id, String(operation.assetId)).asset;
          p.bindings = p.bindings.filter((b) => b.assetId !== a.id);
          p.bindings.push({
            assetId: a.id,
            role: text(operation.role, 200),
            approved: operation.approved === true,
          });
          break;
        }
        case "character.voice": {
          const character = asset(
            owner,
            id,
            String(operation.characterId),
          ).asset;
          if (character.kind !== "character")
            throw new StudioError("Choose a pinned character.");
          const voiceId = String(operation.voiceId || "");
          if (voiceId) {
            const voice = asset(owner, id, voiceId).asset;
            if (
              voice.kind !== "audio" ||
              !p.bindings.some((b) => b.assetId === voiceId && b.approved)
            )
              throw new StudioError(
                "Approve the voice reference before assigning it.",
              );
          }
          p.characterVoices = { ...p.characterVoices };
          if (voiceId) p.characterVoices[character.id] = voiceId;
          else delete p.characterVoices[character.id];
          break;
        }
        case "narrator.voice": {
          if (!validStoryVoice("paradee", operation.voice)) throw new StudioError("Choose one of Story Creator's four narrator voices.");
          p.narratorVoice = operation.voice as Project["narratorVoice"];
          p.lastChange = "Changed the CPU narrator voice; character voices are unchanged";
          break;
        }
        case "timeline.set": {
          const t = validateTimeline(
            operation.timeline,
            new Set(assets(owner, id).map((a) => a.id)),
          );
          p.history.push(p.timeline);
          p.history = p.history.slice(-100);
          p.future = [];
          p.timeline = t;
          break;
        }
        case "timeline.undo": {
          const t = p.history.pop();
          if (t) {
            p.future.push(p.timeline);
            p.timeline = t;
          }
          break;
        }
        case "timeline.redo": {
          const t = p.future.pop();
          if (t) {
            p.history.push(p.timeline);
            p.timeline = t;
          }
          break;
        }
        default:
          if(operation.type==="create.delete") {
            const active=db.prepare("SELECT json FROM jobs WHERE project=? AND owner=? AND status IN ('queued','running','canceling')").all(id,owner) as {json:string}[];
            if(active.some(row=>{const j=JSON.parse(row.json) as Job;return j.kind==="asset-analysis"||j.input.requirementId===operation.itemId;}))throw new StudioError("Wait for or cancel the active request before deleting this item.",409);
          }
          if (changeCreate(p, operation, id => asset(owner, p.id, id).asset)) break;
          if (changeStory(p, operation, n => revisionProject(owner, id, n))) break;
          throw new StudioError("Unsupported production change.");
      }
      return write(owner, p);
    })();
  }
  function create(owner: string, name: string) {
    const id = randomUUID(),
      plan = normalizeStoryProductionPlan(
        {
          title: text(name, 200),
          format: "movie",
          acts: [
            {
              title: "Act 1",
              scenes: [
                {
                  title: "Scene 1",
                  shots: [blankShot(1)],
                },
              ],
            },
          ],
        },
        id,
      );
    const p: Project = {
      schemaVersion: 1,
      id,
      name: text(name, 200) || "Untitled production",
      revision: 1,
      createdAt: now(),
      updatedAt: now(),
      brief: {
        description: "",
        format: "movie",
        style: "",
        atmosphere: "",
        aspect: "landscape",
        targetSeconds: 60,
        durationOptional: true,
      },
      storyProjectId: null,
      storyPlanVersion: null,
      plan,
      shots: {},
      bindings: [],
      timeline: structuredClone(EMPTY_TIMELINE),
      history: [],
      future: [],
      assistant: [],
    };
    db.prepare("INSERT INTO projects VALUES(?,?,?,?,?)").run(
      id,
      owner,
      1,
      p.updatedAt,
      JSON.stringify(p),
    );
    return p;
  }
  function job(owner: string, id: string): Job {
    const row = db
      .prepare("SELECT json FROM jobs WHERE owner=? AND id=?")
      .get(owner, id) as { json: string } | undefined;
    if (!row) throw new StudioError("Job not found.", 404);
    return JSON.parse(row.json);
  }
  function updateJob(
    owner: string,
    id: string,
    patch: Partial<Job>,
    lease?: number,
  ) {
    const j = { ...job(owner, id), ...patch, id, updatedAt: now() };
    db.prepare(
      "UPDATE jobs SET status=?,json=?,lease=COALESCE(?,lease) WHERE owner=? AND id=?",
    ).run(j.status, JSON.stringify(j), lease ?? null, owner, id);
    return j;
  }
  function revisionProject(owner: string, id: string, revision: number): Project {
    get(owner, id);
    const row = db.prepare("SELECT json FROM revisions WHERE project=? AND owner=? AND revision=?").get(id, owner, revision) as { json: string } | undefined;
    if (!row) throw new StudioError("Saved revision not found.", 404);
    return JSON.parse(row.json);
  }
  return {
    db,
    root,
    get,
    create,
    mutate,
    assets,
    asset,
    job,
    updateJob,
    revisionProject,
    revisions: (owner: string, id: string) => {
      get(owner, id);
      return (
        db
          .prepare(
            "SELECT revision,json FROM revisions WHERE project=? AND owner=? ORDER BY revision DESC LIMIT 100",
          )
          .all(id, owner) as { revision: number; json: string }[]
      ).map((r) => ({
        revision: r.revision,
        updatedAt: (JSON.parse(r.json) as Project).updatedAt,
        summary: (JSON.parse(r.json) as Project).lastChange || "Saved production changes",
      }));
    },
    list: (owner: string) =>
      (
        db
          .prepare(
            "SELECT json FROM projects WHERE owner=? ORDER BY updated DESC",
          )
          .all(owner) as { json: string }[]
      ).map((r) => {
        const p: Project = JSON.parse(r.json);
        return {
          id: p.id,
          name: p.name,
          revision: p.revision,
          updatedAt: p.updatedAt,
        };
      }),
    internalUpdate: (owner: string, id: string, fn: (p: Project) => void) =>
      db.transaction(() => {
        const p = get(owner, id);
        fn(p);
        return write(owner, p);
      })(),
    addAsset: (owner: string, project: string, a: Asset, file: string) => {
      get(owner, project);
      db.prepare("INSERT INTO assets VALUES(?,?,?,?,?)").run(
        a.id,
        project,
        owner,
        file,
        JSON.stringify(a),
      );
      return a;
    },
    jobs: (owner: string, project: string) => {
      get(owner, project);
      return (
        db
          .prepare(
            "SELECT json FROM jobs WHERE owner=? AND project=? ORDER BY rowid DESC",
          )
          .all(owner, project) as { json: string }[]
      ).map((r) => JSON.parse(r.json) as Job);
    },
    enqueue: (
      owner: string,
      project: string,
      kind: JobKind,
      input: Record<string, unknown>,
      key: string,
    ) =>
      db.transaction(() => {
        const current=get(owner, project);
        assertShotJobSafe(kind,input);
        const old = db
          .prepare("SELECT json FROM jobs WHERE owner=? AND request_key=?")
          .get(owner, key) as { json: string } | undefined;
        if (old) {
          const existing: Job = JSON.parse(old.json);
          if (existing.projectId !== project || existing.kind !== kind)
            throw new StudioError(
              "Request key reused for another operation.",
              409,
            );
          return existing;
        }
        if(input.requirementId&&!current.creation?.items.some(i=>i.id===input.requirementId))throw new StudioError("This project item was removed. Restore it before starting another request.",409);
        const j: Job = {
          id: randomUUID(),
          projectId: project,
          kind,
          input,
          status: "queued",
          progress: 0,
          message: "Queued",
          outputAssetId: null,
          backendId: null,
          createdAt: now(),
          updatedAt: now(),
          attempt: 1,
        };
        db.prepare(
          "INSERT INTO jobs(id,project,owner,request_key,status,json) VALUES(?,?,?,?,?,?)",
        ).run(j.id, project, owner, key, j.status, JSON.stringify(j));
        return j;
      })(),
    claim: () =>
      db.transaction(() => {
        const row = db
          .prepare(
            "SELECT id,owner,json FROM jobs WHERE status='queued' OR (status IN ('running','canceling') AND lease<?) ORDER BY rowid LIMIT 1",
          )
          .get(Date.now()) as
          | { id: string; owner: string; json: string }
          | undefined;
        if (!row) return null;
        const j: Job = JSON.parse(row.json);
        if(j.kind === "asset-analysis" && j.status !== "queued") {
          const p = get(row.owner,j.projectId), m = p.creation;
          // Recover the commit/completion boundary after a server restart without
          // another paid request. Never recover a different approved story.
          if(m && m.storyKey === approvedStoryKey(j.input.snapshot as Project)) {
            updateJob(row.owner,j.id,{status:"completed",progress:100,message:analysisCompletion(m.items)},0);
            return null;
          }
        }
        try { assertShotJobSafe(j.kind,j.input); } catch(e) {
          updateJob(row.owner,j.id,{status:"attention",message:e instanceof Error?e.message:"Invalid shot duration"},0);
          return null;
        }
        if (
          j.status !== "queued" &&
          !j.backendId &&
          [
            "assistant",
            "asset-analysis",
            "asset-assistant",
            "asset-image",
            "voice",
            "storyboard",
            "preview",
            "regenerate",
            "finish",
            "video-edit",
          ].includes(j.kind)
        ) {
          updateJob(
            row.owner,
            j.id,
            {
              status: "attention",
              message:
                "Interrupted submission. Check the linked service before retrying; no automatic duplicate was submitted.",
            },
            0,
          );
          return null;
        }
        return {
          owner: row.owner,
          job: updateJob(
            row.owner,
            j.id,
            {
              status: j.status === "canceling" ? "canceling" : "running",
              message: "Working",
            },
            Date.now() + 60000,
          ),
        };
      })(),
  };
}
function blankShot(n: number): StoryProductionShot {
  return {
    id: randomUUID(),
    order: n - 1,
    shotNumber: String(n),
    description: "",
    cameraFraming: "Medium shot",
    cameraMovement: "",
    characterActions: "",
    screenplayExcerpt: "",
    dialogue: [],
    referenceAssetIds: [],
    generationApproach: "text-to-video",
    requestedDurationSeconds: 10,
    status: "planned",
    acceptedTakeId: null,
    takes: [],
  };
}
export type StudioStore = ReturnType<typeof createStudioStore>;
