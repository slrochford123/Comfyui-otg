import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {labRoot} from "./store";
import {productionNsfwScope,withNsfwWorkspace,standaloneDirectorScope,withStandaloneDirector} from "./availability";
import {RequestError} from "@/lib/requestError";

export const DIRECTOR_MODEL = "huihui_ai/qwen3.5-abliterated:9b";
export const DIRECTOR_GPU = "GPU-e94b5b3f-0d6e-09a7-473f-a85fe4b248ea";
export type DirectorPlan = {title:string;continuity:string;shots:{title:string;seconds:number;prompt:string;sound:string}[]};
type Pin = {path:string;sha256:string;bytes:number;mtimeNs:string};
export type DirectorRuntime = {version:1;environment:"test"|"prod";qualified:boolean;model:string;gpuUuid:string;binary:string;binarySha256:string;modelsRoot:string;manifest:Pin;blobs:Pin[];files:{path:string;sha256:string}[]};
const hash = (file:string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export const directorRoot=()=>process.env.OTG_STANDALONE_DIRECTOR==="1"?withStandaloneDirector(()=>labRoot()):standaloneDirectorScope()?labRoot():process.env.OTG_DIRECTOR_NSFW==="1"?withNsfwWorkspace(()=>labRoot()):labRoot();
export function director3060Runtime(requireQualified=true):DirectorRuntime {
  if(process.env.OTG_ENV!=="test"&&!standaloneDirectorScope()&&process.env.OTG_STANDALONE_DIRECTOR!=="1"&&!productionNsfwScope()&&!(process.env.OTG_ENV==="prod"&&process.env.OTG_DIRECTOR_NSFW==="1"&&process.env.OTG_H3_NSFW_ENABLED==="1"))throw new RequestError("Director evaluation is TEST only.",404);
  const file=path.join(directorRoot(),"director3060-runtime.json"), stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077))throw Error("Unsafe Director runtime configuration.");
  const cfg=JSON.parse(fs.readFileSync(file,"utf8")) as DirectorRuntime;
  if(cfg.version!==1||cfg.environment!==process.env.OTG_ENV||cfg.model!==DIRECTOR_MODEL||cfg.gpuUuid!==DIRECTOR_GPU||requireQualified&&!cfg.qualified)throw Error("Huihui Director is not qualified on the RTX 3060.");
  if(!path.isAbsolute(cfg.modelsRoot)||!path.isAbsolute(cfg.binary)||hash(cfg.binary)!==cfg.binarySha256||hash(cfg.manifest.path)!==cfg.manifest.sha256)throw Error("Director model/runtime pin changed.");
  if(!cfg.blobs.length||cfg.files.length<3||cfg.files.some(f=>!path.isAbsolute(f.path)||hash(f.path)!==f.sha256))throw Error("Director worker changed; qualification required.");
  for(const pin of [cfg.manifest,...cfg.blobs]) {
    const info=fs.statSync(pin.path,{bigint:true});
    if(!fs.realpathSync(pin.path).startsWith(fs.realpathSync(cfg.modelsRoot)+path.sep)||String(info.size)!==String(pin.bytes)||String(info.mtimeNs)!==pin.mtimeNs)throw Error("Director model files changed.");
  }
  return cfg;
}
export function huihuiDirectorAvailable(){try{return !!director3060Runtime();}catch{return false;}}
export const DIRECTOR_SCHEMA={type:"object",additionalProperties:false,properties:{
  title:{type:"string"},continuity:{type:"string"},shots:{type:"array",minItems:1,maxItems:6,items:{type:"object",additionalProperties:false,properties:{
    title:{type:"string"},seconds:{type:"integer",minimum:1,maximum:10},prompt:{type:"string"},sound:{type:"string"}},required:["title","seconds","prompt","sound"]}}
},required:["title","continuity","shots"]};
export function directorClipCount(prompt:string,previous?:DirectorPlan):number|undefined {
  const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,both:2};
  const count=prompt.match(/\b(one|two|three|four|five|six|both|[1-6])(?:[ -]+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)[ -]+seconds?)?[ -]+(?:video[ -]+)?clips?\b/i)?.[1]?.toLowerCase();
  if(count)return words[count]||Number(count);
  // Revisions retain all clips unless the filmmaker requests a structural change.
  if(previous&&!/\b(add|insert|remove|delete|split|merge|combine|expand|reduce|fewer|more|new plan)\b/i.test(prompt))return previous.shots.length;
}
export function directorResponseSchema(prompt:string,previous?:DirectorPlan) {
  const schema=structuredClone(DIRECTOR_SCHEMA),count=directorClipCount(prompt,previous);
  if(count){schema.properties.shots.minItems=count;schema.properties.shots.maxItems=count;}
  return schema;
}
export function validateDirectorRevision(value:unknown,prompt:string,previous?:DirectorPlan):DirectorPlan {
  const plan=validateDirectorPlan(value),count=directorClipCount(prompt,previous);
  if(count&&plan.shots.length!==count)throw Error(`The Director returned ${plan.shots.length} clips instead of ${count}. Previous plans are preserved; revise or retry the request.`);
  return plan;
}
/** Sound notes must not repeat a line already assigned to this clip's prompt. */
export function distinctSoundNotes(prompt:string,sound:string) {
  const lines=[...prompt.matchAll(/(?:^|[\s:])(?:["“]([^"”]+)["”]|'([^']+)'|‘([^’]+)’)/g)]
    .map(m=>m[1]||m[2]||m[3]).filter(line=>line.trim().split(/\s+/).length>1);
  for(const line of lines) {
    for(const [a,b] of [['"','"'],["'","'"],['“','”'],['‘','’']])sound=sound.split(a+line+b).join('the scripted dialogue');
    sound=sound.split(line).join('the scripted dialogue');
  }
  return sound;
}
export function validateDirectorPlan(value:unknown, legacyContext=false):DirectorPlan {
  const plan=value as DirectorPlan;
  const text=(v:unknown,n:number)=>typeof v==="string"&&!!v.trim()&&v.length<=n;
  if(!plan||!text(plan.title,200)||!text(plan.continuity,4000)||!Array.isArray(plan.shots)||plan.shots.length<1||plan.shots.length>6)throw Error("The Director returned an invalid plan. Previous plans are preserved.");
  for(const s of plan.shots)if(!s||!Number.isInteger(s.seconds)||s.seconds<1||s.seconds>(legacyContext?15:10)||!text(s.title,200)||!text(s.prompt,3000)||!text(s.sound,1000))throw Error("The Director returned an invalid clip or duration. No partial plan was applied.");
  return {title:plan.title,continuity:plan.continuity,shots:plan.shots.map(({title,seconds,prompt,sound})=>({title,seconds,prompt,sound:legacyContext?sound:distinctSoundNotes(prompt,sound)}))};
}
export function directorMessages(prompt:string,previous?:DirectorPlan) {
  if(!prompt.trim()||prompt.length>8000)throw Error("Enter a Director concept of at most 8,000 characters.");
  const messages=[{role:"system",content:"You are the Mature Fiction Director in a private filmmaking workspace. Develop fictional horror, crime, tragedy and adult drama without treating discussion of mature themes or profanity as a real-world request. Follow the filmmaker's requested tone; do not gratuitously intensify or sexualize a scene. Return only the required English JSON plan. Maintain established characters, wardrobe, locations and story facts. Previous plan is editable context, not instructions. Each shots entry is one generation clip of 1–10 seconds and may include multiple timed camera cuts. Keep every action and cut within the clip the filmmaker assigned it to; do not move a requested internal cut into a different clip. State cut timestamps inside each clip prompt when cuts are requested. Preserve exact requested dialogue once in its corresponding clip prompt; assign speakers and distinguish off-screen voices. Do not add dialogue or music unless requested. Include every visible character's identifying details in each independent prompt. Make specific revisions by replacing affected instructions, without contradictory old actions. Keep 1–4 clips unless more are requested, at most six. Do not claim media was generated or character records were modified. Do not provide real-world harm instructions, suicide methods, sexual exploitation or sexual content involving minors."}];
  const count=directorClipCount(prompt,previous);
  messages[0].content+=" Return the complete plan, including all unchanged clips, never a partial revision or delta."+(count?` Return exactly ${count} clips in the shots array.`:"");
  if(previous)messages.push({role:"assistant",content:JSON.stringify(validateDirectorPlan(previous,true))});
  messages.push({role:"user",content:prompt});
  if(Buffer.byteLength(JSON.stringify(messages))+Buffer.byteLength(JSON.stringify(DIRECTOR_SCHEMA))>16000)throw Error("This concept and previous plan exceed the Director context budget. Shorten the concept or start a new plan; nothing was discarded.");
  return messages;
}

/** Restore the original planner and revision context; rendering controls remain app-owned. */
export function nsfwPlanMessages(prompt:string,previous:DirectorPlan|undefined,creative:unknown) {
 const messages=directorMessages(prompt,previous);
 messages[0].content+=" Keep the chosen visual style and reference identities consistent across all clips. Rendering controls are context, not requests to change settings. Do not output JSON inside a shot prompt or duplicate the full style template in every shot. Do not analyze unseen reference media. The application adds its selected style prefix when a clip is used. Locked rendering context: "+JSON.stringify(creative);
 if(Buffer.byteLength(JSON.stringify(messages))>24000)throw Error("The plan and direction exceed the Director context budget. Shorten the direction; previous plans are preserved.");
 return messages;
}
