import {readAcoustics,type AcousticDirection} from "./acoustics";
import {allShots,type Project,type Asset} from "./model";
import {plannedSeconds,nativeShotSeconds} from "./shotPolicy";
import {shotPeople,mentionsSubject} from "./shotVisibility";
import {cameraShots,clipTimelineProblems,manualPromptProblems,type CameraShot} from "./clipPlan";
export type DirectionLine={speaker:string;line:string;delivery:string;language:string;channel:"on-screen"|"phone"|"off-screen"|"narration";startSeconds:number;endSeconds:number};
export type DirectionBrief={acoustics?:AcousticDirection;objective:string;startingState:string;action:string;endState:string;camera:string;framing:string;location:string;lighting:string;onScreen:string[];offScreen:{name:string;channel:"phone"|"off-screen"|"narration"}[];dialogue:DirectionLine[];soundscape:string;music:string;continuity:string[];duration:number;cameraShots?:CameraShot[]};
export type ShotDirection={version:1;clipId?:string;brief:DirectionBrief;approvedBrief?:DirectionBrief;approvedKey?:string;approvedAt?:string;imageChange?:string;compiledPrompt?:string;configuration?:Record<string,unknown>;promptHistory?:{prompt:string;at:string;source:string}[];history:{brief:DirectionBrief;at:string;approved:boolean}[]};
export type DirectionProposal={shotId:string;brief:DirectionBrief;basedOnKey:string;imageChange:string;changes:string[]};
const string=(v:unknown,max=3000)=>{if(typeof v!=="string"||v.length>max)throw Error("A direction field is missing or too long.");return v;};
const list=(v:unknown)=>{if(!Array.isArray(v)||v.length>60)throw Error("Invalid direction list.");return v;};
export function readDirection(v:unknown):DirectionBrief{
 if(!v||typeof v!=="object")throw Error("A complete shot direction is required.");const b=v as DirectionBrief;
 const fields=["objective","startingState","action","endState","camera","framing","location","lighting","soundscape","music"] as const;
 const result=Object.fromEntries(fields.map(k=>[k,string(b[k])])) as Pick<DirectionBrief,typeof fields[number]>;
 nativeShotSeconds(b.duration);
 const camera=b.cameraShots===undefined?undefined:list(b.cameraShots).map(s=>{
  if(!s||!["cut","cross-dissolve","fade","wipe"].includes(s.transition)||![s.startSeconds,s.endSeconds].every(Number.isFinite))throw Error("Give each camera view valid timing and a transition.");
  return {id:string(s.id,100),startSeconds:s.startSeconds,endSeconds:s.endSeconds,transition:s.transition,framing:string(s.framing),camera:string(s.camera),action:string(s.action),location:string(s.location),lighting:string(s.lighting),onScreen:list(s.onScreen).map(n=>string(n,200)),referenceNames:list(s.referenceNames).map(n=>string(n,200)),continuity:list(s.continuity).map(n=>string(n,1000))} as CameraShot;
 });
 const parsed={...result,...(camera?{cameraShots:camera}:{}),duration:b.duration,onScreen:list(b.onScreen).map(n=>string(n,200)),offScreen:list(b.offScreen).map(s=>{if(!s||!["phone","off-screen","narration"].includes(s.channel))throw Error("Choose a voice channel.");return{name:string(s.name,200),channel:s.channel};}),continuity:list(b.continuity).map(n=>string(n,1000)),dialogue:list(b.dialogue).map(d=>{
  if(!d||!["on-screen","phone","off-screen","narration"].includes(d.channel)||![d.startSeconds,d.endSeconds].every(Number.isFinite)||d.startSeconds<0||d.endSeconds<=d.startSeconds)throw Error("Give each spoken line a valid time and channel.");
  return {speaker:string(d.speaker,200),line:string(d.line,2000),delivery:string(d.delivery,1000),language:string(d.language,80),channel:d.channel,startSeconds:d.startSeconds,endSeconds:d.endSeconds};
 })} as DirectionBrief;
 return {...parsed,acoustics:readAcoustics(b.acoustics,parsed)};
}
export function directionBrief(p:Project,id:string):DirectionBrief{
 const shot=allShots(p).find(s=>s.id===id)!;if(!shot)throw Error("Shot not found.");
 const settings=p.shots[id];if(settings?.direction)return settings.direction.brief;
 const scene=p.plan.acts.flatMap(a=>a.scenes).find(s=>s.shots.some(sh=>sh.id===id))!,beat=p.plan.storyPreview?.segments.find(b=>b.id===shot.storySegmentId),roles=shotPeople(p,id);
 return {objective:shot.description,startingState:"",action:shot.description||shot.characterActions,endState:"",camera:shot.cameraMovement,framing:shot.cameraFraming,location:beat?.location||scene.location.split(/\n\s*\n/)[0],lighting:beat?.lighting||"",onScreen:roles.onScreen,offScreen:roles.offScreen.map(name=>({name,channel:"phone"})),duration:plannedSeconds(shot),continuity:(settings?.continuityNotes||"").split("\n").filter(Boolean),soundscape:beat?.ambience||"Natural room tone and sounds of the specified action.",music:"N/A",dialogue:shot.dialogue.filter(d=>d.line.trim()).map(d=>({...d,language:"English",channel:roles.offScreen.some(n=>mentionsSubject(d.speaker,n))?"phone":"on-screen",startSeconds:d.startSeconds??0,endSeconds:d.endSeconds??plannedSeconds(shot)}))};
}
export function directionKey(p:Project,id:string,brief=directionBrief(p,id)){
 const shot=allShots(p).find(s=>s.id===id)!,s=p.shots[id];
 return JSON.stringify({brief,shot:{description:shot.description,action:shot.characterActions,dialogue:shot.dialogue,duration:plannedSeconds(shot),method:shot.generationApproach},storyboard:s?.storyboardId,approved:s?.storyboardApproved,model:s?.model,first:s?.firstImageId,last:s?.lastImageId,useFirst:s?.useStoryboardFirstFrame,references:s?.referenceIds,explicit:s?.referenceSelectionExplicit,continuity:s?.continuityNotes,source:s?.continuitySourceShotId,frame:s?.continuityFrameSeconds,bindings:p.bindings.filter(b=>b.approved),clipSettings:{orientation:s?.orientation,loader:s?.referenceLoader,promptSource:s?.promptSource,prompt:s?.promptSource==="manual"?s.videoPromptOverride:undefined,renderMode:s?.renderMode,refModIds:s?.refModIds,referenceInput:s?.referenceInput,referenceRoles:s?.referenceRoles,quality:s?.quality}});
}
export function directionProblems(p:Project,id:string,brief=directionBrief(p,id)){
 const shot=allShots(p).find(s=>s.id===id)!,issues:string[]=[];
 if(p.shots[id]?.promptSource==="manual")return manualPromptProblems(p.shots[id].videoPromptOverride||"",plannedSeconds(shot));
 issues.push(...clipTimelineProblems(brief));
 if(!brief.action.trim()||!brief.startingState.trim()||!brief.endState.trim())issues.push("Describe the starting position, action and ending position, or ask the AI Director to prepare them.");
 if(brief.duration!==plannedSeconds(shot))issues.push("This direction proposes different timing. Choose the duration explicitly before applying it.");
 const visible=[...new Set(cameraShots(brief).flatMap(c=>c.onScreen))];
 let last=0;for(const d of [...brief.dialogue].sort((a,b)=>a.startSeconds-b.startSeconds)){
  const estimate=d.line.trim().split(/\s+/).filter(Boolean).length/2.8;
  if(d.endSeconds>brief.duration||estimate>d.endSeconds-d.startSeconds+.15)issues.push(`${d.speaker}'s line needs about ${estimate.toFixed(1)}s but has ${(d.endSeconds-d.startSeconds).toFixed(1)}s. Shorten it, retime it, or move it to another shot.`);
  if(d.startSeconds<last)issues.push("Spoken lines overlap. Retime them or move a line to another shot.");last=d.endSeconds;
  if(d.channel==="on-screen"&&!cameraShots(brief).some(c=>c.endSeconds>d.startSeconds&&c.startSeconds<d.endSeconds&&c.onScreen.some(n=>mentionsSubject(d.speaker,n))))issues.push(`Identify ${d.speaker} in a camera view during this line, or change the line to an off-screen voice.`);
  if(d.channel!=="on-screen"&&!brief.offScreen.some(n=>mentionsSubject(d.speaker,n.name))&&!visible.some(n=>mentionsSubject(d.speaker,n)))issues.push(`Identify ${d.speaker} as an audio-only subject.`);
 }
 return [...new Set(issues)];
}
export function directionApproved(p:Project,id:string){return p.shots[id]?.direction?.approvedKey===directionKey(p,id)&&!directionProblems(p,id).length;}
export function saveDirection(p:Project,id:string,value:unknown,approve=false){
 const brief=readDirection(value),previous=p.shots[id].direction;
 if(approve){const errors=directionProblems(p,id,brief);if(errors.length)throw Error(errors.join(" "));}
 const next:ShotDirection={version:1,clipId:id,brief,approvedBrief:previous?.approvedBrief,compiledPrompt:previous?.compiledPrompt,configuration:previous?.configuration,promptHistory:previous?.promptHistory,imageChange:previous?.imageChange,history:[...(previous?.history||[]),...(previous?[{brief:previous.brief,at:new Date().toISOString(),approved:!!previous.approvedKey}]:[])]};
 p.shots[id].direction=next;
 if(approve){next.approvedKey=directionKey(p,id);next.approvedAt=new Date().toISOString();next.approvedBrief=structuredClone(brief);}
 p.lastChange=approve?"Approved this shot's video direction; story and storyboard unchanged":"Saved shot direction draft; previous directions and takes retained";
}
export function directionReferences(p:Project,id:string,assets:Asset[],brief=directionBrief(p,id),manualOverride?:boolean){
 const shot=allShots(p).find(s=>s.id===id)!,settings=p.shots[id],items=(p.creation?.items||[]).filter(i=>!i.removedAt&&i.status==="ready"&&i.assetId&&p.bindings.some(b=>b.assetId===i.assetId&&b.approved));
 const views=cameraShots(brief),visible=[...new Set(views.flatMap(c=>c.onScreen))],names=views.flatMap(c=>c.referenceNames),location=views.map(c=>c.location).join(" "),manual=manualOverride??settings.promptSource==="manual";
 const text=[brief.action,brief.startingState,brief.endState,...views.map(c=>c.action),...names].join(" "), selected=settings.referenceSelectionExplicit||settings.referenceIds.length?settings.referenceIds:items.filter(i=>i.kind==="character"?visible.includes(i.name):i.kind==="environment"?names.includes(i.name)||mentionsSubject(location,i.name)||!brief.cameraShots?.length&&i.sourceSegmentIds.includes(shot.storySegmentId||""):["prop","wardrobe","background"].includes(i.kind)&&mentionsSubject(text,i.name.replace(/^.*['’]s\s+/i,""))).map(i=>i.assetId!);
 const refs:{assetId:string;name:string;role:string;characterId:string;audioOnly:boolean}[]=selected.map(id=>{const a=assets.find(a=>a.id===id),item=items.find(i=>i.assetId===id),mapping=settings.referenceRoles?.[id];return{assetId:id,name:mapping?.name||item?.name||a?.name||"Unavailable reference",role:mapping?.role||item?.kind||a?.kind||"image",characterId:String(a?.metadata.sourceId||a?.metadata.characterId||""),audioOnly:false};});
 // Off-screen characters can supply a qualified bundle's audio member only.
 for(const subject of brief.offScreen.filter(s=>brief.dialogue.some(d=>d.speaker===s.name))){const item=items.find(i=>i.kind==="character"&&i.name===subject.name),a=assets.find(a=>a.id===item?.assetId);if(a?.metadata.bundleId&&settings.referenceInput!=="images"&&!refs.some(r=>r.assetId===a.id))refs.push({assetId:a.id,name:subject.name,role:"voice",characterId:String(a.metadata.sourceId||a.metadata.characterId||""),audioOnly:true});}
 const identities=new Set<string>();
 const result=refs.filter(r=>{
  const a=assets.find(a=>a.id===r.assetId),item=items.find(i=>i.assetId===r.assetId);
  if(a?.kind==="character"){
   const name=item?.name||brief.offScreen.find(n=>a.name.startsWith(n.name))?.name||brief.onScreen.find(n=>a.name.startsWith(n))||a.name;
   if(!visible.includes(name)&&brief.offScreen.some(n=>n.name===name)&&!manual){r.audioOnly=true;r.role="voice";}
   else if(!visible.includes(name)&&!manual)throw Error(`${name} is not an on-screen subject. Update the direction before selecting this character.`);
   const identity=r.characterId||a.id;if(identities.has(identity))return false;identities.add(identity);
  }
  return true;
 });
 if(!manual)for(const name of visible)if(!result.some(r=>!r.audioOnly&&r.name===name))throw Error(`The visual reference for ${name} is missing. Approve or select that character in Cast & World, or explicitly change the visible cast. No identity was silently omitted.`);
 return result;
}
