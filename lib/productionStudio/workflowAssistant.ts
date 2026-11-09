import type {Project,Timeline} from "./model";
import {clipEditTimeline} from "./workflow";
export type WorkflowChange={type:"gain"|"region-gain"|"pan"|"fade"|"trim"|"move"|"duck"|"video-prompt";id:string;value:number;secondary:number;text:string};
export type WorkflowSuggestion={workspace:"Edit"|"Finish";clipId:string;basedOnKey:string;changes:WorkflowChange[]};
export const workflowTimeline=(p:Project,w:"Edit"|"Finish",id:string)=>w==="Edit"?clipEditTimeline(p,id):p.timeline;
export const workflowAssistantKey=(p:Project,w:"Edit"|"Finish",id:string)=>JSON.stringify({timeline:workflowTimeline(p,w,id),prompt:p.clipEdits?.[id]?.videoPrompt});
export function applyWorkflowChanges(t:Timeline,changes:WorkflowChange[]){
  const next=structuredClone(t);
  if(!Array.isArray(changes)||changes.length>30)throw Error("Choose a smaller set of editing changes.");
  for(const c of changes){
    if(!c||!Number.isFinite(c.value)||!Number.isFinite(c.secondary))throw Error("An editing value is invalid.");
    const audio=next.audio.find(a=>a.id===c.id),clip=next.clips.find(a=>a.id===c.id);
    if(c.type==="duck"){next.duckMusic=c.value!==0;continue;}
    if(c.type==="video-prompt")continue;
    if(c.type==="move"){
      const i=next.clips.findIndex(a=>a.id===c.id);if(i<0||!Number.isInteger(c.value)||c.value<0||c.value>=next.clips.length)throw Error("Choose an existing clip position.");
      next.clips.splice(c.value,0,...next.clips.splice(i,1));continue;
    }
    const item=audio||clip;if(!item)throw Error("An editing item changed. Ask the filmmaker again.");
    if(c.type==="region-gain"&&audio){if(!audio.regions?.some(r=>r.id===c.text))throw Error("Choose an existing voice or sound region.");audio.regions=audio.regions.map(r=>r.id===c.text?{...r,gain:c.value}:r);continue;}
    if(c.type==="gain")item.volume=c.value;
    else if(c.type==="pan"&&audio)audio.pan=c.value;
    else if(c.type==="fade"&&audio){audio.fadeIn=c.value;audio.fadeOut=c.secondary;}
    else if(c.type==="trim"){item.in=c.value;item.out=c.secondary;}
    else throw Error("This editing operation is not supported. Use the focused controls.");
  }
  return next;
}
