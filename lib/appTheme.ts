export type AppThemeId = "purple" | "blue" | "yellow" | "red" | "green" | "custom";
export type AppColorMode = "dark" | "light";

export type AppThemeOption = {
  id: AppThemeId;
  label: string;
  description: string;
  baseColor: string;
};

export type AppThemeTokens = {
  primary: string;
  primaryHover: string;
  primaryMuted: string;
  primaryBorder: string;
  primaryForeground: string;
  background: string;
  surface: string;
  surfaceElevated: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  progress: string;
  status: string;
  focusRing: string;
  shadow: string;
};

export const APP_THEME_KEY = "app-theme";
export const APP_COLOR_MODE_KEY = "app-color-mode";
export const APP_CUSTOM_COLOR_KEY = "app-custom-color";

export const DEFAULT_CUSTOM_COLOR = "#8b5cf6";

export const APP_THEME_OPTIONS: AppThemeOption[] = [
  { id: "purple", label: "Purple", description: "Soft violet accents with a polished creative studio feel.", baseColor: "#8b5cf6" },
  { id: "blue", label: "Blue", description: "Trustworthy blue accents with clean production-tool contrast.", baseColor: "#2563eb" },
  { id: "yellow", label: "Yellow", description: "Warm gold accents with darker foregrounds for accessible contrast.", baseColor: "#d97706" },
  { id: "red", label: "Red", description: "Confident red brand accents kept distinct from error states.", baseColor: "#dc2626" },
  { id: "green", label: "Green", description: "Balanced green accents for a calm studio workspace.", baseColor: "#16a34a" },
  { id: "custom", label: "Custom", description: "Generate a complementary palette from your selected color.", baseColor: DEFAULT_CUSTOM_COLOR },
];

const PRESET_COLORS: Record<Exclude<AppThemeId, "custom">, string> = {
  purple: "#8b5cf6",
  blue: "#2563eb",
  yellow: "#d97706",
  red: "#dc2626",
  green: "#16a34a",
};

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHex(input: string): string {
  const raw = String(input || "").trim().replace(/^#/, "");
  const expanded = raw.length === 3 ? raw.split("").map((char) => char + char).join("") : raw;
  return /^[0-9a-f]{6}$/i.test(expanded) ? `#${expanded.toLowerCase()}` : DEFAULT_CUSTOM_COLOR;
}

function hexToRgb(input: string): Rgb {
  const hex = normalizeHex(input).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((value) => Math.round(clamp(value / 255) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb = [0, 0, 0];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
  };
}

function colorFromHsl(h: number, s: number, l: number): string {
  return rgbToHex(hslToRgb({ h: ((h % 360) + 360) % 360, s: clamp(s), l: clamp(l) }));
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function readableForeground(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.58 ? "#111827" : "#ffffff";
}

export function resolveThemeBaseColor(themeId: AppThemeId, customColor = DEFAULT_CUSTOM_COLOR): string {
  return themeId === "custom" ? normalizeHex(customColor) : PRESET_COLORS[themeId];
}

export function generateThemeFromColor(baseColor: string, mode: AppColorMode): AppThemeTokens {
  const primary = normalizeHex(baseColor);
  const hsl = rgbToHsl(hexToRgb(primary));
  const vivid = Math.max(hsl.s, 0.58);
  const primaryForMode = mode === "light"
    ? colorFromHsl(hsl.h, vivid, hsl.h > 35 && hsl.h < 75 ? 0.38 : 0.45)
    : colorFromHsl(hsl.h, Math.min(0.82, vivid + 0.08), hsl.h > 35 && hsl.h < 75 ? 0.62 : 0.64);
  const hover = mode === "light"
    ? colorFromHsl(hsl.h, vivid, Math.max(0.28, hsl.l - 0.1))
    : colorFromHsl(hsl.h, vivid, 0.72);
  const muted = rgba(primaryForMode, mode === "light" ? 0.12 : 0.18);
  const border = rgba(primaryForMode, mode === "light" ? 0.28 : 0.36);

  if (mode === "light") {
    return {
      primary: primaryForMode,
      primaryHover: hover,
      primaryMuted: muted,
      primaryBorder: border,
      primaryForeground: readableForeground(primaryForMode),
      background: `radial-gradient(circle at top left, ${rgba(primaryForMode, 0.14)}, transparent 34%), linear-gradient(180deg, #f8fafc, #eef2f7)`,
      surface: "rgba(255, 255, 255, 0.78)",
      surfaceElevated: "rgba(255, 255, 255, 0.94)",
      card: "rgba(255, 255, 255, 0.88)",
      border: "rgba(15, 23, 42, 0.14)",
      text: "#0f172a",
      textMuted: "rgba(51, 65, 85, 0.76)",
      success: "#15803d",
      warning: "#b45309",
      error: "#b91c1c",
      info: "#0369a1",
      progress: primaryForMode,
      status: colorFromHsl(hsl.h + 28, 0.66, 0.42),
      focusRing: rgba(primaryForMode, 0.38),
      shadow: "0 18px 60px rgba(15, 23, 42, 0.12)",
    };
  }

  return {
    primary: primaryForMode,
    primaryHover: hover,
    primaryMuted: muted,
    primaryBorder: border,
    primaryForeground: readableForeground(primaryForMode),
    background: `radial-gradient(circle at top left, ${rgba(primaryForMode, 0.22)}, transparent 34%), radial-gradient(circle at bottom right, ${rgba(colorFromHsl(hsl.h + 42, 0.72, 0.58), 0.12)}, transparent 34%), #070912`,
    surface: "rgba(11, 15, 27, 0.76)",
    surfaceElevated: "rgba(15, 23, 42, 0.92)",
    card: "rgba(8, 13, 24, 0.82)",
    border: "rgba(226, 232, 240, 0.13)",
    text: "#f8fafc",
    textMuted: "rgba(226, 232, 240, 0.68)",
    success: "#34d399",
    warning: "#fbbf24",
    error: "#fb7185",
    info: "#38bdf8",
    progress: primaryForMode,
    status: colorFromHsl(hsl.h + 38, 0.72, 0.66),
    focusRing: rgba(primaryForMode, 0.48),
    shadow: "0 18px 70px rgba(0, 0, 0, 0.42)",
  };
}

export function themeTokensToCssVars(tokens: AppThemeTokens): Record<string, string> {
  return {
    "--color-primary": tokens.primary,
    "--color-primary-hover": tokens.primaryHover,
    "--color-primary-muted": tokens.primaryMuted,
    "--color-primary-border": tokens.primaryBorder,
    "--color-primary-foreground": tokens.primaryForeground,
    "--color-background": tokens.background,
    "--color-surface": tokens.surface,
    "--color-surface-elevated": tokens.surfaceElevated,
    "--color-card": tokens.card,
    "--color-border": tokens.border,
    "--color-text": tokens.text,
    "--color-text-muted": tokens.textMuted,
    "--color-success": tokens.success,
    "--color-warning": tokens.warning,
    "--color-error": tokens.error,
    "--color-info": tokens.info,
    "--color-progress": tokens.progress,
    "--color-status": tokens.status,
    "--color-focus-ring": tokens.focusRing,
    "--color-shadow": tokens.shadow,
    "--otg-accent": tokens.primary,
    "--otg-accent-soft": tokens.primaryMuted,
    "--otg-panel": tokens.card,
  };
}
