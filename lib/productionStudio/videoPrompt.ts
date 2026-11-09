import {acousticPrompt} from "./acoustics";
import type {DirectionBrief,DirectionLine} from "./shotDirection";
import {cameraShots,clipTimelineProblems,type CameraShot} from "./clipPlan";
import {mentionsSubject} from "./shotVisibility";
export type SubmittedReference={tag:string;name:string;role:string;kind:"image"|"video"|"audio";assetId?:string;sha256?:string;libraryName?:string;cameraShotIds?:string[]};
export const H3_PROMPT_GUIDANCE={version:"minimax-official-v1",compiler:"multi-cut-clip-v2",base:"https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/base-en.txt",reference:"https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt"};
const stamp=(n:number)=>`${String(Math.floor(n/60)).padStart(2,"0")}:${(n%60).toFixed(3).padStart(6,"0")}`;
/** Split a spoken line at word boundaries. Each original character is emitted once. */
function dialogueParts(d:DirectionLine,shots:CameraShot[]){
 const words=[...d.line.matchAll(/\S+\s*/g)],cross=shots.filter(s=>s.startSeconds<d.endSeconds&&s.endSeconds>d.startSeconds);
 let cursor=0;
 return cross.map((s,i)=>{const end=i===cross.length-1?d.line.length:(words[Math.min(words.length-1,Math.max(0,Math.round(words.length*(s.endSeconds-d.startSeconds)/(d.endSeconds-d.startSeconds))))]?.index??d.line.length);const text=d.line.slice(cursor,end);cursor=end;return{shot:s,text,before:i>0,after:i<cross.length-1};});
}
export function referenceCameraShots(b:DirectionBrief,r:SubmittedReference){
 return cameraShots(b).filter(c=>["camera structure","sound reference","music reference"].includes(r.role)||r.kind==="audio"&&r.role==="voice"&&b.dialogue.some(d=>d.speaker===r.name&&d.startSeconds<c.endSeconds&&d.endSeconds>c.startSeconds)||r.cameraShotIds?.includes(c.id)||c.onScreen.includes(r.name)||c.referenceNames.includes(r.name)||mentionsSubject(c.location,r.name)||mentionsSubject(c.action,r.name));
}
export function compileVideoDirection(b:DirectionBrief,mode:string,refs:SubmittedReference[],nativeSeconds:number,first=false,last=false,visualStyle="Cinematic, live-action"){
 if(![5,10].includes(nativeSeconds)||b.duration>10||b.duration<1||nativeSeconds<b.duration)throw Error("H3 clips must be 1–10 seconds, using a supported native duration.");
 const errors=clipTimelineProblems(b);if(errors.length)throw Error(errors.join(" "));
 const shots=cameraShots(b),refMode=mode==="reference-to-video",finalShot=shots.length;
 const dialogue=[...b.dialogue].sort((a,c)=>a.startSeconds-c.startSeconds),speakers=[...new Set(dialogue.map(d=>d.speaker))];
 const speaker=(name:string)=>`(S${speakers.indexOf(name)+1})`;
 const visuals=refs.filter(r=>r.kind!=="audio"&&!['first-frame','last-frame','camera structure','continuation source'].includes(r.role));
 const subjectNames=[...new Set(visuals.map(r=>r.name))];
 const subject=(name:string)=>refMode&&subjectNames.includes(name)?`<Subject ${subjectNames.indexOf(name)+1}>`:name;
 const clean=(text:string)=>dialogue.reduce((v,d)=>d.line?v.split(d.line).join(""):v,text).trim();
 const timeline=shots.map((c,i)=>{
  const transition=i?`[Shot ${i+1}] At ${stamp(c.startSeconds)}, ${c.transition==="cut"?"the camera cuts to":`the shot transitions with a ${c.transition} to`} `:"[Shot 1] ";
  const opening=i===0?`${refMode?"":visualStyle+". "}${first?"Begin at the supplied frame-zero composition. ":""}${clean(b.startingState)}. `:"";
  const relevant=refs.filter(r=>r.kind!=="audio"&&referenceCameraShots(b,r).some(s=>s.id===c.id));
  const mapped=refMode?relevant.map(r=>`${subject(r.name)} follows ${r.tag} for ${r.role}; preserve identity and design, not the source pose or action.`).join(" "):"";
  const speech=dialogue.flatMap(d=>dialogueParts(d,shots).filter(part=>part.shot.id===c.id).map(part=>{
   const visible=c.onScreen.some(n=>mentionsSubject(d.speaker,n)),who=subject(d.speaker),voice=refs.filter(r=>r.kind==="audio"&&r.role==="voice"&&r.name===d.speaker).map(r=>r.tag).join(", ");
   const channel=d.channel==="narration"?"says in an off-screen voiceover":visible?"says":d.channel==="phone"||b.offScreen.some(v=>v.name===d.speaker&&v.channel==="phone")?"is heard through the phone speaker and says":"speaks off-screen and says";
   return `From ${Math.max(d.startSeconds,c.startSeconds).toFixed(2)}s to ${Math.min(d.endSeconds,c.endSeconds).toFixed(2)}s, ${who} ${speaker(d.speaker)} ${channel}${voice?` using ${voice} for vocal timbre only`:""}${d.delivery?`, ${clean(d.delivery)}`:""}: <d>[${d.language}] ${part.before?"<scenetrans>":""}${part.text}${part.after?"<scenetrans>":""}</d>${d.channel==="narration"?" while the corresponding on-screen character's lips remain completely closed":""}.${part.before||part.after?" The same spoken line continues seamlessly across the cut; do not restart it.":""}`;
  })).join(" ");
  return `${transition}${opening}${clean(c.framing)}. Location: ${clean(c.location)}. ${clean(c.lighting)}. Only these people are visible in this camera view: ${c.onScreen.join(", ")||"none"}. ${clean(c.action)} The camera ${clean(c.camera)||"remains stationary"}. ${mapped} ${speech} ${[...new Set(dialogue.filter(d=>d.startSeconds<c.endSeconds&&d.endSeconds>c.startSeconds).map(d=>d.speaker))].map(name=>`${name}: ${clean(acousticPrompt(b,name,c.id))}`).join(" ")} ${c.continuity.map(clean).join(" ")}${i===finalShot-1?` By ${b.duration.toFixed(2)}s: ${clean(b.endState)}. ${nativeSeconds>b.duration?`Hold this ending until ${nativeSeconds.toFixed(2)}s for the native-source tail, with no additional event, cut or repeated speech. The approved edit ends at ${b.duration.toFixed(2)}s.`:""}`:""}`;
 }).join("\n");
 const sound=`overall_soundscape:${refMode?"\n":" "}${clean(b.soundscape).split(/,\s*/).filter(clause=>!/(?:speakerphone|phone speaker|telephone).*(?:audio|voice)|(?:audio|voice).*(?:speakerphone|phone speaker|telephone)/i.test(clause)).join(", ")||"Natural sounds of the specified action."}${refMode?refs.filter(r=>r.kind==="audio"&&r.role==="sound reference").map(r=>` Use ${r.tag} for sound texture only.`).join(""):""}`;
 const music=`non_diegetic_music:${refMode?"\n":" "}${clean(b.music)||"N/A"}${refMode?refs.filter(r=>r.kind==="audio"&&r.role==="music reference").map(r=>` Reference the musical style of ${r.tag} without copying unrequested lyrics.`).join(""):""}`;
 if(!refMode){
  const alignment=first&&last?`How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${finalShot}) aligns with the ${nativeSeconds.toFixed(2)}-second mark of the target video.`:first?"For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.":last?`How the reference pictures align with the target video — <Picture 1> (from [Shot ${finalShot}]) aligns with the ${nativeSeconds.toFixed(2)}-second mark of the target video.`:"";
  return [alignment,`integrated_multimodal_description: ${timeline}`,sound,music].filter(Boolean).join("\n\n");
 }
 const definitions=subjectNames.map(name=>`${subject(name)} is ${name}, using ${visuals.filter(r=>r.name===name).map(r=>r.tag).join(", ")} for ${visuals.find(r=>r.name===name)!.role}.`);
 const retention=subjectNames.map(name=>{const indices=shots.flatMap((c,i)=>visuals.some(r=>r.name===name&&referenceCameraShots(b,r).some(s=>s.id===c.id))?[`[Shot ${i+1}]`]:[]);return `${subject(name)} (appears in ${indices.join(", ")||"the requested camera views"}): fully_preserved - retain the approved identity and design during the requested action.`;});
 for(const r of refs.filter(r=>r.kind==="audio")){
  definitions.push(`${r.tag} is the ${r.role==="voice"&&speakers.includes(r.name)?`voice-timbre reference for ${subject(r.name)} ${speaker(r.name)}`:r.role}, not an additional visible subject.`);
  retention.push(`${r.tag}: reference - follow ${r.role} without copying unrequested source words.`);
 }
 for(const r of refs.filter(r=>r.role==="camera structure"||r.role==="continuation source")){
  definitions.push(`${r.tag} is the source video for ${r.role}.`);retention.push(`${r.tag} (camera and pacing structure): weak_reference - use only the requested temporal guidance.`);
 }
 for(const r of refs.filter(r=>r.role==="first-frame"||r.role==="last-frame")){
  const n=r.role==="first-frame"?1:finalShot;definitions.push(`${r.tag} is the ${r.role} of [Shot ${n}], connected to native keyframe conditioning.`);retention.push(`${r.tag} ([Shot ${n}] ${r.role}): fully_preserved - retain the anchored composition.`);
 }
 return [`subject_definitions:\n${definitions.join("\n")}`,`summary:\n[reference generation${first||last?" + keyframe completion":""}${refs.some(r=>r.kind==="audio")?" + audio reference":""}] A ${b.duration}-second video clip containing ${shots.length} camera view${shots.length===1?"":"s"}. ${clean(b.objective)}`,`retention_analysis:\n${retention.join("\n")}`,`detailed_description:\nThe target video uses ${visualStyle} and the approved lighting.\n${timeline}\n${b.continuity.map(clean).join(" ")} Preserve the requested camera sequence; do not add other story events or unrequested people.`,sound,music].join("\n\n");
}
