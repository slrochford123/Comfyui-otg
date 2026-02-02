"use client";

import { useEffect, useMemo, useState } from "react";

export type ThemeMode = "purple" | "neon";
const STORAGE_KEY = "otg_theme_mode";

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>("purple");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (saved === "purple" || saved === "neon") setMode(saved);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch {}
  }, [mode]);

  const toggle = () => setMode((m) => (m === "purple" ? "neon" : "purple"));
  return useMemo(() => ({ mode, setMode, toggle }), [mode]);
}
