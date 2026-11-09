import type {Asset, Project} from "./model";
import {shotContext} from "./shotDirector";
import {prepareShotImage, prepareShotVideoPrompt} from "./shotPreparation";
export type PromptTarget = "storyboard" | "video";
export type ShotPromptSuggestion = {shotId:string; target:PromptTarget; prompt:string; basedOnKey:string};
export const SHOT_PROMPT_LIMIT = 12000;
export function promptField(target:PromptTarget) {
  return target === "storyboard" ? "storyboardPromptOverride" : "videoPromptOverride";
}
export function validPromptOverride(value:unknown):string|undefined {
  if (value === null) return undefined;
  if (typeof value !== "string" || value.length > SHOT_PROMPT_LIMIT) throw Error(`A shot prompt must be text of at most ${SHOT_PROMPT_LIMIT} characters. Use Clear Prompt to leave it empty.`);
  return value;
}
/** Relevant context, not the whole project revision. Take/job progress does not stale a proposal. */
export function shotPromptContext(p:Project, shotId:string, target:PromptTarget, assets:Asset[]) {
  const {shot,scene,settings}=shotContext(p,shotId);
  const prepared=target==="storyboard" ? prepareShotImage(p,shotId,assets) : prepareShotVideoPrompt(p,shotId);
  const referenceIds=target==="storyboard" ? prepareShotImage(p,shotId,assets).referenceIds : settings.referenceIds;
  return {shotId,target,prompt:prepared.prompt,defaultPrompt:prepared.defaultPrompt,
    action:shot.description,framing:shot.cameraFraming,movement:shot.cameraMovement,dialogue:shot.dialogue,
    duration:shot.plannedDurationSeconds||shot.requestedDurationSeconds,location:scene.location,lighting:scene.lighting,
    mode:target==="storyboard" ? settings.storyboardMode||"auto" : shot.generationApproach,
    references:referenceIds.map(id=>{const a=assets.find(a=>a.id===id);return {id,name:a?.name,sha256:a?.sha256};}),
    continuity:settings.continuityNotes,sourceShot:settings.continuitySourceShotId,
    firstFrame:target==="video" ? settings.firstImageId||settings.storyboardId : undefined,
    lastFrame:target==="video" ? settings.lastImageId : undefined,
    useStoryboardFirstFrame:target==="video" ? settings.useStoryboardFirstFrame : undefined};
}
export function shotPromptKey(p:Project, shotId:string, target:PromptTarget, assets:Asset[]) {
  return JSON.stringify(shotPromptContext(p,shotId,target,assets));
}
