import {allShots,EMPTY_TIMELINE,type Project,type Workspace,type Timeline,type Clip} from "./model";
import {directionBrief,directionProblems} from "./shotDirection";
import {plannedSeconds} from "./shotPolicy";
import {selectedAudioAsset} from "./audioFinishSettings";
import {activeAudio,nativeVolume} from "./audioMix";
export const WORKSPACES:Workspace[]=["Plan","Cast & World","Storyboard","Action","Edit","Finish"];
export function restoredWorkspace(value:unknown,p?:Project):Workspace {
  if(value==="Export")return "Finish";
  if(value==="Shots")return p&&allShots(p).some(s=>s.takes.length)?"Action":"Storyboard";
  return WORKSPACES.includes(value as Workspace)?value as Workspace:"Plan";
}
export function workingClips(p:Project){
  const ids=p.film?.activeSegmentId?p.film.segments[p.film.activeSegmentId]?.sceneIds:undefined;
  return ids?.length?p.plan.acts.flatMap(a=>a.scenes.filter(s=>ids.includes(s.id)).flatMap(s=>s.shots)):allShots(p);
}
export function storyboardClip(p:Project,id:string){
  const shot=allShots(p).find(s=>s.id===id);if(!shot)throw Error("Choose a video clip.");
  const s=p.shots[id];return {clipId:id,imageId:s.storyboardId||"",frames:s.storyboardFrames||[],brief:directionBrief(p,id),referenceIds:s.storyboardReferenceIds||[],continuity:s.continuityNotes||""};
}
export type StoryboardClip=ReturnType<typeof storyboardClip>;
export const storyboardKey=(p:Project,id:string)=>JSON.stringify(storyboardClip(p,id));
export const storyboardCurrent=(p:Project,id:string)=>!!p.shots[id]?.storyboardApproved&&p.shots[id]?.storyboardApproval?.key===storyboardKey(p,id);
export function storyboardProblems(p:Project,id:string){
  const s=p.shots[id];return [...(!s?.storyboardId||!s.storyboardApproved?["Choose and approve this clip’s storyboard image."]:[]),...directionProblems(p,id)];
}
export function clipEditTimeline(p:Project,id:string,ignoreEdits=false):Timeline {
  if(!ignoreEdits&&p.clipEdits?.[id])return structuredClone(p.clipEdits[id].timeline);
  const shot=allShots(p).find(s=>s.id===id),settings=p.shots[id],take=shot?.takes.find(t=>t.id===settings?.approvedTakeId);
  if(!take?.assetId)throw Error("Approve a completed take in Action before editing this clip.");
  const assetId=selectedAudioAsset(settings,settings.finalAssetId||take.assetId);
  const existing=p.timeline.clips.find(c=>c.shotId===id&&c.assetId===assetId);
  const clip:Clip=existing?{...existing}:{id:`clip-${id}`,shotId:id,assetId,in:0,out:plannedSeconds(shot!),volume:1,transition:"cut",transitionSeconds:0};
  return {...structuredClone(EMPTY_TIMELINE),clips:[clip],audio:p.timeline.audio.filter(a=>a.parentClipId===clip.id).map(a=>structuredClone(a))};
}
/** Assemble from pinned originals/finishes, never playback proxies. Independent
 * music keeps its absolute placement when an individual take is replaced. */
export function assembleClips(p:Project,ids:string[]):Timeline {
  if(!ids.length||new Set(ids).size!==ids.length)throw Error("Select distinct approved clips for assembly.");
  const t:Timeline={...structuredClone(p.timeline),clips:[],audio:p.timeline.audio.filter(a=>!a.parentClipId)};
  for(const id of ids){
    if(p.clipEdits?.[id]?.sourceTakeId&&p.clipEdits[id].sourceTakeId!==p.shots[id]?.approvedTakeId&&p.clipEdits[id].reviewedAgainstTakeId!==p.shots[id]?.approvedTakeId)throw Error("This clip’s edits refer to an earlier take. Review it in Edit and choose which source to keep before updating the assembly.");
    const edit=clipEditTimeline(p,id),old=p.timeline.clips.find(c=>c.shotId===id),revision=p.clipEdits?.[id]?.revision;
    const keepOld=!!old&&old.editRevision===revision&&old.assetId===edit.clips[0]?.assetId;
    const source=keepOld?{...old!}:{...edit.clips[0],volume:nativeVolume(edit,edit.clips[0].id)};
    if(!source)throw Error("The clip edit has no visual source.");
    const clip={...source,id:old?.id||`clip-${id}`,shotId:id,editRevision:revision};t.clips.push(clip);
    const linked=keepOld?p.timeline.audio.filter(a=>a.parentClipId===old!.id):edit.audio;
    t.audio.push(...linked.map(a=>({...a,...(!keepOld?{localMix:edit.mixTracks?.[a.track],muted:!activeAudio(edit,a),solo:false}:{}),id:a.id.startsWith(id+':')?a.id:`${id}:${a.id}`,parentClipId:clip.id})));
  }
  return t;
}
