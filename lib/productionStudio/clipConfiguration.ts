import {allShots,type Project} from "./model";
import {plannedSeconds} from "./shotPolicy";
import {resolveH3RenderSettings} from "@/lib/production/h3Settings";
import {applyH3LoraTriggers} from "@/lib/h3LoraGuidance";
export function clipVisualStyle(p:Project,id:string){const s=p.shots[id],resolved=resolveH3RenderSettings({checkpointMode:s.model,renderMode:s.renderMode||"native",combatLoraEnabled:false});return [p.brief.style||"Cinematic, live-action",applyH3LoraTriggers("",resolved.singularityLoras)].filter(Boolean).join(". ");}
export function clipConfiguration(p:Project,id:string){
 const shot=allShots(p).find(s=>s.id===id)!,s=p.shots[id];
 return {clipId:id,duration:plannedSeconds(shot),mode:shot.generationApproach,model:s.model,renderMode:s.renderMode||(s.model==="fasth3"?"turbo":"native"),loader:s.referenceLoader||"auto",orientation:s.orientation||p.brief.aspect,referenceIds:s.referenceIds,referenceRoles:s.referenceRoles,referenceInput:s.referenceInput||"refmods",refModIds:s.refModIds,firstImageId:s.firstImageId,lastImageId:s.lastImageId,useStartingImage:shot.generationApproach==="image-to-video"||shot.generationApproach==="reference-to-video"&&(s.useStoryboardFirstFrame??!!s.firstImageId),promptSource:s.promptSource||"director"};
}
export function startingImageRequired(p:Project,id:string){return clipConfiguration(p,id).useStartingImage;}
export function startingImageReady(p:Project,id:string){const s=p.shots[id];return !startingImageRequired(p,id)||!!s.firstImageId||!!s.storyboardApproved;}
