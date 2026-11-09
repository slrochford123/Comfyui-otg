import {allShots,DEFAULT_SHOT,type Project} from "./model";
import {directionBrief,directionKey,directionProblems,readDirection,saveDirection,type DirectionBrief,type DirectionLine} from "./shotDirection";
import {nativeShotSeconds,plannedSeconds} from "./shotPolicy";
import {resizeCameraTimeline} from "./clipPlan";
import {deriveAcoustics} from "./acoustics";

const tenth=(n:number)=>Math.ceil((n-1e-8)*10)/10;
export const speechSeconds=(line:string)=>tenth(line.trim().split(/\s+/).filter(Boolean).length/2.8);
/** Proposal only: exact words and speaker/channel identities are never rewritten here. */
export function retimedBrief(source:DirectionBrief,duration:number,preserveStarts=false):DirectionBrief|null{
 nativeShotSeconds(duration);let end=preserveStarts?0:.1;
 const dialogue=source.dialogue.map(d=>{
  const startSeconds=tenth(preserveStarts?Math.max(d.startSeconds,end):end);
  const endSeconds=tenth(startSeconds+Math.max(.1,speechSeconds(d.line)));
  end=endSeconds+.1;return {...d,startSeconds,endSeconds};
 });
 const cameraShots=resizeCameraTimeline(source,duration);
 if(dialogue.some(d=>d.endSeconds>duration)||cameraShots===null)return null;
 return {...structuredClone(source),...(cameraShots?{cameraShots}:{}),duration,dialogue:dialogue.map(d=>({...d,delivery:d.delivery.replace(/[.;]\s*(?:Saved timing.*(?:unresolved|resolution)[\s\S]*|saved timing requires resolution before production\.?)/i,"")})),continuity:source.continuity.filter(c=>!/(?:duration remains .*pending|saved dialogue timing|timing remains unresolved|needs approximately .*not .*seconds)/i.test(c))};
}
export function timingOptions(brief:DirectionBrief){
 const keep=retimedBrief(brief,brief.duration);
 const extended=retimedBrief(brief,10,true);
 const duration=extended?.dialogue.length?Math.min(10,Math.ceil(extended.dialogue.at(-1)!.endSeconds+.8)):brief.duration;
 return {keep,extend:extended&&duration>brief.duration?retimedBrief(brief,duration,true):null};
}
export function proposalProblems(p:Project,id:string,brief:DirectionBrief){
 const copy=structuredClone(p),shot=allShots(copy).find(s=>s.id===id);if(!shot)return ["Shot not found."];
 shot.plannedDurationSeconds=brief.duration;shot.requestedDurationSeconds=nativeShotSeconds(brief.duration);
 return directionProblems(copy,id,brief);
}
/** Called only inside the revision-checked SQLite transaction. No media or storyboard is changed. */
export function applyDirectionChange(p:Project,id:string,value:unknown,durationConsent?:unknown,approve=false){
 const brief=readDirection(value),shot=allShots(p).find(s=>s.id===id);if(!shot)throw Error("Shot not found.");
 if(brief.duration!==plannedSeconds(shot)&&durationConsent!==brief.duration)throw Error(`Choose Extend to ${brief.duration} Seconds or keep ${plannedSeconds(shot)} seconds. Timing has not changed.`);
 const errors=proposalProblems(p,id,brief);if(errors.length)throw Error(errors.join(" "));
 const timingChanged=brief.duration!==plannedSeconds(shot);
 shot.plannedDurationSeconds=brief.duration;shot.requestedDurationSeconds=nativeShotSeconds(brief.duration);
 shot.dialogue=brief.dialogue.map(({speaker,line,delivery,startSeconds,endSeconds})=>({speaker,line,delivery,startSeconds,endSeconds}));
 p.shots[id] ||= {...DEFAULT_SHOT};saveDirection(p,id,brief,approve);
 if(timingChanged){let elapsed=0;for(const scene of p.plan.acts.flatMap(a=>a.scenes)){
  scene.durationTargetSeconds=scene.shots.reduce((n,s)=>n+plannedSeconds(s),0);
  for(const s of scene.shots){s.plannedStartSeconds=elapsed;elapsed+=plannedSeconds(s);}
 }
 p.plan.targetDurationSeconds=elapsed;}
 p.lastChange=`Applied shot ${shot.shotNumber} direction and ${brief.duration}s timing together; existing story narrative, images and takes retained`;
}
export type MoveDialogueProposal={source:DirectionBrief;target:DirectionBrief;targetId:string;targetKey:string;lines:DirectionLine[];alreadyInNext:boolean};
export function moveDialogueProposal(p:Project,id:string):MoveDialogueProposal{
 const shots=allShots(p),index=shots.findIndex(s=>s.id===id),next=shots[index+1];if(!next)throw Error("There is no next shot. Keep this shot and ask the Director to shorten the dialogue, or edit it manually.");
 const source=structuredClone(directionBrief(p,id));
 const conflicting=source.dialogue.filter(d=>d.endSeconds>source.duration||speechSeconds(d.line)>d.endSeconds-d.startSeconds+.15);
 const lines=conflicting.length?conflicting:source.dialogue.slice(-1);if(!lines.length)throw Error("There is no dialogue to move.");
 source.dialogue=source.dialogue.filter(d=>!lines.includes(d));
 if(source.acoustics)source.acoustics={...source.acoustics,sources:source.acoustics.sources.filter(s=>source.dialogue.some(d=>d.speaker===s.identity))};
 const target=structuredClone(directionBrief(p,next.id));
 const same=(a:DirectionLine,b:DirectionLine)=>a.speaker===b.speaker&&a.line===b.line;
 const missing=lines.filter(d=>!target.dialogue.some(t=>same(t,d)));
 target.dialogue=[...missing,...target.dialogue];
 // Moving a voice does not silently add a visible character to the next camera view.
 target.dialogue=target.dialogue.map(d=>({...d,channel:target.onScreen.includes(d.speaker)?"on-screen":d.channel==="phone"?"phone":"off-screen"}));
 for(const d of target.dialogue)if(d.channel!=="on-screen"&&!target.offScreen.some(s=>s.name===d.speaker))target.offScreen.push({name:d.speaker,channel:d.channel});
 if(target.acoustics){const previous=target.acoustics;target.acoustics={...previous,sources:deriveAcoustics(target).sources.map(s=>previous.sources.find(v=>v.identity===s.identity)||s)};}
 let timed=retimedBrief(target,target.duration);
 if(!timed){const maximum=retimedBrief(target,10);if(!maximum)throw Error("These exact lines cannot fit in the next shot within ten seconds. Ask the Director to shorten a line for your approval, or edit manually.");timed={...maximum,duration:Math.ceil(maximum.dialogue.at(-1)!.endSeconds)};}
 return {source:retimedBrief(source,source.duration,true)||source,target:timed,targetId:next.id,targetKey:directionKey(p,next.id),lines,alreadyInNext:missing.length===0};
}
export function applyDialogueMove(p:Project,id:string,targetId:unknown,targetKey:unknown,approved:unknown){
 if(approved!==true)throw Error("Explicitly approve changing both shots before moving dialogue.");
 const proposal=moveDialogueProposal(p,id);
 if(proposal.targetId!==targetId||proposal.targetKey!==targetKey)throw Error("The next shot changed. Review the move again; nothing was moved.");
 applyDirectionChange(p,id,proposal.source);
 const shot=allShots(p).find(s=>s.id===proposal.targetId)!;
 shot.dialogue=proposal.target.dialogue.map(({speaker,line,delivery,startSeconds,endSeconds})=>({speaker,line,delivery,startSeconds,endSeconds}));
 shot.plannedDurationSeconds=proposal.target.duration;shot.requestedDurationSeconds=nativeShotSeconds(proposal.target.duration);
 p.shots[shot.id] ||= {...DEFAULT_SHOT};saveDirection(p,shot.id,proposal.target);
 // The next shot remains a direction draft, not silently approved for generation.
 let elapsed=0;for(const scene of p.plan.acts.flatMap(a=>a.scenes)){scene.durationTargetSeconds=scene.shots.reduce((n,s)=>n+plannedSeconds(s),0);for(const s of scene.shots){s.plannedStartSeconds=elapsed;elapsed+=plannedSeconds(s);}}
 p.plan.targetDurationSeconds=elapsed;
 p.lastChange="Approved dialogue move between two shots; exact words and previous takes retained; next direction needs review";
}
