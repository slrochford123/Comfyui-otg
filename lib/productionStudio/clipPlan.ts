import type {DirectionBrief} from "./shotDirection";
/** A camera composition inside ONE generation. Existing shot IDs remain clip IDs. */
export type CameraShot={id:string;startSeconds:number;endSeconds:number;transition:"cut"|"cross-dissolve"|"fade"|"wipe";framing:string;camera:string;action:string;location:string;lighting:string;onScreen:string[];referenceNames:string[];continuity:string[]};
export function cameraShots(b:DirectionBrief):CameraShot[]{
 return b.cameraShots?.length?b.cameraShots:[{id:"camera-1",startSeconds:0,endSeconds:b.duration,transition:"cut",framing:b.framing,camera:b.camera,action:b.action,location:b.location,lighting:b.lighting,onScreen:b.onScreen,referenceNames:[...b.onScreen,b.location],continuity:b.continuity}];
}
export function clipTimelineProblems(b:DirectionBrief){
 const shots=cameraShots(b),issues:string[]=[];let end=0;
 if(new Set(shots.map(s=>s.id)).size!==shots.length)issues.push("Give each camera view a distinct ID.");
 for(const [i,s]of shots.entries()){
  if(!Number.isFinite(s.startSeconds)||!Number.isFinite(s.endSeconds)||s.endSeconds<=s.startSeconds||Math.abs(s.startSeconds-end)>.001||s.endSeconds>b.duration+.001)issues.push(`Camera view ${i+1} must follow the preceding view without a gap or overlap, inside the clip duration.`);
  if(!s.action.trim()||!s.framing.trim())issues.push(`Describe the action and framing of camera view ${i+1}, or ask the Director to complete it.`);
  end=s.endSeconds;
 }
 if(Math.abs(end-b.duration)>.001)issues.push("The camera sequence must cover the complete clip duration. Adjust its final view or ask the Director to retime it.");
 return issues;
}
/** Keep earlier cut choices while offering a longer final hold. Never silently drop a cut. */
export function resizeCameraTimeline(b:DirectionBrief,duration:number){
 if(!b.cameraShots?.length)return undefined;
 const shots=structuredClone(b.cameraShots);
 if(shots.at(-1)!.startSeconds>=duration)return null;
 shots.at(-1)!.endSeconds=duration;return shots;
}
export function manualPromptProblems(prompt:string,duration:number){
 const issues:string[]=[];
 if(!prompt.trim())issues.push("Paste your H3 prompt, or switch back to AI direction.");
 if(prompt.length>12000)issues.push("Shorten the technical prompt to 12000 characters.");
 let previous=0;
 for(const match of prompt.matchAll(/\[Shot\s+(\d+)\]\s+At\s+(\d+):(\d+(?:\.\d+)?)/g)){
  const at=Number(match[2])*60+Number(match[3]);
  if(at<=previous||at>=duration)issues.push("Camera-cut timestamps must increase and fall inside the planned clip duration. Edit the prompt or change the duration.");
  previous=at;
 }
 return issues;
}
