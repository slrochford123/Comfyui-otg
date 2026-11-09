import type {DirectionBrief} from "./shotDirection";
import {cameraShots} from "./clipPlan";

export const ROOM_PROFILES=["small-room","hallway","bathroom","large-room","exterior","dry"] as const;
export type RoomProfile=typeof ROOM_PROFILES[number];
export type AcousticSource={identity:string;onScreen:boolean;location:string;environment:RoomProfile;distanceMeters:number;device:"none"|"speakerphone"|"earpiece";moves:boolean;characteristics:string;keyframes:{seconds:number;environment:RoomProfile;distanceMeters:number;pan:number;cameraShotId:string}[]};
export type AcousticDirection={version:1;sources:AcousticSource[];ambience:string;music:string;perspective:string;provenance:"director"|"direction-derived"};
const str={type:"string"},num={type:"number"},profile={type:"string",enum:[...ROOM_PROFILES]};
export const acousticSchema={type:"object",additionalProperties:false,required:["version","sources","ambience","music","perspective","provenance"],properties:{version:{type:"number",enum:[1]},ambience:str,music:str,perspective:str,provenance:{type:"string",enum:["director"]},sources:{type:"array",items:{type:"object",additionalProperties:false,required:["identity","onScreen","location","environment","distanceMeters","device","moves","characteristics","keyframes"],properties:{identity:str,onScreen:{type:"boolean"},location:str,environment:profile,distanceMeters:num,device:{type:"string",enum:["none","speakerphone","earpiece"]},moves:{type:"boolean"},characteristics:str,keyframes:{type:"array",items:{type:"object",additionalProperties:false,required:["seconds","environment","distanceMeters","pan","cameraShotId"],properties:{seconds:num,environment:profile,distanceMeters:num,pan:num,cameraShotId:str}}}}}}}};
const room=(text:string):RoomProfile=>{
 const hall=/hall|corridor/i.exec(text),bath=/bath|tile|washroom/i.exec(text);
 if(hall&&(!bath||hall.index<bath.index))return "hallway";
 if(bath)return "bathroom";
 return /outside|exterior|street|forest|beach/i.test(text)?"exterior":/large|cathedral|auditorium/i.test(text)?"large-room":"small-room";
};
export function deriveAcoustics(b:DirectionBrief):AcousticDirection{
 const shots=cameraShots(b),text=[b.startingState,b.action,...b.continuity].join(" ");
 const frames:AcousticSource["keyframes"]=[];
 for(const [i,c]of shots.entries()){
  const environment=room(c.location),distanceMeters=/close/i.test(c.framing)?1:/wide/i.test(c.framing)?2.5:1.5,base={seconds:c.startSeconds,environment,distanceMeters,pan:0,cameraShotId:c.id};
  const previous=frames.at(-1),arrival=/(?:around|by|at)\s+(\d+(?:\.\d+)?)\s*seconds/i.exec(c.action),end=Number(arrival?.[1]);
  const entry=b.dialogue.find(d=>c.onScreen.includes(d.speaker)&&d.startSeconds>=c.startSeconds&&d.startSeconds<c.endSeconds)?.startSeconds;
  if(i&&previous&&previous.environment!==environment&&/enter|cross/i.test(c.action)&&/as.*(?:repl|speak|talk)/i.test(c.action)&&entry!==undefined&&end>entry&&end<=c.endSeconds){
   frames.push({...base,environment:previous.environment});
   if(entry>c.startSeconds)frames.push({...base,seconds:entry,environment:previous.environment});
   frames.push({...base,seconds:end});
  }else frames.push(base);
 }
 return {version:1,provenance:"direction-derived",ambience:b.soundscape,music:b.music,perspective:"Follow the camera/listener perspective at each cut; retain continuous source identity and timing.",sources:[...new Set(b.dialogue.map(d=>d.speaker))].map(identity=>{
  const phone=b.dialogue.some(d=>d.speaker===identity&&d.channel==="phone")||b.offScreen.some(d=>d.name===identity&&d.channel==="phone");
  return {identity,onScreen:shots.some(s=>s.onScreen.includes(identity)),location:phone?"Handset held by the on-screen character":b.location,environment:room(shots[0].location),distanceMeters:/close/i.test(shots[0].framing)?1:2,device:phone?(/against.{0,15}ear|held.{0,10}ear|earpiece/i.test(text)?"earpiece":"speakerphone"):"none",moves:/walk|move|enter|cross|track/i.test(text),characteristics:phone?"Intelligible compact handset speaker, restrained compression and coloration; follows the handset's physical position.":"Recognizable natural voice, subtle early reflections, room depth and framing-dependent perspective.",keyframes:frames.map(k=>({...k}))};
 })};
}
export function readAcoustics(value:unknown,b:DirectionBrief):AcousticDirection{
 if(value===undefined)return deriveAcoustics(b);
 const a=value as AcousticDirection;
 if(!a||a.version!==1||!Array.isArray(a.sources)||a.sources.length>30||![a.ambience,a.music,a.perspective].every(s=>typeof s==="string"&&s.length<=3000))throw Error("Invalid acoustic direction.");
 const speakers=new Set(b.dialogue.map(d=>d.speaker));
 if(a.sources.length!==speakers.size||new Set(a.sources.map(s=>s.identity)).size!==speakers.size)throw Error("Acoustic sources must match the clip's speakers.");
 for(const s of a.sources){
  if(!speakers.has(s.identity)||typeof s.onScreen!=="boolean"||typeof s.moves!=="boolean"||![s.location,s.characteristics].every(v=>typeof v==="string"&&v.length<=3000)||!ROOM_PROFILES.includes(s.environment)||!["none","speakerphone","earpiece"].includes(s.device)||!Number.isFinite(s.distanceMeters)||s.distanceMeters<.2||s.distanceMeters>50||!Array.isArray(s.keyframes)||!s.keyframes.length||s.keyframes.length>60)throw Error("Invalid sound source.");
  if(s.keyframes[0].seconds!==0)throw Error("Acoustic perspective must start at zero.");
  const phone=b.dialogue.some(d=>d.speaker===s.identity&&d.channel==="phone");if(phone&&s.device==="none")throw Error("A phone voice must retain its device source.");
  let last=-1;for(const k of s.keyframes){if(!Number.isFinite(k.seconds)||k.seconds<0||k.seconds>b.duration||k.seconds<=last||!ROOM_PROFILES.includes(k.environment)||!Number.isFinite(k.distanceMeters)||k.distanceMeters<.2||k.distanceMeters>50||!Number.isFinite(k.pan)||Math.abs(k.pan)>.35||typeof k.cameraShotId!=="string")throw Error("Invalid acoustic perspective change.");last=k.seconds;}
 }
 return {...a,provenance:a.provenance==="director"?"director":"direction-derived"};
}
export function acousticPrompt(b:DirectionBrief,identity:string,shotId:string){
 const a=b.acoustics||deriveAcoustics(b),s=a.sources.find(s=>s.identity===identity);if(!s)return "";
 const k=s.keyframes.find(k=>k.cameraShotId===shotId)||s.keyframes[0];
 const changes=s.keyframes.filter(k=>k.cameraShotId===shotId).map(k=>`${k.seconds.toFixed(2)}s: ${k.environment}, approximately ${k.distanceMeters} metres`).join("; ");
 return s.device!=="none"?`The voice is emitted by the physical cellphone ${s.device==="earpiece"?"held against the ear, softly audible and occluded":"held in the scene on speakerphone"}, with compact speaker coloration, limited telephone bandwidth and restrained compression. Its level, stereo position and subtle ${k.environment} reflections follow the handset at approximately ${k.distanceMeters} metres from the listener. ${s.characteristics} Acoustic perspective: ${changes}.`:`The natural voice is physically produced in ${s.location}, with subtle ${k.environment} early reflections and perspective at approximately ${k.distanceMeters} metres from the listener. Acoustics follow movement between rooms and camera cuts naturally. ${s.characteristics} Acoustic perspective: ${changes}.`;
}
