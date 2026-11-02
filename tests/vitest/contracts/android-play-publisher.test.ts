import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {createRequire} from "node:module";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
const require=createRequire(import.meta.url);
const c=require("../../../scripts/android/play-core.cjs");
const {args}=require("../../../scripts/android/play-publisher.cjs");
let root:string;
const key=crypto.generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"}).toString();
const credential=()=>({type:"service_account",project_id:"slr-play-test",client_email:"uploader@slr-play-test.iam.gserviceaccount.com",private_key:key,token_uri:"https://oauth2.googleapis.com/token"});
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"slr-play-offline-"));});
afterEach(()=>{fs.rmSync(root,{recursive:true,force:true});});
function candidate(){
 const bytes=Buffer.from("PK synthetic offline bundle fixture, not an Android build"),file=path.join(root,"candidate.aab"),manifest=path.join(root,"manifest.json");fs.writeFileSync(file,bytes,{mode:0o600});
 const value={schemaVersion:1,packageName:c.PACKAGE,track:"internal",releaseStatus:"draft",aab:file,versionCode:37,versionName:"2.0.3",sha256:crypto.createHash("sha256").update(bytes).digest("hex"),releaseNotes:"Native file picker and Android compatibility update."};
 fs.writeFileSync(manifest,JSON.stringify(value),{mode:0o600});return {manifestFile:manifest,value,...c.inspectCandidate(manifest)};
}
class FakeApi {
 calls:any[]=[];tracks:any[]=[{track:"production",releases:[{status:"completed",versionCodes:["31"]}]},{track:"internal",releases:[{status:"completed",versionCodes:["32"]}]}];bundles:any[]=[{versionCode:32,sha256:"previous"}];failUpload=false;badHash=false;review=false;mutateProduction=false;failCleanup=false;
 async call(method:string,suffix:string,body?:any,options:any={}){
  c.requestSpec(method,suffix,options);this.calls.push({method,suffix,body,options});
  if(method==="POST"&&suffix==="")return {id:"owned-edit",expiryTimeSeconds:String(Math.floor(Date.now()/1000)+3600)};
  if(method==="DELETE"){if(this.failCleanup)throw Error("cleanup timeout");return {};}
  if(method==="GET"&&suffix.endsWith("/tracks"))return {tracks:structuredClone(this.tracks)};
  if(method==="GET"&&suffix.endsWith("/bundles"))return {bundles:structuredClone(this.bundles)};
  if(method==="GET"&&suffix.endsWith("/apks"))return {apks:[]};
  if(options.upload){if(this.failUpload)throw Error("uncertain upload");const r={versionCode:37,sha256:this.badHash?"bad":crypto.createHash("sha256").update(body).digest("hex")};this.bundles.push(r);return r;}
  if(method==="PUT"){this.tracks=this.tracks.filter(t=>t.track!=="internal").concat(structuredClone(body));if(this.mutateProduction)this.tracks[0].releases[0].versionCodes=["99"];return body;}
  if(suffix.endsWith(":validate"))return {};
  if(suffix.endsWith(":commit")){if(this.review)throw Error("review already active");return {id:"owned-edit"};}
  throw Error("Unhandled mock call");
 }
}
it("plans from pinned local bytes without any Google connection",()=>{const r=candidate();expect(r.bytes.toString()).toContain("offline bundle");});
it.each(["production","alpha","beta","wear:production"])("rejects %s as a candidate target",track=>{
 const r=candidate();fs.writeFileSync(r.manifestFile,JSON.stringify({...r.value,track}));expect(()=>c.inspectCandidate(r.manifestFile)).toThrow(/internal-track/);
});
it.each(["completed","inProgress","halted"])("rejects serving status %s",releaseStatus=>{
 const r=candidate();fs.writeFileSync(r.manifestFile,JSON.stringify({...r.value,releaseStatus}));expect(()=>c.inspectCandidate(r.manifestFile)).toThrow(/internal-track/);
});
it("rejects a foreign package, a modified bundle and world-readable manifests",()=>{
 const r=candidate();fs.writeFileSync(r.manifestFile,JSON.stringify({...r.value,packageName:"other.app"}));expect(()=>c.inspectCandidate(r.manifestFile)).toThrow();
 fs.writeFileSync(r.manifestFile,JSON.stringify(r.value));fs.appendFileSync(r.value.aab,"changed");expect(()=>c.inspectCandidate(r.manifestFile)).toThrow(/pinned/);
 fs.chmodSync(r.manifestFile,0o644);expect(()=>c.inspectCandidate(r.manifestFile)).toThrow(/permissions/);
});
it("refuses symlink or hardlink credential files",()=>{
 const file=path.join(root,"download.json");fs.writeFileSync(file,JSON.stringify(credential()),{mode:0o600});const linked=path.join(root,"linked.json");fs.symlinkSync(file,linked);expect(()=>c.readJson(linked,{secret:true})).toThrow();fs.unlinkSync(linked);fs.linkSync(file,linked);expect(()=>c.readJson(file,{secret:true})).toThrow(/link/);
});
it("imports a dedicated credential privately and never returns its key",()=>{
 const file=path.join(root,"download.json"),target=path.join(root,"private");fs.writeFileSync(file,JSON.stringify(credential()),{mode:0o644});
 const r=c.importCredential(file,target);expect(r.installed).toBe(true);expect(JSON.stringify(r)).not.toContain("PRIVATE KEY");expect(fs.statSync(file).mode&0o777).toBe(0o600);expect(fs.statSync(target).mode&0o777).toBe(0o700);expect(fs.statSync(path.join(target,"service-account.json")).mode&0o777).toBe(0o600);
 expect(c.importCredential(file,target).installed).toBe(true);
});
it("does not overwrite an installed different service account",()=>{
 const file=path.join(root,"download.json"),target=path.join(root,"private");fs.writeFileSync(file,JSON.stringify(credential()),{mode:0o600});c.importCredential(file,target);fs.writeFileSync(file,JSON.stringify({...credential(),client_email:"other@slr-play-test.iam.gserviceaccount.com"}));expect(()=>c.importCredential(file,target)).toThrow(/overwritten/);
});
it("rejects personal login caches, external-account files and redirected token endpoints",()=>{
 for(const value of [{type:"authorized_user"},{type:"external_account"},{...credential(),token_uri:"https://attacker.invalid/token"},{...credential(),universe_domain:"attacker.invalid"},{...credential(),private_key:"invalid"}])expect(()=>c.validateCredential(value)).toThrow();
});
it("hard-limits network endpoints to this app and the internal track",()=>{
 for(const [method,suffix,options] of [["PUT","/owned-edit/tracks/production",{}],["PUT","/owned-edit/tracks/beta",{}],["POST","/owned-edit:commit",{}],["POST","/owned-edit/bundles",{}],["PUT","/owned-edit/testers",{}],["GET","//attacker.invalid",{}],["GET","/owned-edit/../../users",{}],["POST","",{upload:true}]] as any[])expect(()=>c.requestSpec(method,suffix,options)).toThrow();
 expect(c.requestSpec("POST","/owned-edit:commit",{commit:true}).url).toContain("changesInReviewBehavior=ERROR_IF_IN_REVIEW");
 expect(c.requestSpec("POST","/owned-edit:commit",{commit:true}).url).toContain("changesNotSentForReview=true");
});
it("probes and deletes only its own temporary edit without uploading",async()=>{
 const api=new FakeApi(),save=vi.fn(),r=await c.probe(api,save);expect(r.maximumObservedVersion).toBe(32);expect(r.ownEditDeleted).toBe(true);expect(api.calls.filter(x=>x.method==="DELETE").map(x=>x.suffix)).toEqual(["/owned-edit"]);expect(api.calls.some(x=>x.options.upload||x.suffix.includes(":commit"))).toBe(false);
});
it("reports a failed disposable-edit cleanup",async()=>{const api=new FakeApi();api.failCleanup=true;const r=await c.probe(api,()=>{});expect(r.ownEditDeleted).toBe(false);expect(r.cleanupRequiresAttention).toBe(true);});
it("stages an internal draft, preserves completed testing and production, and does not commit",async()=>{
 const api=new FakeApi(),r=candidate(),saved:any[]=[],before=structuredClone(api.tracks[0]);const receipt=await c.stage(api,r,(v:any)=>saved.push(structuredClone(v)));
 expect(receipt.phase).toBe("validated-open-edit");expect(api.tracks[0]).toEqual(before);expect(api.tracks[1].releases).toHaveLength(2);expect(api.tracks[1].releases[0].versionCodes).toEqual(["32"]);expect(api.tracks[1].releases[1]).toMatchObject({status:"draft",versionCodes:["37"]});expect(api.calls.some(x=>x.suffix.includes(":commit"))).toBe(false);expect(saved.some(v=>v.phase==="upload-started")).toBe(true);
});
it("refuses existing internal drafts before uploading anything",async()=>{
 const api=new FakeApi();api.tracks[1].releases.push({status:"draft",versionCodes:["36"]});await expect(c.stage(api,candidate(),()=>{})).rejects.toThrow(/already exists/);expect(api.calls.some(x=>x.options.upload)).toBe(false);
});
it("refuses used or lower version codes before uploading",async()=>{const api=new FakeApi();api.bundles.push({versionCode:37});await expect(c.stage(api,candidate(),()=>{})).rejects.toThrow(/already used/);expect(api.calls.some(x=>x.options.upload)).toBe(false);});
it("does not retry or discard an uncertain upload",async()=>{
 const api=new FakeApi();api.failUpload=true;const saved:any[]=[];await expect(c.stage(api,candidate(),(r:any)=>saved.push(structuredClone(r)))).rejects.toThrow(/uncertain/);expect(api.calls.filter(x=>x.options.upload)).toHaveLength(1);expect(api.calls.some(x=>x.method==="DELETE")).toBe(false);expect(saved.at(-1)).toMatchObject({phase:"needs-attention",phaseAtFailure:"upload-started"});
});
it("rejects an uploaded hash mismatch",async()=>{const api=new FakeApi();api.badHash=true;await expect(c.stage(api,candidate(),()=>{})).rejects.toThrow(/receipt/);expect(api.calls.some(x=>x.method==="PUT")).toBe(false);});
it("refuses to proceed if a non-internal track changes",async()=>{const api=new FakeApi();api.mutateProduction=true;await expect(c.stage(api,candidate(),()=>{})).rejects.toThrow(/non-internal/);expect(api.calls.some(x=>x.suffix.includes(":commit"))).toBe(false);});
it("saves only the validated draft without serving it to testers",async()=>{
 const api=new FakeApi(),receipt=await c.stage(api,candidate(),()=>{}),r=await c.saveDraft(api,receipt,()=>{});expect(r.phase).toBe("draft-saved");expect(r.committed).toBe(true);expect(api.calls.find(x=>x.suffix.endsWith(":commit")).options.commit).toBe(true);expect(api.tracks[1].releases.at(-1).status).toBe("draft");
});
it("refuses expired receipts, changed artifacts and tampered serving statuses",async()=>{
 const api=new FakeApi(),receipt=await c.stage(api,candidate(),()=>{});await expect(c.saveDraft(api,{...receipt,expiryTimeSeconds:"1"},()=>{})).rejects.toThrow(/expired/);
 const bad=structuredClone(receipt);bad.expectedInternal.releases.at(-1).status="completed";await expect(c.saveDraft(api,bad,()=>{})).rejects.toThrow(/release-status/);
 fs.appendFileSync(receipt.aab,"changed");await expect(c.saveDraft(api,receipt,()=>{})).rejects.toThrow(/candidate changed/);expect(api.calls.some(x=>x.suffix.includes(":commit"))).toBe(false);
});
it("does not retry commits that Google rejects or cannot confirm",async()=>{
 const api=new FakeApi(),receipt=await c.stage(api,candidate(),()=>{});api.review=true;let last:any;await expect(c.saveDraft(api,receipt,(v:any)=>{last=structuredClone(v);})).rejects.toThrow(/review/);expect(last.phase).toBe("commit-needs-reconciliation");await expect(c.saveDraft(api,last,()=>{})).rejects.toThrow(/uncommitted/);expect(api.calls.filter(x=>x.suffix.includes(":commit"))).toHaveLength(1);
});
it("retains bounded Google error reasons without exposing auth secrets",()=>{
 const error=c.googleFailure(400,JSON.stringify({error:{status:"INVALID_ARGUMENT",message:"This review parameter is not allowed.",details:[{reason:"INVALID_REVIEW_PARAMETER"}],errors:[{reason:"badRequest"}]}}));
 expect(error.googleError).toMatchObject({httpStatus:400,status:"INVALID_ARGUMENT",message:"This review parameter is not allowed.",reasons:["INVALID_REVIEW_PARAMETER","badRequest"]});
 for(const message of ['Bearer secret-token','access_token="secret"','-----BEGIN PRIVATE KEY----- secret','ya29.secret']){
  const r=c.googleFailure(401,JSON.stringify({error:{message}}));expect(r.googleError.message).toBe("Sensitive-looking error details omitted.");expect(r.message).not.toContain("secret");
 }
 expect(c.googleFailure(400,"not JSON").googleError).toEqual({httpStatus:400});
});
it("journals a refused commit's safe error details without enabling a retry",async()=>{
 const api=new FakeApi(),receipt=await c.stage(api,candidate(),()=>{});let last:any;
 const original=api.call.bind(api);api.call=async(method,suffix,body,options)=>{
  if(suffix.endsWith(":commit"))throw c.googleFailure(400,JSON.stringify({error:{message:"Changes are already in review.",status:"FAILED_PRECONDITION",details:[{reason:"CHANGES_ALREADY_IN_REVIEW"}]}}));
  return original(method,suffix,body,options);
 };
 await expect(c.saveDraft(api,receipt,(v:any)=>{last=structuredClone(v);})).rejects.toThrow(/HTTP 400/);
 expect(last.googleError).toMatchObject({httpStatus:400,reasons:["CHANGES_ALREADY_IN_REVIEW"]});expect(last.phase).toBe("commit-needs-reconciliation");
 await expect(c.saveDraft(api,last,()=>{})).rejects.toThrow(/uncommitted/);
});
it("rejects production and arbitrary command-line overrides",()=>{
 for(const argv of [["publish","--track","production"],["stage","--track","production"],["status","--execute"],["stage","--manifest","/tmp/a","--manifest","/tmp/b"]])expect(()=>args([...argv])).toThrow();expect(args(["stage","--manifest","/tmp/candidate.json","--execute"]).opts["--execute"]).toBe(true);
});
it("keeps the existing-review guard when normal Google review is explicitly enabled",()=>{
 const spec=c.requestSpec("POST","/owned-edit:commit",{commit:true,automaticReview:true});
 expect(spec.url).toContain("changesInReviewBehavior=ERROR_IF_IN_REVIEW");
 expect(spec.url).not.toContain("changesNotSentForReview");
 expect(()=>c.requestSpec("GET","/owned-edit/tracks",{automaticReview:true})).toThrow();
 expect(()=>args(["save-draft","--automatic-review"])).toThrow();
});
it("releases only the pinned internal candidate and leaves other tracks and old bundles untouched",async()=>{
 const api=new FakeApi(),receipt=await c.stage(api,candidate(),()=>{}),before=structuredClone(api.tracks[0]),bundles=structuredClone(api.bundles);
 const r=await c.releaseInternal(api,receipt,()=>{},{automaticReview:true});
 expect(r.phase).toBe("internal-release-committed");expect(r.committed).toBe(true);
 expect(api.tracks[0]).toEqual(before);expect(api.bundles).toEqual(bundles);
 expect(api.tracks[1]).toMatchObject({track:"internal",releases:[{status:"completed",versionCodes:["37"]}]});
 expect(api.tracks[1].releases).toHaveLength(1);
 expect(api.calls.find(x=>x.suffix.endsWith(":commit")).options).toEqual({commit:true,automaticReview:true});
});
it("requires review approval and rejects changed/expired receipts before any internal rollout",async()=>{
 const api=new FakeApi(),receipt=await c.stage(api,candidate(),()=>{});api.calls=[];
 await expect(c.releaseInternal(api,receipt,()=>{})).rejects.toThrow(/explicit approval/);expect(api.calls).toHaveLength(0);
 await expect(c.releaseInternal(api,{...receipt,expiryTimeSeconds:"1"},()=>{},{automaticReview:true})).rejects.toThrow(/expired/);expect(api.calls).toHaveLength(0);
 fs.appendFileSync(receipt.aab,"changed");await expect(c.releaseInternal(api,receipt,()=>{},{automaticReview:true})).rejects.toThrow(/candidate changed/);expect(api.calls).toHaveLength(0);
});
it("does not commit an internal release if a non-internal track changes",async()=>{
 const api=new FakeApi(),receipt=await c.stage(api,candidate(),()=>{});api.mutateProduction=true;
 await expect(c.releaseInternal(api,receipt,()=>{},{automaticReview:true})).rejects.toThrow(/non-internal/);
 expect(api.calls.some(x=>x.suffix.endsWith(":commit"))).toBe(false);
});
it("requires reconciliation instead of retrying an uncertain internal commit",async()=>{
 const api=new FakeApi(),receipt=await c.stage(api,candidate(),()=>{});api.review=true;let last:any;
 await expect(c.releaseInternal(api,receipt,(r:any)=>{last=structuredClone(r);},{automaticReview:true})).rejects.toThrow(/review/);
 expect(last.phase).toBe("internal-commit-needs-reconciliation");
 await expect(c.releaseInternal(api,last,()=>{},{automaticReview:true})).rejects.toThrow(/uncommitted/);
 expect(api.calls.filter(x=>x.suffix.endsWith(":commit"))).toHaveLength(1);
});
