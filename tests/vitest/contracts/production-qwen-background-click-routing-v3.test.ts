import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "app", "app", "components", "StoryboardPanel.tsx"),
  "utf8",
);

describe("Production Qwen Background Gallery click routing v3", () => {
  it("does not register the legacy capture interceptor while Qwen is mounted", () => {
    const marker = "OTG_QWEN_LEGACY_BACKGROUND_INTERCEPTOR_DISABLE_V2_START";
    const selector = "const qwenBuilderSelector = '[data-otg-qwen-scene-builder=\"true\"]';";
    const mountGuard = "if (document.querySelector(qwenBuilderSelector)) {\n    return;\n  }";
    const registration = 'document.addEventListener("click", handleClick, true)';

    const markerIndex = source.indexOf(marker);
    const selectorIndex = source.indexOf(selector, markerIndex);
    const guardIndex = source.indexOf(mountGuard, selectorIndex);
    const registrationIndex = source.indexOf(registration, guardIndex);

    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(selectorIndex).toBeGreaterThan(markerIndex);
    expect(guardIndex).toBeGreaterThan(selectorIndex);
    expect(registrationIndex).toBeGreaterThan(guardIndex);
  });

  it("also blocks a legacy handler if Qwen appears after the effect was registered", () => {
    const runtimeGuard = "if (document.querySelector(qwenBuilderSelector)) return;";
    const textMatcher = 'if (text === "Background Gallery" || text === "Add Background" || text === "Background Gallery")';

    const runtimeGuardIndex = source.indexOf(runtimeGuard);
    const textMatcherIndex = source.indexOf(textMatcher, runtimeGuardIndex);

    expect(runtimeGuardIndex).toBeGreaterThanOrEqual(0);
    expect(textMatcherIndex).toBeGreaterThan(runtimeGuardIndex);
  });

  it("keeps both explicit button-level Qwen exclusions required by the legacy contract", () => {
    const guard = "if (button.closest('[data-otg-qwen-scene-builder=\"true\"]')) return;";
    expect(source.split(guard).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("keeps the legacy modal code only as a non-Qwen fallback", () => {
    expect(source).toContain("openStoryboardBackgroundGalleryV36AK");
    expect(source).toContain("OTG_QWEN_LEGACY_BACKGROUND_INTERCEPTOR_DISABLE_V2_END");
  });
});
