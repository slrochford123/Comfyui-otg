import {afterEach,beforeEach,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import {NextRequest} from "next/server";
import {createSession,reserveAsset,finishAsset,getSession,getAsset,removeSavedUpload,updateSession} from "@/lib/experiments/store";
import {assetServe,assetRemoveSaved} from "@/lib/experiments/assetHandlers";
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"h3-saved-uploads-unit-"));vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_EXPERIMENTS_ROOT",path.join(root,"lab"));vi.stubEnv("OTG_DATA_DIR",path.join(root,"data"));});
afterEach(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
async function fixture(role="source",experiment="prism-pika") {
  const session=createSession("alice",experiment),asset=reserveAsset("alice",session.id,"boat.png","image/png",role);
  const bytes=await sharp({create:{width:320,height:200,channels:3,background:"#8b5cf6"}}).png().toBuffer();
  fs.writeFileSync(asset.file,bytes);finishAsset("alice",asset.id,bytes.length,crypto.createHash("sha256").update(bytes).digest("hex"));return {session,asset,bytes};
}
it("persists list removal without changing selected inputs, revision, media bytes or historical access",async()=>{
  const {session,asset,bytes}=await fixture();
  const selected=updateSession("alice",session.id,{...session,settings:{...session.settings,selectedSources:[asset.id]}});
  const removed=removeSavedUpload("alice",asset.id);
  expect(removed.revision).toBe(selected.revision);expect(removed.settings.selectedSources).toEqual([asset.id]);
  expect(getSession("alice",session.id).assets[0].removedFromSaved).toBeTruthy();expect(fs.readFileSync(getAsset("alice",asset.id).file)).toEqual(bytes);
  expect(removeSavedUpload("alice",asset.id).assets).toHaveLength(1);
  const download=await assetServe(new NextRequest(`http://localhost/api/h3/nsfw/assets?id=${asset.id}&download=1`),"alice",true);
  expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
});
it("refuses cross-owner removal and generated-result removal",async()=>{
  const {asset}=await fixture();expect(()=>removeSavedUpload("bob",asset.id)).toThrow("not found");
  const generated=await fixture("generated");expect(()=>removeSavedUpload("alice",generated.asset.id)).toThrow("Only saved uploads");
  expect(()=>removeSavedUpload("alice","invalid")).toThrow("Invalid");
});
it("serves a bounded private thumbnail and retains the original download",async()=>{
  const {asset,bytes}=await fixture();
  const request=new NextRequest(`http://localhost/api/h3/nsfw/assets?id=${asset.id}&thumbnail=1`);
  const thumb=await assetServe(request,"alice",true);expect(thumb.headers.get("content-type")).toBe("image/webp");expect(thumb.headers.get("cache-control")).toContain("no-store");
  const meta=await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();expect([meta.width,meta.height]).toEqual([160,100]);
  expect(fs.readFileSync(getAsset("alice",asset.id).file)).toEqual(bytes);
  await expect(assetServe(request,"bob",true)).rejects.toMatchObject({status:404});
},30000);
it("the NSFW removal handler does not expose quarantined Testing assets",async()=>{
  const {asset}=await fixture("source","pika-flex");
  await expect(assetRemoveSaved(new NextRequest(`http://localhost/api/h3/nsfw/assets?id=${asset.id}`,{method:"DELETE"}),"alice")).rejects.toMatchObject({status:404});
});
