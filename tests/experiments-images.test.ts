import {afterEach,beforeEach,expect,it,vi} from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";import crypto from "node:crypto";import sharp from "sharp";
import {NextRequest} from "next/server";
import {createSession,getSession,labRoot} from "@/lib/experiments/store";
import {assetPost,assetServe} from "@/lib/experiments/assetHandlers";
import {prepareLabImage,labImagePaths,imagePrepareServiceOptions} from "@/lib/experiments/images";
import {labUploadMime,MAX_LAB_IMAGE_BYTES} from "@/lib/experiments/imageTypes";
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"h3-large-image-unit-"));vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_EXPERIMENTS_ROOT",path.join(root,"lab"));vi.stubEnv("OTG_DATA_DIR",path.join(root,"data"));});
afterEach(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
const digest=(b:Buffer)=>crypto.createHash("sha256").update(b).digest("hex");
it("uses a bounded system unit rather than a nonexistent user bus for root PROD",()=>{
 const args=imagePrepareServiceOptions(0,"/private/owned-stage","/run/lock/image.lock");expect(args).not.toContain("--user");for(const property of ["ProtectSystem=strict","ReadWritePaths=/private/owned-stage /run/lock/image.lock","PrivateDevices=yes","PrivateNetwork=yes","CapabilityBoundingSet=CAP_DAC_READ_SEARCH"])expect(args).toContain(property);expect(args).not.toContain("CapabilityBoundingSet=CAP_DAC_OVERRIDE");
 expect(imagePrepareServiceOptions(1000,"/private/stage","/run/user/1000/image.lock")).toEqual(["--user"]);
});
async function upload(bytes:Buffer,name="large.jpg",mime="image/jpeg"){
 const session=createSession("image-owner","prism-pika");
 const request=new NextRequest(`http://localhost/api/experiments/assets?session=${session.id}&name=${name}`,{method:"POST",headers:{"content-type":mime},body:new Uint8Array(bytes)});
 const r=await assetPost(request,"image-owner");expect(r.status).toBe(201);return (await r.json()).session;
}
it("accepts a real 108 MP photo, preserves original bytes and prepares a small correctly proportioned reference",async()=>{
 const bytes=await sharp({create:{width:12000,height:9000,channels:3,background:"#33aacc"}}).jpeg().toBuffer();const session=await upload(bytes),asset=session.assets[0],original=path.join(labRoot(),asset.id+".media"),prepared=await prepareLabImage(original,asset.sha256);
 expect(asset.bytes).toBe(bytes.length);expect(fs.readFileSync(original)).toEqual(bytes);expect(prepared).toMatchObject({width:2048,height:1536,originalWidth:12000,originalHeight:9000,mime:"image/jpeg"});
 const response=await assetServe(new NextRequest(`http://localhost/api/experiments/assets?id=${asset.id}`),"image-owner");expect(response.headers.get("content-type")).toBe("image/png");const meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();expect([meta.width,meta.height]).toEqual([2048,1536]);
 const download=await assetServe(new NextRequest(`http://localhost/api/experiments/assets?id=${asset.id}&download=1`),"image-owner");expect(digest(Buffer.from(await download.arrayBuffer()))).toBe(asset.sha256);
},30000);
it.each(["png","webp","gif","tiff","avif"] as const)("prepares %s without enlarging small images",async format=>{
 const bytes=await sharp({create:{width:96,height:64,channels:4,background:{r:10,g:30,b:100,alpha:.5}}})[format]().toBuffer();const session=await upload(bytes,"camera."+format,"application/octet-stream"),asset=session.assets[0];const prepared=await prepareLabImage(path.join(labRoot(),asset.id+".media"),asset.sha256);expect([prepared.width,prepared.height]).toEqual([96,64]);expect(asset.mime.startsWith("image/")).toBe(true);
},30000);
it("applies EXIF rotation and handles unusually wide panoramas",async()=>{
 const oriented=await sharp({create:{width:120,height:80,channels:3,background:"red"}}).jpeg().withMetadata({orientation:6}).toBuffer();const session=await upload(oriented),asset=session.assets[0];expect(await prepareLabImage(path.join(labRoot(),asset.id+".media"),asset.sha256)).toMatchObject({width:80,height:120});
 const panorama=await sharp({create:{width:30000,height:400,channels:3,background:"blue"}}).png().toBuffer();const wide=await upload(panorama,"wide.png","image/png"),a=wide.assets[0],p=await prepareLabImage(path.join(labRoot(),a.id+".media"),a.sha256);expect(p.width).toBe(2048);expect(p.height).toBeGreaterThan(0);expect(p.height).toBeLessThan(30);
},30000);
it("accepts bitmap images through the bounded decoder without enlarging them",async()=>{
 const bmp=Buffer.alloc(78);bmp.write('BM');bmp.writeUInt32LE(78,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);bmp.writeInt32LE(3,18);bmp.writeInt32LE(2,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp.fill(90,54);
 const s=await upload(bmp,"tiny.bmp","image/bmp"),a=s.assets[0],p=await prepareLabImage(path.join(labRoot(),a.id+".media"),a.sha256);expect([p.width,p.height,p.mime]).toEqual([3,2,"image/bmp"]);
},30000);
it("does not accept markup, damaged images or cross-owner media and cleans failed reservations",async()=>{
 const session=createSession("image-owner","prism-pika"),url=`http://localhost/api/experiments/assets?session=${session.id}`;
 for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///private.png"/></svg>'),Buffer.from([137,80,78,71,13,10,26,10,0,0])])await expect(assetPost(new NextRequest(url,{method:"POST",headers:{"content-type":"image/png"},body:new Uint8Array(bytes)}),"image-owner")).rejects.toMatchObject({status:415});
 expect(getSession("image-owner",session.id).assets).toEqual([]);expect(fs.readdirSync(labRoot()).filter(f=>f.includes(".media"))).toEqual([]);
 const own=await upload(await sharp({create:{width:8,height:8,channels:3,background:"green"}}).png().toBuffer(),"tiny.png","image/png");await expect(assetServe(new NextRequest(`http://localhost/api/experiments/assets?id=${own.assets[0].id}`),"other-owner")).rejects.toMatchObject({status:404});
},30000);
it("rebuilds a substituted derivative safely without serving a foreign file",async()=>{
 const session=await upload(await sharp({create:{width:8,height:8,channels:3,background:"green"}}).png().toBuffer(),"tiny.png","image/png"),a=session.assets[0],file=path.join(labRoot(),a.id+".media"),p=labImagePaths(file);fs.unlinkSync(p.image);fs.symlinkSync("/etc/hostname",p.image);await prepareLabImage(file,a.sha256);expect(fs.lstatSync(p.image).isSymbolicLink()).toBe(false);expect((await sharp(p.image).metadata()).format).toBe("png");
},30000);
it("retains a bounded byte limit without imposing a megapixel cutoff",async()=>{
 expect(labUploadMime("photo.JFIF","")).toBe("image/jpeg");expect(labUploadMime("photo.tiff","application/octet-stream")).toBe("image/tiff");expect(labUploadMime("a.jpg","image/pjpeg")).toBe("image/jpeg");
 const s=createSession("image-owner","prism-pika"),request=new NextRequest(`http://localhost/api/experiments/assets?session=${s.id}`,{method:"POST",headers:{"content-type":"image/jpeg","content-length":String(MAX_LAB_IMAGE_BYTES+1)},body:"x"});await expect(assetPost(request,"image-owner")).rejects.toMatchObject({status:413});expect(getSession("image-owner",s.id).assets).toEqual([]);
});
it("allows RGBA encoding overhead above 16 MiB without rejecting a valid image",async()=>{
 const bytes=await sharp(crypto.randomBytes(2048*2048*4),{raw:{width:2048,height:2048,channels:4}}).png().toBuffer();expect(bytes.length).toBeGreaterThan(16*1024**2);const s=await upload(bytes,"rgba.png","image/png"),a=s.assets[0],p=await prepareLabImage(path.join(labRoot(),a.id+".media"),a.sha256);expect(p.width).toBe(2048);expect(p.bytes).toBeGreaterThan(16*1024**2);expect(p.bytes).toBeLessThan(20*1024**2);
},30000);
