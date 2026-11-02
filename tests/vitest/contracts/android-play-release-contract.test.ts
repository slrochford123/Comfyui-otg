import fs from "node:fs";
import path from "node:path";
import {expect,it} from "vitest";

const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),"utf8");
it("targets Android 16 with a supported Gradle plugin and preserves the previous Play minimum",()=>{
 const variables=read("android/variables.gradle");
 expect(variables).toMatch(/compileSdkVersion\s*=\s*36/);
 expect(variables).toMatch(/targetSdkVersion\s*=\s*36/);
 expect(variables).toMatch(/minSdkVersion\s*=\s*24/);
 expect(read("android/build.gradle")).toContain("com.android.tools.build:gradle:8.10.1");
 expect(read("android/gradle/wrapper/gradle-wrapper.properties")).toContain("gradle-8.11.1-all.zip");
});
it("retains the published wrapper's speech permissions without requesting broad file access",()=>{
 const manifest=read("android/app/src/main/AndroidManifest.xml");
 for(const permission of ["INTERNET","RECORD_AUDIO","MODIFY_AUDIO_SETTINGS"])expect(manifest).toContain(`android.permission.${permission}`);
 for(const permission of ["MANAGE_EXTERNAL_STORAGE","READ_EXTERNAL_STORAGE","WRITE_EXTERNAL_STORAGE"])expect(manifest).not.toContain(`android.permission.${permission}`);
});
it("keeps production identity and website, with no signing secrets committed to Gradle",()=>{
 const build=read("android/app/build.gradle");
 expect(build).toContain('applicationId "com.slr.otg"');
 expect(read("capacitor.config.ts")).toContain("https://comf-otg.comfyui-otg.win");
 expect(read("capacitor.config.ts")).toContain("webDir: 'android-web'");
 expect(read("android-web/index.html")).toContain('href="https://comf-otg.comfyui-otg.win/app"');
 expect(fs.readdirSync(path.join(process.cwd(),"android-web"))).toEqual(["index.html"]);
 expect(read("capacitor.config.ts")).toContain("adjustMarginsForEdgeToEdge: 'auto'");
 expect(JSON.parse(read("android/app/src/qa/assets/capacitor.config.json")).android.adjustMarginsForEdgeToEdge).toBe("auto");
 expect(build).not.toMatch(/(?:storePassword|keyPassword)\s+["']/);
 expect(read("android/app/src/main/java/com/slr/otg/MainActivity.java")).toContain("installDownloadListener()");
});
