import type {Asset,Project} from "./model";
import {allShots} from "./model";
import {shotContext,storyboardPrompt,continuitySource} from "./shotDirector";
import {plannedSeconds} from "./shotPolicy";
import {QWEN_IMAGE_REFERENCE_LIMIT} from "@/lib/imageReferenceLimits";
import {cameraShots} from "./clipPlan";
import {mentionsSubject} from "./shotVisibility";
export function shotTitle(p:Project,id:string){const {shot}=shotContext(p,id);return shot.description.split(/[.!?\n]/)[0].slice(0,100)||`Camera shot ${shot.shotNumber}`;}
export function shotNarration(p:Project,id:string){const {shot,scene,items,settings}=shotContext(p,id);const b=settings.direction?.brief;if(b)return [`Video clip ${allShots(p).findIndex(s=>s.id===id)+1}. ${b.duration} seconds.`,b.startingState,...cameraShots(b).map((c,i)=>`${c.startSeconds} to ${c.endSeconds} seconds. ${i?c.transition+" to ":""}${c.framing}. ${c.action} Camera: ${c.camera}.`),`Ending: ${b.endState}.`,...b.dialogue.map(d=>`${d.speaker}, ${d.channel}, says: ${d.line}`),...b.continuity].join(" ");return [
 `Shot ${allShots(p).findIndex(s=>s.id===id)+1}. ${shotTitle(p,id)}. Planned duration: ${plannedSeconds(shot)} seconds.`,
 `Action: ${shot.description}.`,shot.characterActions&&shot.characterActions!==shot.description?shot.characterActions:"",
 shot.cameraFraming?`Framing: ${shot.cameraFraming}.`:"",shot.cameraMovement?`Camera movement: ${shot.cameraMovement}.`:"",
 `Location: ${scene.location}.`,items.length?`Required assets: ${items.map(i=>i.name).join(", ")}.`:"",
 ...shot.dialogue.filter(d=>d.line.trim()).map(d=>`${d.speaker} says: ${d.line}.${d.delivery?` Delivery: ${d.delivery}.`:""}`),
 settings.continuityNotes||"",
 ].filter(Boolean).join(" ");}
export function relevantEarlierShots(p:Project,id:string){const {shot,scene,settings}=shotContext(p,id),shots=allShots(p),index=shots.findIndex(s=>s.id===id);return shots.slice(0,index).filter(s=>p.shots[s.id]?.storyboardApproved||p.shots[s.id]?.approvedTakeId).map(s=>({shot:s,score:(scene.shots.some(v=>v.id===s.id)?2:0)+(s.cameraFraming.toLowerCase()===shot.cameraFraming.toLowerCase()?3:0)+(settings.cameraSetup&&settings.cameraSetup===p.shots[s.id]?.cameraSetup?5:0)})).sort((a,b)=>b.score-a.score||shots.indexOf(b.shot)-shots.indexOf(a.shot));}
export function prepareShotImage(p:Project,id:string,assets:Asset[]){
 const {shot,settings,items:contextItems,requirements:contextRequirements,ambiguousCharacters}=shotContext(p,id),mode=settings.storyboardMode||"auto",view=settings.direction?.brief.cameraShots?.[0];
 const belongs=(i:(typeof contextItems)[number])=>!view||(i.kind==="character"?view.onScreen.includes(i.name):view.referenceNames.includes(i.name)||mentionsSubject(view.location,i.name)||mentionsSubject(view.action,i.name));
 const items=contextItems.filter(belongs),requirements=contextRequirements.filter(belongs);
 const source=continuitySource(p,id);
 const auto=[...new Set([...items.filter(i=>["environment","character","prop","wardrobe","background"].includes(i.kind)).sort((a,b)=>Number(b.kind==="environment")-Number(a.kind==="environment")).map(i=>i.assetId!),...(source?.settings.storyboardApproved&&source.settings.storyboardId?[source.settings.storyboardId]:[])])];
 const ids=mode==="text"?[]:mode==="references"?settings.storyboardReferenceIds||[]:auto;
 const refs=ids.map(id=>assets.find(a=>a.id===id)),errors:string[]=[],warnings:string[]=[];
 if(mode!=="text"&&!ids.length)errors.push("No approved images are ready for this shot. Choose references, upload a starting image, or explicitly choose Create from Text.");
 if(ids.length>QWEN_IMAGE_REFERENCE_LIMIT)errors.push(`Qwen supports up to ${QWEN_IMAGE_REFERENCE_LIMIT} distinct images. Choose references explicitly; none were omitted.`);
 if(new Set(ids).size!==ids.length)errors.push("Choose each reference only once.");
 for(const [index,a]of refs.entries()){
  if(!a||!["image","character"].includes(a.kind)||!a.mime.startsWith("image/"))errors.push(`Reference ${index+1} is not an available image.`);
  else if(!p.bindings.some(b=>b.assetId===a.id&&b.approved)&&!Object.values(p.shots).some(s=>s.storyboardId===a.id&&s.storyboardApproved))errors.push(`Approve ${a.name} before using it as a reference.`);
 }
 if(mode==="auto"){
  const missing=requirements.filter(i=>["environment","character","prop","wardrobe","background"].includes(i.kind)&&!items.includes(i));
  if(missing.length)errors.push(`Approved references are missing for: ${missing.map(i=>i.name).join(", ")}. Complete them in Cast & World or explicitly review your reference selection.`);
  if(ambiguousCharacters)errors.push("This shot does not identify which of the scene's characters is visible. Use Select References to confirm the cast for this shot.");
 }
 if(mode==="text"&&(requirements.some(i=>i.kind==="character")||ambiguousCharacters))warnings.push("Text-only generation will not use your established character identities. Confirm this intentional choice, or use approved references.");
 if(mode==="references"){const omitted=auto.filter(id=>!ids.includes(id));if(omitted.length)warnings.push("Your custom selection leaves out automatically suggested references. Review the cast, location and continuity before generating.");}
 const defaultPrompt=[storyboardPrompt(p,id),...refs.flatMap((a,i)=>a?[`Image ${i+1}: ${a.name}. ${items.find(v=>v.assetId===a.id)?.kind||"approved visual continuity reference"}.`]:[]),settings.storyboardInstructions?`Director's additional instructions for THIS shot: ${settings.storyboardInstructions}`:"",mode==="text"?"Text-only image requested; no image references were supplied.":"Use every listed image as a separate visual reference. Compose one shot, not a collage, reference sheet or character lineup."].filter(Boolean).join("\n");
 const prompt=settings.storyboardPromptOverride ?? defaultPrompt;
 if(!prompt.trim())errors.push("The starting-image prompt is empty. Write a prompt, ask the AI Director, or Reset from Shot Plan.");
 if(prompt.length>12000)errors.push("Shorten the starting-image prompt to 12000 characters before generating.");
 return {mode,referenceIds:ids,references:refs.filter((a):a is Asset=>!!a),prompt,defaultPrompt,errors,warnings,shotId:shot.id,sourceRevision:p.revision};
}
export function prepareShotVideoPrompt(p:Project,id:string){
 const {shot,scene,settings}=shotContext(p,id);
 const defaultPrompt=[shot.description,shot.characterActions,shot.cameraFraming,shot.cameraMovement,p.brief.style,p.brief.atmosphere,scene.location,scene.timeOfDay,...scene.continuityRequirements,settings.continuityNotes||"",...shot.dialogue.filter(d=>d.line.trim()).map(d=>`${d.speaker} says: ${JSON.stringify(d.line)}${d.delivery?". Delivery: "+d.delivery:""}`)].filter(Boolean).join(". ");
 const prompt=settings.videoPromptOverride ?? defaultPrompt;
 return {prompt,defaultPrompt,errors:!prompt.trim()?["The video prompt is empty. Write a prompt, ask the AI Director, or Reset from Shot Plan."]:prompt.length>12000?["Shorten the video prompt to 12000 characters before generating."]:[]};
}
