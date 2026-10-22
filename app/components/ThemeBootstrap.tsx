"use client";
import { useLayoutEffect } from "react";
import { APP_COLOR_MODE_KEY, APP_CUSTOM_COLOR_KEY, APP_THEME_KEY, generateThemeFromColor, resolveThemeBaseColor, themeTokensToCssVars, type AppThemeId } from "@/lib/appTheme";
/** Admin/login routes share exactly the same tokens as the main app shell. */
export default function ThemeBootstrap() {
  useLayoutEffect(() => {
    try {
      const mode = localStorage.getItem(APP_COLOR_MODE_KEY) === "light" ? "light" : "dark";
      const raw = localStorage.getItem(APP_THEME_KEY) || "purple";
      const theme = ["purple", "blue", "yellow", "red", "green", "custom"].includes(raw) ? raw as AppThemeId : "purple";
      const tokens = generateThemeFromColor(resolveThemeBaseColor(theme, localStorage.getItem(APP_CUSTOM_COLOR_KEY) || undefined), mode);
      for (const [key, value] of Object.entries(themeTokensToCssVars(tokens))) document.documentElement.style.setProperty(key, value);
      document.documentElement.dataset.otgColorMode = mode;
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.body.classList.toggle("dark", mode === "dark");
    } catch { /* Storage denial keeps the server's accessible default theme. */ }
  }, []);
  return null;
}
