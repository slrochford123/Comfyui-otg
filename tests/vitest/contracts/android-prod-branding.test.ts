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
 const expected=await renderIcon(size,.94);
 for(const name of ["ic_launcher","ic_launcher_round"]){
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
 expect(read("android/app/src/main/res/values/styles.xml")).toContain('@drawable/slr_splash_logo');
 expect(read("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml")).toContain('@mipmap/ic_launcher_foreground');
 expect(read("capacitor.config.ts")).toContain("appName: 'SLR Studios'");
 expect(read("capacitor.config.ts")).toContain("url: 'https://comf-otg.comfyui-otg.win'");
 expect(read("android/app/build.gradle")).toContain('applicationId "com.slr.otg"');
 expect(read("android/app/build.gradle")).toMatch(/versionCode\s+38/);
 expect(read("android/app/build.gradle")).toContain('versionName "2.0.4"');
 expect(read("android/app/src/qa/res/values/strings.xml")).toContain("SLR Studios TEST");
});
