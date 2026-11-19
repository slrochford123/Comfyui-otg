import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {labRoot,validId} from "./store";
import {director3060Runtime,validateDirectorPlan,directorMessages} from "./director3060";
import {assertNsfwSession} from "./apiHandlers";
import {requireNsfwAccess} from "./nsfwAccess";
import {labFinalPrompt} from "./creative";
import {buildNsfwClipDirection} from "./nsfwClipDirection";
import type {H3EnhanceLevel} from "@/lib/h3DraftEnhancement";
import {RequestError} from "@/lib/requestError";

function directorPlanText(plan: ReturnType<typeof validateDirectorPlan>) {
 return [plan.title,plan.continuity,...plan.shots.map((shot,index)=>`${index+1}. ${shot.title} · ${shot.seconds}s\n${shot.prompt}\nSound: ${shot.sound}`)].join("\n\n");
}

export function readNsfwDirector(owner:string,id:string){
 validId(id);const dir=path.join(labRoot(),"jobs",id);
 if(!fs.existsSync(path.join(dir,"request.json")))throw new RequestError("Director request not found.",404);
 const request=JSON.parse(fs.readFileSync(path.join(dir,"request.json"),"utf8"));
 if(request.owner!==owner||!["h3-nsfw-prompt","h3-nsfw-director"].includes(request.model))throw new RequestError("Director request not found.",404);
 const status=JSON.parse(fs.readFileSync(path.join(dir,"status.json"),"utf8"));
 if(["queued","running"].includes(status.state)&&Date.now()/1000-(status.heartbeat||status.created)>120){status.state="failed";status.stage="Director worker stopped. Your draft is unchanged; retry when ready.";}
 const result=status.state==="completed"&&status.cleanedUp?JSON.parse(fs.readFileSync(path.join(dir,"result.json"),"utf8")):null;
 const plan=result&&request.model==="h3-nsfw-director"?validateDirectorPlan(result):null;
 const operation = request.promptOperation;
 const kind = request.model === "h3-nsfw-director" ? "plan" : operation?.kind === "enhance" && !operation.legacy ? "enhance" : "prompt";
 const prompt = plan ? directorPlanText(plan) : result && (operation ? result.prompt : labFinalPrompt({...request.creative,prompt:result.prompt}));
 return {id,sessionId:request.sessionId,kind,plan,direction:request.direction||"",parentId:request.parentJob||null,created:status.created,status:status.state==="completed"&&!status.cleanedUp?"running":status.state,prompt:prompt||"",reply:result?.reply||"",error:["failed","canceled","needs_attention"].includes(status.state)?status.stage:null,model:"huihui_ai/qwen3.5-abliterated:9b",...(operation?.kind === "enhance" ? {originalPrompt:operation.scene} : {}),...(operation?.kind === "direct" ? {directedPrompt:true} : {})};
}
export function listNsfwDirectorPlans(owner:string,sessionId:string){
 assertNsfwSession(owner,sessionId);
 const folder=path.join(labRoot(),"director-plans",sessionId);
 if(!fs.existsSync(folder))return {plans:[]};
 const plans=fs.readdirSync(folder).filter(f=>/^[0-9a-f-]{36}\.json$/.test(f)).map(f=>readNsfwDirector(owner,f.slice(0,-5))).filter(p=>p.sessionId===sessionId&&p.kind==="plan").sort((a,b)=>b.created-a.created);
 return {plans};
}
export async function startNsfwDirector(owner:string,data:Record<string,unknown>){
 validId(data.requestId);validId(data.sessionId);const id=data.requestId;
 const access=requireNsfwAccess(owner),session=assertNsfwSession(owner,data.sessionId);
 if(session.archived)throw new RequestError("Open an active session first.",409);
 const message=typeof data.message==="string"?data.message.trim():"";
 if(message.length>4000||(!message&&!session.settings.prompt.trim()))throw new RequestError("Enter your scene or direction (up to 4,000 characters).",400);
 const dir=path.join(labRoot(),"jobs",id);
 if(fs.existsSync(dir))return readNsfwDirector(owner,id);
 // Older clients send literal enhancement commands and omit the action on plans.
 const legacyLevel = /^Enhance the scene at (short|medium|long) strength\. Preserve all dialogue and chosen controls\.$/.exec(message)?.[1] as H3EnhanceLevel | undefined;
 const legacyDirector=data.action===undefined&&Object.prototype.hasOwnProperty.call(data,"message")&&!legacyLevel;
 const planning=data.action==="plan"||legacyDirector;
 if(data.action!==undefined&&!["plan","prompt","direct","enhance"].includes(String(data.action)))throw new RequestError("Invalid Director action.",400);
 const enhancing = !planning && (data.action === "enhance" || Boolean(legacyLevel));
 const level = data.action === "enhance" ? data.level : legacyLevel;
 if(enhancing && level !== "short" && level !== "medium" && level !== "long")throw new RequestError("Choose a prompt enhancement level.",400);
 if(data.revision !== undefined && data.revision !== session.revision)throw new RequestError("The scene changed. Refresh the draft and try again.",409);
 if(enhancing && !session.settings.prompt.trim())throw new RequestError("Enter a scene before enhancing it.",400);
 const direction=message||session.settings.prompt;
 const history=planning?listNsfwDirectorPlans(owner,session.id).plans:[];
 let previous=history.find(p=>p.status==="completed"&&p.plan);
 if(planning&&typeof data.parentId==="string"&&data.parentId){
  previous=history.find(p=>p.id===data.parentId&&p.status==="completed"&&p.plan);
  if(!previous)throw new RequestError("Previous Director plan not found in this session.",404);
 }
 if(planning)directorMessages(direction,previous?.plan||undefined);
 director3060Runtime();
 const instruction=JSON.stringify({direction:message||"Improve this scene prompt.",scene:session.settings.prompt,lockedStyle:labFinalPrompt({...session.settings,prompt:""}),duration:session.settings.seconds,mode:session.settings.mode,orientation:session.settings.orientation,loras:session.settings.loras,references:session.assets.filter(a=>session.settings.selectedSources?.includes(a.id)).map(a=>({name:a.name,kind:a.mime.split('/')[0]}))});
 const clip = !planning && !enhancing ? await buildNsfwClipDirection(owner,session,message,data.action!=="direct") : null;
 const promptOperation = enhancing
   ? {kind:"enhance",scene:session.settings.prompt.trim(),level:level as H3EnhanceLevel,legacy:data.action!=="enhance"} as const
   : clip ? {kind:"direct",direction:clip} as const : undefined;
 fs.mkdirSync(path.dirname(dir),{mode:0o700,recursive:true});
 try { fs.mkdirSync(dir,{mode:0o700,recursive:false}); }
 catch (error) {
   if ((error as NodeJS.ErrnoException).code === "EEXIST") return readNsfwDirector(owner,id);
   throw error;
 }
 const request={id,owner,sessionId:session.id,model:planning?"h3-nsfw-director":"h3-nsfw-prompt",direction,...(!enhancing?{creative:session.settings}:{}),...(promptOperation?{promptOperation}:{}),...(planning&&previous?.plan?{directorContext:previous.plan,parentJob:previous.id}:{}),settings:{directorModel:"huihui9b",mode:"text",prompt:planning?direction:enhancing?session.settings.prompt.trim():instruction,seed:session.settings.seed},sources:[],...(!access.admin?{authorization:{version:access.version}}:{})};
 const status={id,state:"queued",created:Date.now()/1000,stage:"Waiting for Huihui Qwen on RTX 3060",cleanedUp:false};
 fs.writeFileSync(path.join(dir,"request.json"),JSON.stringify(request),{flag:"wx",mode:0o600});
 fs.writeFileSync(path.join(dir,"status.json"),JSON.stringify(status),{flag:"wx",mode:0o600});
 if(planning){const folder=path.join(labRoot(),"director-plans",session.id);fs.mkdirSync(folder,{mode:0o700,recursive:true});fs.writeFileSync(path.join(folder,id+".json"),JSON.stringify({id}),{flag:"wx",mode:0o600});}
 const log=fs.openSync(path.join(dir,"runner.log"),"wx",0o600);
 try{
  const child=spawn(process.execPath,["-r",path.join(process.cwd(),"scripts/register-ts-worker.cjs"),path.join(process.cwd(),"scripts/experiments/director3060-worker.cjs"),dir],{cwd:process.cwd(),detached:true,stdio:["ignore",log,log],env:{...process.env,OTG_DIRECTOR_NSFW:"1"}});
  await new Promise<void>((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});child.unref();
 }catch(error){fs.writeFileSync(path.join(dir,"status.json"),JSON.stringify({...status,state:"failed",cleanedUp:true,stage:"Director could not start. Your draft is unchanged."}));throw error;}
 finally{fs.closeSync(log);}
 return {id,status:"queued"};
}

export type NsfwDirectorResult=ReturnType<typeof readNsfwDirector>;
