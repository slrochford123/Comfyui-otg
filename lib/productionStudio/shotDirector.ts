import {selectedAudioAsset} from "./audioFinishSettings";
import { allShots, DEFAULT_SHOT, type Project, type Asset, type ShotSettings, type Timeline } from "./model";
import { plannedSeconds } from "./shotPolicy";
import {shotPeople,mentionsSubject} from "./shotVisibility";

export function shotContext(p: Project, shotId: string) {
  const shot = allShots(p).find(s=>s.id===shotId);
  const scene = p.plan.acts.flatMap(a=>a.scenes).find(s=>s.shots.some(v=>v.id===shotId));
  if (!shot || !scene) throw new Error("Shot not found.");
  const settings = p.shots[shotId] || DEFAULT_SHOT;
  const peopleRoles=shotPeople(p,shotId);
  const clipRefs=settings.direction?.brief.cameraShots?.flatMap(c=>[...c.referenceNames,...c.onScreen,c.location])||[];
  const action=[settings.direction?.brief.action||shot.description,settings.direction?.brief.action||shot.characterActions].join(" ").toLowerCase();
  const mentions=(text:string,name:string)=>!!name.trim()&&new RegExp(`(^|[^\\p{L}\\p{N}])${name.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}($|[^\\p{L}\\p{N}])`,"iu").test(text);
  const scope=[...p.creation?.items || [], ...p.creation?.retiredItems || []].filter(i=>!i.removedAt && (clipRefs.some(r=>mentions(r,i.name)) || mentions(action,i.name) || i.sourceSegmentIds.includes(shot.storySegmentId || "") || scene.characters.some(c=>c.toLowerCase()===i.name.toLowerCase()) || i.kind==="environment" && mentions(scene.location,i.name)));
  const named=scope.filter(i=>i.kind==="character"?peopleRoles.onScreen.includes(i.name):mentions(action,i.name)||mentionsSubject(action,i.name.replace(/^.*['’]s\s+/i,"")));
  const people=scope.filter(i=>i.kind==="character");
  const requirements=scope.filter(i=>i.kind==="environment" || named.includes(i) || i.kind==="character"&&people.length===1&&!peopleRoles.offScreen.includes(i.name)&&!named.some(v=>v.kind==="character")&& !/\b(empty|unoccupied|no people|landscape|object insert)\b/i.test(action));
  const items = requirements.filter(i=>i.status==="ready" && i.assetId && p.bindings.some(b=>b.assetId===i.assetId&&b.approved));
  const referenceIds = settings.referenceSelectionExplicit || settings.referenceIds.length ? settings.referenceIds : [...new Set(items.filter(i=>["character","environment","prop","wardrobe","background"].includes(i.kind)).map(i=>i.assetId!))];
  return {shot,scene,items,requirements,ambiguousCharacters:people.length>1&&!named.some(i=>i.kind==="character")&&!/\b(empty|unoccupied|no people|landscape|object insert)\b/i.test(action),settings:{...settings,referenceIds} as ShotSettings};
}
export function continuitySource(p: Project, shotId: string) {
  const {settings} = shotContext(p,shotId), shots=allShots(p), index=shots.findIndex(s=>s.id===shotId);
  const id=settings.continuitySourceShotId || (settings.continuity==="previous-frame"?shots[index-1]?.id:undefined);
  if (!id) return undefined;
  const sourceIndex=shots.findIndex(s=>s.id===id), source=shots[sourceIndex];
  if (!source || sourceIndex>=index) throw new Error("Choose an earlier shot, not the current or a future shot.");
  const take=source.takes.find(t=>t.id===(p.shots[id]?.approvedTakeId || source.acceptedTakeId));
  return {shot:source,take,settings:p.shots[id]||DEFAULT_SHOT};
}
export function storyboardPrompt(p: Project, shotId: string) {
  const {shot,scene,items,settings}=shotContext(p,shotId), source=continuitySource(p,shotId);
  const beat=p.plan.storyPreview?.segments.find(b=>b.id===shot.storySegmentId);
  const first=settings.direction?.brief.cameraShots?.[0];
  if(first)return [
    `Starting-image concept for video clip ${shot.shotNumber}, camera view 1 only. Do not combine its later camera cuts into this image.`,
    `Opening state: ${settings.direction!.brief.startingState}. Opening composition: ${first.framing}. Location: ${first.location}. Lighting: ${first.lighting}.`,
    `Visible people: ${first.onScreen.join(", ")||"none"}. First-view action: ${first.action}.`,
    ...items.filter(i=>i.kind==="character"?first.onScreen.includes(i.name):first.referenceNames.includes(i.name)||mentionsSubject(first.location,i.name)||mentionsSubject(first.action,i.name)).map(i=>`Use the pinned ${i.kind} ${i.name} for identity and design.`),
    `Visual style: ${p.brief.style}. Atmosphere: ${p.brief.atmosphere}.`,
    first.continuity.join(" "),settings.continuityNotes||"",
    "One reference composition, not a montage, contact sheet, collage or entire scene. Other camera views will be described in the video prompt.",
  ].filter(Boolean).join("\n");
  return [
    `Storyboard for ONE camera shot (${shot.shotNumber}), not a generic scene poster.`,
    `Shot action: ${shot.description}. Framing: ${shot.cameraFraming}. Camera movement: ${shot.cameraMovement}.`,
    `Scene: ${scene.title}. Location: ${beat?.location||scene.location.split(/\n\s*\n/)[0]}. Time: ${beat?.timeOfDay||scene.timeOfDay}. Lighting: ${beat?.lighting || "as established in the approved location image"}.`,
    `Visual style: ${p.brief.style}. Atmosphere: ${p.brief.atmosphere}.`,
    ...items.map(i=>`Approved ${i.kind} ${i.name}: use the supplied pinned image for visual identity, wardrobe and design, composed for this camera shot rather than its original reference pose.`),
    settings.cameraSetup ? `Camera setup: ${settings.cameraSetup}.` : "",
    settings.continuityNotes ? `Approved physical state: ${settings.continuityNotes}.` : "",
    source ? `Return/reference shot ${source.shot.shotNumber}: ${source.shot.description}. Framing: ${source.shot.cameraFraming}. Established state: ${source.settings.continuityNotes || "review source image"}. ${settings.continuity==="new-angle"?"Use a new angle, not the identical source composition.":"Match the selected camera setup and preserve spatial layout."}` : "",
    "Depict only the current shot action. Context and continuity are reference information, not instructions to illustrate the whole story or events in other shots. Use supplied pinned references for identity, wardrobe, set layout and props. Only show characters required by this shot. Do not introduce unrelated people. Reference consistency is a goal requiring human review, not a guarantee.",
  ].filter(Boolean).join("\n");
}
/** Source-relative edits are preserved; no render or flattened media is created here. */
export function approvedSequence(p: Project, assets: Asset[], ids: string[], maxSeconds?: number): Timeline {
  const selected=new Set(ids), ordered=allShots(p).filter(s=>selected.has(s.id));
  if (!ordered.length || ordered.length!==selected.size) throw new Error("Select existing shots for this assembly.");
  if (maxSeconds!==undefined && (!Number.isFinite(maxSeconds)||maxSeconds<=0)) throw new Error("Choose a positive review duration.");
  const clips: Timeline["clips"]=[];
  let elapsed=0;
  for (const shot of ordered) {
    const settings=p.shots[shot.id]||DEFAULT_SHOT, take=shot.takes.find(t=>t.id===(settings.approvedTakeId||shot.acceptedTakeId));
    if(!take?.assetId) throw new Error(`Approve a take for shot ${shot.shotNumber} before assembling it.`);
    const assetId=selectedAudioAsset(settings,settings.finalAssetId||take.assetId), asset=assets.find(a=>a.id===assetId);
    if(!asset || asset.kind!=="video") throw new Error("Approved source video is unavailable.");
    const prior=p.timeline.clips.find(c=>c.shotId===shot.id && c.assetId===assetId);
    const start=prior?.in ?? Number(asset.metadata.trimIn || 0), end=prior?.out ?? Math.min(Number(asset.metadata.duration)||plannedSeconds(shot), Number(asset.metadata.trimOut)||plannedSeconds(shot));
    const transition=clips.length?prior?.transition||"cut":"cut", overlap=transition==="cut"?0:prior?.transitionSeconds||0;
    const available=maxSeconds===undefined?end-start:Math.min(end-start,maxSeconds-elapsed+overlap);
    if(available<=overlap)break;
    clips.push({id:`sequence-${shot.id}`,assetId,shotId:shot.id,in:start,out:start+available,transition,transitionSeconds:overlap,volume:prior?.volume??1});
    elapsed+=available-overlap;
    if(maxSeconds!==undefined&&elapsed>=maxSeconds-.001)break;
  }
  // Keep audio/captions only when the selection is a contiguous existing timeline range.
  const first=p.timeline.clips.findIndex(c=>c.shotId===clips[0]?.shotId), matching=first>=0&&clips.every((c,i)=>p.timeline.clips[first+i]?.shotId===c.shotId);
  let origin=0;
  if(matching)for(let i=0;i<first;i++){const c=p.timeline.clips[i];origin+=c.out-c.in-(i&&c.transition!=="cut"?c.transitionSeconds:0);}
  if(matching&&first>0&&p.timeline.clips[first].transition!=="cut")origin-=p.timeline.clips[first].transitionSeconds;
  const audio=matching?p.timeline.audio.flatMap(a=>{const start=Math.max(origin,a.start),end=Math.min(origin+elapsed,a.start+a.out-a.in);return end>start?[{...a,start:start-origin,in:a.in+start-a.start,out:a.in+end-a.start,fadeIn:Math.min(a.fadeIn,end-start),fadeOut:Math.min(a.fadeOut,end-start)}]:[];}):[];
  const titles=matching?p.timeline.titles.filter(t=>t.end>origin&&t.start<origin+elapsed).map(t=>({...t,start:Math.max(0,t.start-origin),end:Math.min(elapsed,t.end-origin)})):[];
  return {clips,audio,titles,duckMusic:p.timeline.duckMusic};
}
