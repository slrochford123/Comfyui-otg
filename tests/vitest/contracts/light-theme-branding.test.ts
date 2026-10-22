import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { APP_THEME_OPTIONS, generateThemeFromColor, themeContrastRatio } from "@/lib/appTheme";
describe("Soft light theme and official TEST branding", () => {
  it.each([...APP_THEME_OPTIONS.map(x => x.baseColor), "#ff6600", "#00ffff", "#ffff00"])("keeps text and accent AA-readable for %s", color => {
    const t = generateThemeFromColor(color, "light");
    for (const surface of [t.card, t.surface, t.surfaceElevated]) { expect(themeContrastRatio(t.text, surface)).toBeGreaterThanOrEqual(4.5); expect(themeContrastRatio(t.textMuted, surface)).toBeGreaterThanOrEqual(4.5); }
    expect(themeContrastRatio(t.primary, t.card)).toBeGreaterThanOrEqual(4.5);
    expect(themeContrastRatio(t.primary, t.primaryForeground)).toBeGreaterThanOrEqual(4.5);
    expect([t.background, t.card, t.surface, t.surfaceElevated]).not.toContain("#ffffff");
  });
  it("maps legacy surfaces once for dialogs and pages, not page-specific offsets", () => {
    const css = fs.readFileSync("app/light-theme.css", "utf8");
    expect(css).toContain('html[data-otg-color-mode="light"]'); expect(css).toContain('[role="dialog"]');
    expect(css).not.toContain("filter: invert");
    expect(css).toContain("--color-error"); expect(css).toContain("--color-success");
    expect(css).toContain(':is(button, a)[class*="bg-[linear-gradient"] *');
    expect(css).toContain(":is(.otg-adminRow, .otg-adminValue)");
    expect(css).toContain(".otg-adminDeleteBtn { color: var(--color-error)");
    const legacy = fs.readFileSync("app/app/globals.css", "utf8").split("/* OTG_BUTTON_TEXT_CONTRAST_PATCH_START */")[1].split("/* OTG_BUTTON_TEXT_CONTRAST_PATCH_END */")[0];
    expect(legacy).toContain('html:not([data-otg-color-mode="light"])');
    expect(legacy).not.toMatch(/\nbutton,\nbutton \*/);
  });
  it.each(["public/manifest.json", "public/manifest.webmanifest"])("uses the official icon and correct maskable asset: %s", file => {
    const j = JSON.parse(fs.readFileSync(file, "utf8")); expect(j.name).toBe("SLR Studios");
    expect(j.icons.find((i: any) => i.sizes === "512x512" && i.purpose === "maskable").src).toBe("/icon-512-maskable.png");
    for (const icon of j.icons) expect(fs.existsSync("public" + icon.src)).toBe(true);
  });
  it("mounts launch intro only in root, respects reduced motion, no video dependency", () => {
    expect(fs.readFileSync("app/layout.tsx", "utf8")).toContain("<LaunchIntro />");
    const c = fs.readFileSync("app/components/LaunchIntro.tsx", "utf8"); expect(c).toContain("2000"); expect(c).toContain("/Brand/slr-icon.png"); expect(c).not.toContain("<video");
    expect(fs.readFileSync("app/launch-intro.css", "utf8")).toContain("prefers-reduced-motion");
  });
  it("keeps native QA branding on the TEST package and secure TEST origin", () => {
    const j = JSON.parse(fs.readFileSync("android/app/src/qa/assets/capacitor.config.json", "utf8"));
    expect(j.appId).toBe("com.slr.otg.test"); expect(j.server.url).toBe("https://shawn-1.tail2c7e2e.ts.net:8443");
    expect(j.plugins.LocalNotifications.smallIcon).toBe("ic_stat_slr");
    expect(fs.existsSync("android/app/src/qa/res/drawable/ic_stat_slr.png")).toBe(true);
  });
});
