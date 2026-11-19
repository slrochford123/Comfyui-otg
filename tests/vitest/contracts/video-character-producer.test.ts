import {afterEach, beforeEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {videoCharacterProducerState} from "@/lib/workers/videoCharacterProducer";
import type {ComfyMediaPayload, MediaQueueJob} from "@/lib/workers/mediaGpuQueue";

let root: string, directory: string, job: MediaQueueJob, workspace: any;
const graph = {"1": {class_type: "LoadImage", inputs: {image: "approved.png"}}, "9": {class_type: "SaveImage", inputs: {filename_prefix: "approved"}}};
function save() {fs.writeFileSync(path.join(directory, "workspace.json"), JSON.stringify(workspace));}
function state(environment = "test") {return videoCharacterProducerState(job, root, environment);}
function payload() {return job.payload as ComfyMediaPayload;}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "video-character-producer-"));
  const owner = "fixture-owner", id = randomUUID(), jid = randomUUID();
  directory = path.join(root, "video-characters", createHash("sha256").update(owner).digest("hex").slice(0,24), id);
  fs.mkdirSync(directory,{recursive:true});
  workspace = {id, owner, candidates: [{views: [{job: jid, gpu: "rtx5060ti", baseUrl: "http://100.98.212.116:8188", state: "queued", master: true}]}]};save();
  fs.writeFileSync(path.join(directory,jid+".workflow.json"),JSON.stringify(graph));
  job = {id:jid, gpu:"rtx5060ti", kind:"comfy", payload:{workerId:"video-character-master",baseUrl:"http://100.98.212.116:8188",producer:{kind:"video-character",ownerKey:owner,id},body:{prompt:structuredClone(graph),prompt_id:jid,client_id:jid}}} as MediaQueueJob;
});
afterEach(() => fs.rmSync(root,{recursive:true,force:true}));
describe("durable character portrait producer verification", () => {
  it("accepts the exact saved master before admission and submission", () => {expect(state()).toBe("active");workspace.candidates[0].views[0].state="running";save();expect(state()).toBe("active");});
  it.each(["prod", "", "development"])("rejects non-TEST environment %s", environment => expect(state(environment)).toBe("unavailable"));
  it.each(["rtx3090","rtx3060"])("rejects master on the wrong GPU %s", gpu => {job.gpu=gpu as MediaQueueJob["gpu"];workspace.candidates[0].views[0].gpu=gpu;save();expect(state()).toBe("unavailable");});
  it("rejects unknown worker labels", () => {payload().workerId="untrusted";expect(state()).toBe("unavailable");});
  it("rejects a master disguised as a Qwen view", () => {payload().workerId="video-character-qwen21";expect(state()).toBe("unavailable");});
  it("rejects a regular view disguised as a master", () => {delete workspace.candidates[0].views[0].master;save();expect(state()).toBe("unavailable");});
  it("rejects changed graph or image", () => {const prompt=payload().body.prompt as typeof graph;prompt["1"].inputs.image="wrong.png";expect(state()).toBe("unavailable");});
  it("rejects missing saved graph", () => {fs.unlinkSync(path.join(directory,job.id+".workflow.json"));expect(state()).toBe("unavailable");});
  it("rejects changed owner", () => {workspace.owner="someone-else";save();expect(state()).toBe("unavailable");});
  it("rejects a missing parent", () => {workspace.candidates=[];save();expect(state()).toBe("unavailable");});
  it("rejects changed worker URL even when parent matches", () => {payload().baseUrl="http://other:8188";workspace.candidates[0].views[0].baseUrl=payload().baseUrl;save();expect(state()).toBe("unavailable");});
  it.each(["client_id","prompt_id"])("rejects changed %s", field => {payload().body[field]=randomUUID();expect(state()).toBe("unavailable");});
  it.each(["ready","failed","canceled"])("does not authorize a terminal parent %s", status => {workspace.candidates[0].views[0].state=status;save();expect(state()).toBe("terminal");});
  it.each(["video-character-qwen21","video-character-refmod"])("preserves existing %s producers", workerId => {payload().workerId=workerId;delete workspace.candidates[0].views[0].master;save();expect(state()).toBe("active");});
});

describe("exact RTX 3090 Qwen image admission",()=>{
 function qwen(){job.gpu='rtx3090';payload().workerId='video-character-qwen21';payload().baseUrl='http://100.75.162.64:8188';const view=workspace.candidates[0].views[0];delete view.master;view.gpu='rtx3090';view.baseUrl=payload().baseUrl;const prompt={...structuredClone(graph),"474":{class_type:'TextEncodeQwenImage21',inputs:{prompt:'Preserve identity'}}};payload().body.prompt=prompt;fs.writeFileSync(path.join(directory,job.id+'.workflow.json'),JSON.stringify(prompt));save();}
 it('accepts the exact qualified graph and recorded 3090 parent',()=>{qwen();expect(state()).toBe('active');});
 it('rejects a changed image or graph before admission',()=>{qwen();(payload().body.prompt as any)['1'].inputs.image='changed.png';expect(state()).toBe('unavailable');});
 it('rejects another endpoint even when the parent is changed to match',()=>{qwen();payload().baseUrl='http://100.75.162.64:8189';workspace.candidates[0].views[0].baseUrl=payload().baseUrl;save();expect(state()).toBe('unavailable');});
 it('rejects a missing saved graph',()=>{qwen();fs.unlinkSync(path.join(directory,job.id+'.workflow.json'));expect(state()).toBe('unavailable');});
 it('rejects incorrect prompt identity',()=>{qwen();payload().body.prompt_id=randomUUID();expect(state()).toBe('unavailable');});
 it('does not admit RefMod or master jobs on the new image lane',()=>{qwen();payload().workerId='video-character-refmod';expect(state()).toBe('unavailable');payload().workerId='video-character-master';expect(state()).toBe('unavailable');});
 it('rejects foreign ownership and non-TEST execution',()=>{qwen();expect(state('prod')).toBe('unavailable');workspace.owner='foreign';save();expect(state()).toBe('unavailable');});
});
