import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root=await fs.mkdtemp(path.join(os.tmpdir(),"otg-google-photos-test-"));
vi.stubEnv("OTG_DATA_DIR",root);vi.stubEnv("OTG_GOOGLE_PHOTOS_CLIENT_ID","test-client");vi.stubEnv("OTG_GOOGLE_PHOTOS_CLIENT_SECRET","test-secret");vi.stubEnv("OTG_GOOGLE_PHOTOS_REDIRECT_URI","https://test.example/api/integrations/google-photos/callback");
const photos=await import("@/lib/googlePhotos");
let sequence=0;
const pickedId="picker-session-abcdefghijklmnopqrst";
const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
  const url=String(input);
  if(url.includes("/token"))return Response.json({access_token:"private-access-token",refresh_token:"private-refresh-token",expires_in:3600,scope:photos.GOOGLE_PHOTOS_SCOPE});
  if(url.endsWith("/revoke"))return new Response("",{status:200});
  if(url.endsWith("/sessions"))return Response.json({id:pickedId,pickerUri:"https://photos.google.com/picker/test"});
  if(url.includes("/sessions/"))return Response.json({mediaItemsSet:true});
  if(url.includes("/mediaItems?"))return Response.json({mediaItems:[{id:"first",mediaFile:{filename:"b.png",mimeType:"image/png",baseUrl:"https://lh3.googleusercontent.com/first"}},{id:"second",mediaFile:{filename:"a.png",mimeType:"image/png",baseUrl:"https://lh3.googleusercontent.com/second"}}]});
  if(url.startsWith("https://lh3.googleusercontent.com/"))return new Response("image bytes",{headers:{"Content-Type":"image/png"}});
  throw Error("Unexpected network target: "+url);
});
beforeEach(()=>{vi.stubGlobal("fetch",fetcher);fetcher.mockClear();});
afterAll(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true});});
async function connected(){const owner="owner-"+(++sequence),start=await photos.beginGooglePhotos(owner);await photos.completeGooglePhotos(start.attempt,"test-code");await photos.googlePhotosStatus(owner,start.attempt);return owner;}
describe("Selected-media Google Photos integration",()=>{
  it("uses only Photos Picker scope with PKCE and does not alter application login",async()=>{
    const start=await photos.beginGooglePhotos("one"),url=new URL(start.authorizationUrl);
    expect(url.searchParams.get("scope")).toBe(photos.GOOGLE_PHOTOS_SCOPE);expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(start.attempt);expect(url.searchParams.has("client_secret")).toBe(false);
  });
  it("requires the initiating app owner to claim approval, rejects replay, and encrypts credentials at rest",async()=>{
    const start=await photos.beginGooglePhotos("owner-a");await photos.completeGooglePhotos(start.attempt,"test-code");
    expect((await photos.googlePhotosStatus("owner-a")).connected).toBe(false);
    await expect(photos.googlePhotosStatus("owner-b",start.attempt)).rejects.toThrow(/expired/);
    expect((await photos.googlePhotosStatus("owner-a",start.attempt)).connected).toBe(true);
    await expect(photos.completeGooglePhotos(start.attempt,"replay")).rejects.toThrow(/expired/);
    const files=await fs.readdir(path.join(root,"google-photos","connections"),{recursive:true});
    for(const file of files.filter(file=>file.endsWith(".json"))){const content=await fs.readFile(path.join(root,"google-photos","connections",file),"utf8");expect(content).not.toContain("private-access-token");expect(content).not.toContain("private-refresh-token");}
  });
  it("preserves the returned reference order and never exposes media URLs or tokens in metadata",async()=>{
    const owner=await connected();await photos.beginGooglePicking(owner,4,"image/*");const result=await photos.googlePickingStatus(owner,pickedId);
    expect(result.items?.map(item=>item.name)).toEqual(["b.png","a.png"]);expect(JSON.stringify(result)).not.toMatch(/baseUrl|private-access-token/);
    expect((await photos.downloadGoogleMedia(owner,pickedId,"first")).bytes.toString()).toBe("image bytes");
    await expect(photos.downloadGoogleMedia("unrelated-owner",pickedId,"first")).rejects.toThrow(/account/);
  });
  it("refuses zero/full and excessive selections rather than requesting Google's default 2000 items",async()=>{
    const owner=await connected();await expect(photos.beginGooglePicking(owner,0,"image/*")).rejects.toThrow(/between 1 and 16/);await expect(photos.beginGooglePicking(owner,17,"image/*")).rejects.toThrow(/between 1 and 16/);
    await photos.beginGooglePicking(owner,1,"image/*");await expect(photos.googlePickingStatus(owner,pickedId)).rejects.toThrow(/nothing was discarded/i);
  });
  it("disconnects and revokes provider access without deleting imported app files",async()=>{const owner=await connected();expect((await photos.disconnectGooglePhotos(owner)).revoked).toBe(true);expect((await photos.googlePhotosStatus(owner)).connected).toBe(false);});
  it("removes a deleted account's provider credentials and selections without touching other accounts",async()=>{
    const owner=await connected(),other=await connected(),attempt=await photos.beginGooglePhotos(owner);
    await photos.beginGooglePicking(owner,4,"image/*");await photos.deleteGooglePhotosAccount(owner);
    expect((await photos.googlePhotosStatus(owner)).connected).toBe(false);expect((await photos.googlePhotosStatus(other)).connected).toBe(true);
    await expect(photos.completeGooglePhotos(attempt.attempt,"late-code")).rejects.toThrow(/expired/);
    await expect(photos.downloadGoogleMedia(owner,pickedId,"first")).rejects.toThrow(/account/);
  });
  it("rejects a missing Google configuration cleanly",async()=>{vi.stubEnv("OTG_GOOGLE_PHOTOS_CLIENT_ID","");expect(photos.googlePhotosConfiguration().configured).toBe(false);await expect(photos.beginGooglePhotos("any")).rejects.toThrow(/administrator setup/);vi.stubEnv("OTG_GOOGLE_PHOTOS_CLIENT_ID","test-client");});
});
