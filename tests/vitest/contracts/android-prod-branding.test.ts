import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {createRequire} from "node:module";
import sharp from "sharp";
import {expect,it} from "vitest";
const require=createRequire(import.meta.url);
const {DENSITIES,renderIcon}=require("../../../scripts/android/generate-prod-branding.cjs");
const root=process.cwd(),res=path.join(root,"android/app/src/main/res");
const read=(f:string)=>fs.readFileSync(path.join(root,f),"utf8");
const hash=(b:Buffer)=>crypto.createHash("sha256").update(b).digest("hex");
it.each(Object.entries(DENSITIES))("packages the official purple SLR launcher at %s",async(density,size)=>{
 for(const name of ["ic_launcher","ic_launcher_round"]){
  const expected=await renderIcon(size,.94,name==="ic_launcher",name==="ic_launcher_round");
  const file=fs.readFileSync(path.join(res,`mipmap-${density}/${name}.png`));
  expect(hash(file)).toBe(hash(expected));
  const info=await sharp(file).metadata();expect(info.width).toBe(size);expect(info.height).toBe(size);
 }
 const foreground=fs.readFileSync(path.join(res,`mipmap-${density}/ic_launcher_foreground.png`));
 expect(hash(foreground)).toBe(hash(await renderIcon(Math.round(Number(size)*2.25),.56,true)));
 const {data,info}=await sharp(foreground).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 expect(data[3]).toBe(0);expect(data[(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*4+3]).toBeGreaterThan(0);
});
it("uses purple production branding and the SLR Studios label without changing the package or PROD URL",()=>{
 expect(read("android/app/src/main/res/values/strings.xml")).toContain('<string name="app_name">SLR Studios</string>');
 expect(read("android/app/src/main/res/values/ic_launcher_background.xml")).toContain("#160c32");
 expect(read("android/app/src/main/res/values/styles.xml")).toContain('@mipmap/ic_launcher');
 expect(read("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml")).toContain('@mipmap/ic_launcher_foreground');
 expect(read("capacitor.config.ts")).toContain("appName: 'SLR Studios'");
 expect(read("capacitor.config.ts")).toContain("url: 'https://comf-otg.comfyui-otg.win'");
 expect(read("android/app/build.gradle")).toContain('applicationId "com.slr.otg"');
 const gradle=read("android/app/build.gradle");
 const buildCodes=[...gradle.matchAll(/versionCode\s+(\d+)/g)].map((match)=>Number(match[1]));
 expect(buildCodes.length).toBeGreaterThanOrEqual(2);
 expect(buildCodes[0]).toBeGreaterThanOrEqual(38);
 expect(buildCodes.every((code)=>code===buildCodes[0])).toBe(true);
 const [base,qa,prod]=[...gradle.matchAll(/versionName\s+"([^"]+)"/g)].map((match)=>match[1]);
 expect(base).toMatch(/^\d+\.\d+\.\d+$/);
 expect(qa).toBe(base+"-test");
 expect(prod ?? base).toBe(base);
 expect(read("android/app/src/qa/res/values/strings.xml")).toContain("SLR Studios TEST");
});
