import { describe, expect, it } from "vitest";

import {
  APP_THEME_OPTIONS,
  generateThemeFromColor,
  resolveThemeBaseColor,
  themeTokensToCssVars,
} from "@/lib/appTheme";

describe("app theme configuration", () => {
  it("exposes the expected preset and custom themes", () => {
    expect(APP_THEME_OPTIONS.map((theme) => theme.id)).toEqual(["purple", "blue", "yellow", "red", "green", "custom"]);
  });

  it("generates the required CSS variable contract for light and dark mode", () => {
    for (const mode of ["light", "dark"] as const) {
      const vars = themeTokensToCssVars(generateThemeFromColor("#2563eb", mode));

      expect(vars["--color-primary"]).toMatch(/^#/);
      expect(vars["--color-primary-hover"]).toBeTruthy();
      expect(vars["--color-primary-muted"]).toContain("rgba");
      expect(vars["--color-primary-border"]).toContain("rgba");
      expect(vars["--color-primary-foreground"]).toBeTruthy();
      expect(vars["--color-background"]).toBeTruthy();
      expect(vars["--color-surface"]).toBeTruthy();
      expect(vars["--color-card"]).toBeTruthy();
      expect(vars["--color-border"]).toBeTruthy();
      expect(vars["--color-text"]).toBeTruthy();
      expect(vars["--color-text-muted"]).toBeTruthy();
      expect(vars["--color-success"]).not.toEqual(vars["--color-primary"]);
      expect(vars["--color-warning"]).not.toEqual(vars["--color-primary"]);
      expect(vars["--color-error"]).not.toEqual(vars["--color-primary"]);
      expect(vars["--color-focus-ring"]).toContain("rgba");
    }
  });

  it("keeps the yellow theme readable by darkening the primary in light mode", () => {
    const tokens = generateThemeFromColor(resolveThemeBaseColor("yellow"), "light");

    expect(tokens.primaryForeground).toBe("#ffffff");
    expect(tokens.primary).not.toBe("#ffff00");
  });

  it("normalizes invalid custom colors to a safe default", () => {
    expect(resolveThemeBaseColor("custom", "not-a-color")).toBe("#8b5cf6");
    expect(resolveThemeBaseColor("custom", "#0ea5e9")).toBe("#0ea5e9");
  });
});
