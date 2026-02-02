"use client";

import { useThemeMode } from "@/app/hooks/useTheme";

export default function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  return (
    <button className="otg-pill otg-pill-ghost" onClick={toggle} title="Toggle neon mode" type="button">
      {mode === "neon" ? "Neon" : "Purple"}
    </button>
  );
}
