import {afterEach,beforeEach,expect,it,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";import crypto from "node:crypto";
import {NextRequest} from "next/server";
import {createSession,labRoot,reserveAsset,validateSettings,withLab} from "@/lib/experiments/store";
import {labFinalPrompt} from "@/lib/experiments/creative";
import {GET as preview} from "@/app/api/h3/nsfw/preview/route";
import {GET as poll,POST as build} from "@/app/api/h3/nsfw/prompt/route";
vi.mock("@/lib/experiments/director3060",()=>({director3060Runtime:()=>({}),huihuiDirectorAvailable:()=>true}));
vi.mock("node:child_process",async original=>({...await original<typeof import("node:child_process")>(),spawn:()=>{const e=new EventEmitter();Object.assign(e,{unref:()=>{}});queueMicrotask(()=>e.emit("spawn"));return e;}}));
import {EventEmitter} from "node:events";
const state=vi.hoisted(()=>({actor:"owner-a",job:null as any,ensure:vi.fn(),kick:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>state.actor?{value:state.actor}:undefined})}));
vi.mock("@/lib/auth/jwt",()=>({verifySession:async(value:string)=>({sub:value})}));
vi.mock("@/lib/auth/db",()=>({ensureMigrations:()=>{},db:{prepare:()=>({get:(id:string)=>id?{id}:undefined})}}));
vi.mock("@/lib/auth/admin",()=>({isAdminUserId:(id:string)=>id!=="disabled"}));
vi.mock("@/lib/workers/qwenDurableJobs",()=>({getQwenDurableJob:()=>state.job,ensureQwenDurableJob:(input:any)=>{state.ensure(input);return {id:input.id,status:"queued"};}}));
vi.mock("@/lib/workers/qwenDurableScheduler",()=>({kickQwenDurableScheduler:()=>state.kick()}));
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"h3-ux-unit-"));vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_EXPERIMENTS_ROOT",path.join(root,"lab"));vi.stubEnv("OTG_DATA_DIR",path.join(root,"data"));state.actor="owner-a";state.job=null;state.ensure.mockClear();state.kick.mockClear();});
afterEach(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
function req(route:string,data?:unknown,headers:Record<string,string>={}){return new NextRequest("http://test.local"+route,{method:data===undefined?"GET":"POST",headers:{host:"test.local",...(data===undefined?{}:{Origin:"http://test.local","Content-Type":"application/json"}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});}
function ownPreview(){
 const session=createSession("owner-a","prism-pika"),id=crypto.randomUUID(),asset=reserveAsset("owner-a",session.id,"result.mp4","video/mp4","generated"),dir=path.join(labRoot(),"jobs",id);fs.mkdirSync(dir,{recursive:true});
 const status={id,session:session.id,model:"prism-pika",state:"running",stage:"Sampling",created:Date.now()/1000,heartbeat:Date.now()/1000,previewVersion:1};
 withLab(db=>{db.exec("CREATE TABLE generation_jobs(id TEXT,owner TEXT,session TEXT,model TEXT,asset TEXT,status TEXT,created REAL)");db.prepare("INSERT INTO generation_jobs VALUES(?,?,?,?,?,?,?)").run(id,"owner-a",session.id,"prism-pika",asset.id,JSON.stringify(status),Date.now()/1000);});
 fs.writeFileSync(path.join(dir,"status.json"),JSON.stringify(status));fs.writeFileSync(path.join(dir,"request.json"),"{}");fs.writeFileSync(path.join(dir,"preview.mp4"),"preview-bytes");return {id,dir,session};
}
it("requires approval and owner identity for previews; supports private ranges and rejects paths",async()=>{
 const {id}=ownPreview();state.actor="";expect((await preview(req('/api/h3/nsfw/preview?jobId='+id))).status).toBe(401);state.actor="disabled";expect((await preview(req('/api/h3/nsfw/preview?jobId='+id))).status).toBe(403);state.actor="owner-b";expect((await preview(req('/api/h3/nsfw/preview?jobId='+id))).status).toBe(404);state.actor="owner-a";
 const r=await preview(req('/api/h3/nsfw/preview?jobId='+id,undefined,{Range:"bytes=0-6"}));expect(r.status).toBe(206);expect(await r.text()).toBe("preview");expect(r.headers.get('cache-control')).toBe('private, no-store');expect((await preview(req('/api/h3/nsfw/preview?jobId=../../private'))).status).toBe(400);
});
it("does not follow a preview symlink or leak its target",async()=>{const {id,dir}=ownPreview();fs.unlinkSync(path.join(dir,'preview.mp4'));fs.symlinkSync('/etc/passwd',path.join(dir,'preview.mp4'));const r=await preview(req('/api/h3/nsfw/preview?jobId='+id));expect(r.status).not.toBe(200);expect(await r.text()).not.toMatch(/passwd|root:/);});
it("queues Huihui with locked duration/style and deduplicates retries",async()=>{
 const s=createSession('owner-a','prism-pika');withLab(db=>db.prepare('UPDATE sessions SET settings=? WHERE id=?').run(JSON.stringify({...s.settings,prompt:'A paper boat',seconds:13,stylePresetId:'anime'}),s.id));
 const id=crypto.randomUUID(),r=await build(req('/api/h3/nsfw/prompt',{sessionId:s.id,requestId:id,message:'Keep the exact dialogue'}));expect(r.status).toBe(202);
 const dir=path.join(labRoot(),'jobs',id),request=JSON.parse(fs.readFileSync(path.join(dir,'request.json'),'utf8'));expect(request.model).toBe('h3-nsfw-prompt');expect(request.settings.directorModel).toBe('huihui9b');expect(JSON.parse(request.settings.prompt)).toMatchObject({duration:13,direction:'Keep the exact dialogue'});expect(JSON.parse(request.settings.prompt).lockedStyle).toMatch(/anime/i);expect(state.ensure).not.toHaveBeenCalled();
 expect((await build(req('/api/h3/nsfw/prompt',{sessionId:s.id,requestId:id}))).status).toBe(202);
 state.actor='owner-b';expect((await poll(req('/api/h3/nsfw/prompt?id='+id))).status).toBe(404);
 state.actor='owner-a';fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({prompt:'A paper boat.',reply:'Ready'}));fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({state:'completed',cleanedUp:true}));const result=await(await poll(req('/api/h3/nsfw/prompt?id='+id))).json();expect(result.prompt.indexOf('A paper boat.')).toBeGreaterThan(0);expect(result.prompt).toMatch(/anime/i);
 expect((await build(req('/api/h3/nsfw/prompt',{sessionId:s.id,requestId:id},{Origin:'https://other.invalid'}))).status).toBe(403);
});
it("retains creative options, strips untrusted LoRA fields and prepends styles and appends triggers without changing raw text",()=>{
 const s=createSession('owner-a','prism-pika');const v=validateSettings({...s.settings,prompt:'A boat',stylePresetId:'anime',cameraFeel:'Static composition',loras:[{id:'style-3d',strength:.6,path:'/arbitrary/file'}]});expect(v.loras).toEqual([{id:'style-3d',strength:.6}]);expect(labFinalPrompt(v,['3dsrx'])).toMatch(/anime/i);expect(labFinalPrompt(v,['3dsrx'])).toContain('3dsrx');expect(v.prompt).toBe('A boat');for(const loras of [[{id:'../bad',strength:1}],[{id:'valid',strength:null}]])expect(()=>validateSettings({...s.settings,loras})).toThrow();expect(()=>validateSettings({...s.settings,visualStyle:['Anime']})).toThrow();
});
