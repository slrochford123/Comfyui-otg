import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("Android Full Gallery download wrapper contract", () => {
  it("keeps a side-by-side TEST package for native download validation", () => {
    const buildGradle = read("android/app/build.gradle");
    const strings = read("android/app/src/downloadtest/res/values/strings.xml");

    expect(buildGradle).toContain('applicationId "com.slr.otg"');
    expect(buildGradle).toContain("flavorDimensions");
    expect(buildGradle).toContain("downloadtest");
    expect(buildGradle).toContain('applicationId "com.slr.otg.downloadtest"');
    expect(buildGradle).toContain('versionNameSuffix "-downloadtest"');
    expect(strings).toContain("SLR OTG DOWNLOAD TEST");
  });

  it("installs a Capacitor WebView DownloadManager listener with WebView session cookies", () => {
    const activity = read("android/app/src/main/java/com/slr/otg/MainActivity.java");

    expect(activity).toContain("extends BridgeActivity");
    expect(activity).toContain("getBridge()");
    expect(activity).toContain("getWebView()");
    expect(activity).toContain("setDownloadListener");
    expect(activity).toContain("new DownloadManager.Request(uri)");
    expect(activity).toContain("CookieManager.getInstance().getCookie(url)");
    expect(activity).toContain('request.addRequestHeader("Cookie", cookies)');
    expect(activity).toContain('request.addRequestHeader("User-Agent", userAgent)');
    expect(activity).toContain('request.addRequestHeader("Referer", referer)');
    expect(activity).toContain("URLUtil.guessFileName");
    expect(activity).toContain("setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS");
    expect(activity).toContain("VISIBILITY_VISIBLE_NOTIFY_COMPLETED");
    expect(activity).not.toMatch(/Authorization/i);
    expect(activity).not.toMatch(/Bearer/i);
  });

  it("does not add obsolete broad storage permissions", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");

    expect(manifest).toContain("android.permission.INTERNET");
    expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");
    expect(manifest).not.toContain("READ_EXTERNAL_STORAGE");
    expect(manifest).not.toContain("WRITE_EXTERNAL_STORAGE");
    expect(manifest).not.toContain("MANAGE_EXTERNAL_STORAGE");
  });
});
