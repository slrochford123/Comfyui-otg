import type {Project} from "./model";
export const mentionsSubject=(text:string,name:string)=>!!name.trim()&&new RegExp(`(^|[^\\p{L}\\p{N}])${name.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}($|[^\\p{L}\\p{N}])`,"iu").test(text);
export function shotPeople(p:Project,id:string){
 const scene=p.plan.acts.flatMap(a=>a.scenes).find(s=>s.shots.some(sh=>sh.id===id)),shot=scene?.shots.find(s=>s.id===id);
 if(!scene||!shot)throw Error("Shot not found.");
 const direction=p.shots[id]?.direction?.brief;
 if(direction)return {onScreen:direction.onScreen,offScreen:direction.offScreen.map(s=>s.name)};
 const beat=p.plan.storyPreview?.segments.find(b=>b.id===shot.storySegmentId);
 const action=[shot.description,shot.characterActions].join(" ");
 const characters=(p.creation?.items||[]).filter(i=>i.kind==="character"&&!i.removedAt);
 const offScreen=characters.filter(i=>{
  // A character label belongs to its leading name, not every person mentioned
  // in its biography (e.g. "Mia — Ava's friend, heard only through the phone").
  const ownsLabel=new RegExp(`^\\s*${i.name.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}($|[^\\p{L}\\p{N}])`,"iu");
  const labels=[...(beat?.characters||scene.characters),...shot.dialogue.filter(d=>mentionsSubject(d.speaker,i.name)).map(d=>`${i.name}: ${d.delivery}`)].filter(t=>ownsLabel.test(t));
  return labels.some(t=>/off[- ]screen|phone (voice|speaker)|through (the )?phone|heard only|voice only|voiceover/i.test(t))&&!new RegExp(`${i.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}[^.!?]{0,30}(enters|walks|stands|sits|appears on.screen)`,'i').test(action);
 }).map(i=>i.name);
 return {onScreen:characters.filter(i=>mentionsSubject(action,i.name)&&!offScreen.includes(i.name)).map(i=>i.name),offScreen:offScreen.filter(n=>shot.dialogue.some(d=>mentionsSubject(d.speaker,n))||mentionsSubject(action,n))};
}
