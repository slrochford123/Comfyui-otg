import { composeH3StylePrompt, DEFAULT_H3_STYLE_PRESET_ID, H3_STYLE_PRESETS } from "@/lib/h3StylePresets";
import { H3_STYLE_MEDIA_MANIFEST } from "@/lib/h3StyleMediaManifest";
import { H3_VISUAL_STYLE_PROFILES } from "@/lib/production/promptOptions";

export type H3StyleOrigin = "prompt-builder" | "style-art" | "default";

export type H3CanonicalStyle = {
  id: string;
  name: string;
  category: string;
  shortDescription: string;
  h3PromptInstructions: string;
  promptBuilderVisualStyle: keyof typeof H3_VISUAL_STYLE_PROFILES;
  poster: string | null;
  previewVideo: string | null;
  previewWebm: string | null;
  aliases: string[];
  origin: H3StyleOrigin;
  enabled: boolean;
};

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function promptBuilderCategory(name: string) {
  if (["Cinematic realism", "Live action", "Premium product commercial"].includes(name)) return "Realistic & Live Action";
  if (["3D animation", "Cartoon", "Anime", "Stop motion", "Mixed live action and hand-drawn animation"].includes(name)) return "Animation";
  if (["Illustrated", "Graphic motion design", "Animated poster"].includes(name)) return "Illustration & Graphic";
  if (["Game cinematic", "Gameplay / first-person"].includes(name)) return "Gaming";
  if (name === "Surreal dreamscape") return "Experimental";
  return "Genre & Cinematic";
}

function styleArtCategory(category: string) {
  if (category === "Painterly, Graphic & Material") return "Illustration & Graphic";
  if (category === "Default") return "Default";
  return "Animation";
}

function styleMedia(id: string) {
  return H3_STYLE_MEDIA_MANIFEST[id] || {};
}

const defaultStyle: H3CanonicalStyle = {
  id: DEFAULT_H3_STYLE_PRESET_ID,
  name: "Default / None",
  category: "Default",
  shortDescription: "H3 default behavior with no added master visual-style prompt.",
  h3PromptInstructions: "",
  promptBuilderVisualStyle: "Cinematic realism",
  poster: null,
  previewVideo: null,
  previewWebm: null,
  aliases: ["default", "none", "Default / None"],
  origin: "default",
  enabled: true,
};

const promptBuilderStyles: H3CanonicalStyle[] = Object.entries(H3_VISUAL_STYLE_PROFILES).map(([name, instructions]) => {
  const id = slug(name);
  const media = styleMedia(id);
  return {
    id,
    name,
    category: promptBuilderCategory(name),
    shortDescription: instructions.split(/(?<=[.!?])\s+/)[0] || instructions,
    h3PromptInstructions: instructions,
    promptBuilderVisualStyle: name as keyof typeof H3_VISUAL_STYLE_PROFILES,
    poster: media.poster || null,
    previewVideo: media.previewVideo || null,
    previewWebm: media.previewWebm || null,
    aliases: [name],
    origin: "prompt-builder" as const,
    enabled: true,
  };
});

const styleArtStyles: H3CanonicalStyle[] = H3_STYLE_PRESETS.slice(1).map((preset) => {
  const media = styleMedia(preset.id);
  return {
    id: preset.id,
    name: preset.label,
    category: styleArtCategory(preset.category),
    shortDescription: preset.description,
    h3PromptInstructions: preset.masterPrompt,
    promptBuilderVisualStyle: preset.promptBuilderVisualStyle as keyof typeof H3_VISUAL_STYLE_PROFILES,
    poster: media.poster || preset.thumbnail || null,
    previewVideo: media.previewVideo || null,
    previewWebm: media.previewWebm || null,
    aliases: [preset.label],
    origin: "style-art" as const,
    enabled: true,
  };
});

export const H3_STYLE_REGISTRY: readonly H3CanonicalStyle[] = [
  defaultStyle,
  ...promptBuilderStyles,
  ...styleArtStyles,
];

const byLookup = new Map<string, H3CanonicalStyle>();
for (const style of H3_STYLE_REGISTRY) {
  for (const value of [style.id, style.name, ...style.aliases]) {
    const key = value.trim().toLowerCase();
    if (key && !byLookup.has(key)) byLookup.set(key, style);
  }
}

export const H3_STYLE_ID_ALIASES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    H3_STYLE_REGISTRY.flatMap((style) =>
      style.aliases.map((alias) => [alias, style.id] as const),
    ),
  ),
);

export const H3_STYLE_CATEGORIES = [...new Set(H3_STYLE_REGISTRY.map((style) => style.category))];

export function resolveH3CanonicalStyle(value: unknown, fallbackToDefault = true) {
  const key = String(value ?? "").trim().toLowerCase();
  return byLookup.get(key) || (fallbackToDefault ? defaultStyle : null);
}

export function h3CanonicalStylePrompt(value: unknown) {
  return resolveH3CanonicalStyle(value)?.h3PromptInstructions || "";
}

export function composeH3CanonicalStylePrompt(userPrompt: string, styleId: unknown) {
  const instructions = h3CanonicalStylePrompt(styleId);
  return composeH3StylePrompt(userPrompt, instructions ? { masterPrompt: instructions } : null);
}
