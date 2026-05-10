"use client";

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import SpinDialNav, { type SpinTabId } from "./components/SpinDialNav";
import type { GalleryActionKind } from "./components/GalleryWorkspace";

const PanelLoading = () => (
  <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 text-sm text-white/60">
    Loading...
  </div>
);

const AnglesPanel = dynamic(() => import("./components/AnglesPanel"), { loading: PanelLoading });
const StoryboardPanel = dynamic(() => import("./components/StoryboardPanel"), { loading: PanelLoading });
const CharactersPanel = dynamic(() => import("./components/CharactersPanel"), { loading: PanelLoading });
const VoicesPanel = dynamic(() => import("./components/VoicesPanel"), { loading: PanelLoading });
const SupportPanel = dynamic(() => import("./components/SupportPanel"), { loading: PanelLoading });
const EditVideoPanel = dynamic(() => import("./components/EditVideoPanel"), { loading: PanelLoading });
const GalleryWorkspace = dynamic(() => import("./components/GalleryWorkspace"), { loading: PanelLoading });

type WorkflowItem = {
  id: string;
  label: string;
  title?: string;
  runtime: string;
};

type WorkflowApiItem = {
  id?: string;
  key?: string;
  slug?: string;
  name?: string;
  label?: string;
  title?: string;
};

type WhoAmIResponse = {
  ok?: boolean;
  authenticated?: boolean;
  username?: string | null;
  user?: {
    admin?: boolean;
    username?: string | null;
    email?: string | null;
    name?: string | null;
  } | null;
};

export type InitialAppUser = {
  username: string | null;
  email: string | null;
  tier: string | null;
  admin: boolean;
} | null;

type GalleryItem = {
  fileName?: string;
  name?: string;
  sourceName?: string;
  url?: string;
  video?: boolean;
  kind?: "image" | "video";
  source?: "user" | "device" | string;
  createdAt?: number;
  updatedAt?: number;
  meta?: {
    favorite?: boolean;
    renamedName?: string | null;
    originalName?: string | null;
    positivePrompt?: string | null;
    negativePrompt?: string | null;
    submitPayload?: Record<string, any> | null;
    workflowId?: string | null;
    workflowTitle?: string | null;
  };
};

type GalleryViewMode = "default" | "grid" | "list";
type AppThemeId = "midnight" | "violet" | "ocean" | "ember" | "forest";
type AppFontScale = "small" | "normal" | "large" | "xl";
type AppUiMode = "clean" | "classic";

type AssistanceTab = "describe" | "enhance" | "scene" | "ask";
type MicTarget = "generate" | "enhance" | "scene" | "ask";
type SceneTransitionMode =
  | "auto"
  | "hard_cut"
  | "same_location_hard_cut"
  | "location_change_cut"
  | "reaction_shot"
  | "reverse_angle"
  | "continue_shot"
  | "flashback_cut";


type SceneReferenceSlotKey = "char1" | "char2" | "char3" | "bg";

type SceneReferenceSlotStatus = "idle" | "running" | "done";

type ProgressResponse = {
  ok?: boolean;
  status?: "idle" | "running" | "complete" | "error" | string;
  running?: boolean;
  queue?: number;
  queue_remaining?: number;
  prompt_id?: string | null;
  file_name?: string | null;
  error?: string | null;
};

type LatestContentResponse = {
  ok?: boolean;
  status?: string;
  file?: {
    name?: string;
    kind?: "image" | "video";
    url?: string;
    sourceName?: string;
  } | null;
};

type PersistedGenerateState = {
  tab?: SpinTabId;
  prompt?: string;
  negativePrompt?: string;
  workflowId?: string;
  orientation?: "portrait" | "landscape";
  durationSeconds?: number;
  uploadedFileName?: string;
  gpuTarget?: string;
  activeGenerateStyleId?: string;
  recentGenerateStyleIds?: string[];
  assistanceTab?: AssistanceTab;
  galleryViewMode?: GalleryViewMode;
  galleryItemsPerPage?: number;
  favoritesItemsPerPage?: number;
};

type GenerateStylePreset = {
  id: string;
  label: string;
  prompt: string;
  composeSuffix?: string;
};

type PromptGuideMode = "image" | "text_to_video" | "image_to_video" | "tutorial_video";

type PromptGuideContent = {
  label: string;
  works: string[];
  avoid: string[];
  example: string;
};

type PromptAssessmentGrade = "F" | "D" | "C" | "B" | "A" | "A+";

type PromptAssessment = {
  grade: PromptAssessmentGrade;
  score: number;
  correct: string[];
  weak: string[];
  missing: string[];
  summary: string;
};

type ImportedCharacterDraft = {
  token: string;
  imagePath: string;
  imageUrl: string;
  imageName: string;
};

type ViewerCollection = "gallery" | "favorites";

type ViewerState = {
  collection: ViewerCollection;
  itemKey: string;
  item: GalleryItem;
};

type EditModalState = {
  item: GalleryItem;
  positivePrompt: string;
  negativePrompt: string;
  enhancing: boolean;
};

type AnimateModalState = {
  item: GalleryItem;
  positivePrompt: string;
  negativePrompt: string;
  durationSeconds: number;
  enhancing: boolean;
};

type ExtendModalState = {
  item: GalleryItem;
  frameUrl: string;
  frameName: string;
  orientation: "portrait" | "landscape";
  positivePrompt: string;
  negativePrompt: string;
  durationSeconds: number;
  enhancing: boolean;
};

const APP_STATE_KEY = "otg:test:page-state:v1";
const APP_THEME_KEY = "otg:test:theme:v1";
const APP_FONT_SCALE_KEY = "otg:test:font-scale:v1";
const APP_UI_MODE_KEY = "otg:test:ui-mode:v1";
const APP_USER_CACHE_KEY = "otg:test:last-user:v1";

type AppThemeOption = {
  id: AppThemeId;
  label: string;
  description: string;
  background: string;
  accent: string;
  accentSoft: string;
  panel: string;
};

const APP_THEME_OPTIONS: AppThemeOption[] = [
  {
    id: "midnight",
    label: "Midnight",
    description: "Default dark blue/purple OTG shell.",
    background: "radial-gradient(circle at top left, rgba(87, 72, 255, 0.18), transparent 34%), radial-gradient(circle at top right, rgba(0, 225, 255, 0.10), transparent 30%), #05060b",
    accent: "#8b5cf6",
    accentSoft: "rgba(139, 92, 246, 0.18)",
    panel: "rgba(0, 0, 0, 0.45)",
  },
  {
    id: "violet",
    label: "Violet Neon",
    description: "Brighter purple/blue control accents.",
    background: "radial-gradient(circle at top left, rgba(168, 85, 247, 0.24), transparent 34%), radial-gradient(circle at bottom right, rgba(56, 189, 248, 0.16), transparent 32%), #070313",
    accent: "#c084fc",
    accentSoft: "rgba(192, 132, 252, 0.20)",
    panel: "rgba(18, 7, 35, 0.60)",
  },
  {
    id: "ocean",
    label: "Ocean Blue",
    description: "Cool cyan/blue app shell.",
    background: "radial-gradient(circle at top left, rgba(14, 165, 233, 0.22), transparent 34%), radial-gradient(circle at bottom right, rgba(45, 212, 191, 0.13), transparent 34%), #031018",
    accent: "#38bdf8",
    accentSoft: "rgba(56, 189, 248, 0.18)",
    panel: "rgba(2, 20, 31, 0.62)",
  },
  {
    id: "ember",
    label: "Ember",
    description: "Warm orange/red accents for higher contrast.",
    background: "radial-gradient(circle at top left, rgba(249, 115, 22, 0.22), transparent 34%), radial-gradient(circle at bottom right, rgba(244, 63, 94, 0.13), transparent 34%), #120704",
    accent: "#fb923c",
    accentSoft: "rgba(251, 146, 60, 0.18)",
    panel: "rgba(31, 10, 4, 0.62)",
  },
  {
    id: "forest",
    label: "Forest",
    description: "Green/teal app shell.",
    background: "radial-gradient(circle at top left, rgba(34, 197, 94, 0.18), transparent 34%), radial-gradient(circle at bottom right, rgba(20, 184, 166, 0.12), transparent 34%), #04110a",
    accent: "#34d399",
    accentSoft: "rgba(52, 211, 153, 0.16)",
    panel: "rgba(3, 24, 13, 0.62)",
  },
];

const APP_FONT_SCALE_OPTIONS: { id: AppFontScale; label: string; rootSize: string; description: string }[] = [
  { id: "small", label: "Small", rootSize: "14px", description: "More content on screen." },
  { id: "normal", label: "Normal", rootSize: "16px", description: "Default app sizing." },
  { id: "large", label: "Large", rootSize: "18px", description: "Larger text and controls." },
  { id: "xl", label: "Extra large", rootSize: "20px", description: "Maximum readable UI size." },
];

const APP_UI_MODE_OPTIONS: { id: AppUiMode; label: string; description: string }[] = [
  { id: "clean", label: "Clean", description: "Minimal shell, tighter panels, calmer navigation." },
  { id: "classic", label: "Classic", description: "Original neon shell and full visual treatment." },
];

const APP_TAB_LABELS: Record<SpinTabId, string> = {
  gethelp: "AI Assistance",
  generate: "Generate",
  angles: "Angles",
  storyboard: "Production",
  characters: "Characters",
  gallery: "Gallery",
  voices: "Voices",
  favorites: "Favorites",
  editvideo: "Edit Video",
  settings: "Settings",
  support: "Support",
};

const WORKFLOW_FALLBACKS: WorkflowItem[] = [
  { id: "create-picture", label: "Create a Picture", runtime: "Estimated runtime: about 20 to 60 seconds." },
  { id: "animate-image", label: "Animate an Image", runtime: "Estimated runtime: about 2 to 6 minutes." },
  { id: "presets/Edit Image", label: "Edit Image", runtime: "Estimated runtime: about 30 to 90 seconds." },
  { id: "skyreels-v3", label: "SkyReels V3", runtime: "Estimated runtime: about 3 to 10 minutes." },
];

const GALLERY_EDIT_WORKFLOW_ID = "presets/Edit Pictures";
const GALLERY_ANIMATE_WORKFLOW_ID = "presets/Create a Video from Pictures";
const ITEMS_PER_PAGE_OPTIONS = [5, 10, 25, 50, 100, 0] as const;
const GENERATE_DURATION_OPTIONS = [5, 10, 15] as const;
const GENERATE_STYLE_PRESETS: GenerateStylePreset[] = [
  { id: "anime", label: "Anime", prompt: "anime illustration, polished anime style, expressive character design, clean line art, vibrant cinematic shading" },
  { id: "cartoon", label: "Cartoon", prompt: "cartoon illustration, clean stylized shapes, expressive character design, appealing colors, polished cartoon rendering" },
  { id: "pixar3d", label: "3D Pixar", prompt: "3D animated feature style, pixar-inspired character design, stylized materials, expressive eyes, cinematic family-film lighting" },
  {
    id: "cinematic",
    label: "Cinematic",
    prompt:
      "cinematic visual style, movie-grade composition, dramatic motivated lighting, filmic contrast, layered depth, atmospheric perspective, premium color grading, immersive scene mood",
    composeSuffix:
      "strong foreground-midground-background separation, controlled highlights, rich shadows, dramatic atmosphere, high-end movie look, no flat lighting",
  },
  { id: "photoreal", label: "Photorealistic", prompt: "photorealistic, highly detailed, natural skin texture, physically accurate lighting, realistic camera rendering" },
  {
    id: "professional",
    label: "Professional 4K",
    prompt:
      "4K professional commercial quality, ultra-detailed subject rendering, razor-sharp clarity, premium production lighting, refined textures, clean luxury presentation, polished high-end finish",
    composeSuffix:
      "crisp detail, accurate materials, controlled contrast, premium retouch quality, clean professional composition, refined commercial-grade output",
  },
  { id: "comic", label: "Comic Book", prompt: "comic book illustration, bold inked outlines, graphic shading, dynamic composition, illustrated panel energy" },
  { id: "vintage", label: "Vintage Film", prompt: "vintage film look, retro color grading, soft cinematic grain, nostalgic atmosphere, timeless composition" },
  { id: "blackwhite", label: "Black and White", prompt: "black and white, monochrome image, rich tonal contrast, dramatic lighting, classic grayscale photography" },
  { id: "manga", label: "Manga", prompt: "manga style, refined black ink line work, manga screentone influence, expressive composition, stylized Japanese comic aesthetic" },
];

const PROMPT_TUTORIAL_VIDEO_URL = "https://www.youtube.com/watch?v=2hB-JsdF6ns";
const PROMPT_TUTORIAL_VIDEO_EMBED_URL = "https://www.youtube.com/embed/2hB-JsdF6ns?rel=0";

function buildGenerateStyleGuidance(stylePreset?: GenerateStylePreset | null) {
  return [String(stylePreset?.prompt || "").trim(), String(stylePreset?.composeSuffix || "").trim()]
    .filter(Boolean)
    .join(", ");
}

function composeGeneratePromptWithStyle(bodyPrompt: string, stylePreset?: GenerateStylePreset | null) {
  const sections = [
    String(stylePreset?.prompt || "").trim(),
    String(bodyPrompt || "").trim(),
    String(stylePreset?.composeSuffix || "").trim(),
  ].filter(Boolean);

  const uniqueSections: string[] = [];
  for (const section of sections) {
    const normalized = section.toLowerCase();
    if (!uniqueSections.some((existing) => existing.toLowerCase() === normalized)) {
      uniqueSections.push(section);
    }
  }

  return uniqueSections.join("\n\n");
}

const PROMPT_GUIDES: Record<PromptGuideMode, PromptGuideContent> = {
  image: {
    label: "Image",
    works: [
      "State the subject, setting, lighting, and mood clearly.",
      "Use specific visual details such as wardrobe, materials, texture, and framing.",
      "Keep one clean style direction instead of mixing unrelated styles.",
    ],
    avoid: [
      "Vague filler like nice, cool, amazing, or good quality.",
      "Stacking multiple unrelated styles into one prompt.",
      "Short keyword soup with no scene description.",
    ],
    example:
      "A photorealistic portrait of a confident woman standing in a small independent coffee shop at sunrise, soft warm window light across her face, shallow depth of field, ceramic cup in hand, detailed skin texture, natural hair strands, polished editorial photography, clean modern composition.",
  },
  text_to_video: {
    label: "Text-to-Video",
    works: [
      "Write one flowing present-tense paragraph with a clear beginning, middle, and end.",
      "Include subject, environment, action, camera movement, lighting, and sound.",
      "Describe what changes over time instead of only describing a still frame.",
    ],
    avoid: [
      "Static image-only wording with no motion or camera behavior.",
      "Too many unrelated actions for a short clip.",
      "Missing dialogue punctuation or unclear speaker changes.",
    ],
    example:
      "A medium shot opens in a quiet coffee shop with warm morning light pouring through the windows and soft cafe ambience in the background. A woman in a cream sweater stands at the counter holding a ceramic mug while steam rises into the air. She lifts the cup, takes a sip, smiles with relief, then gently places the mug down on the wooden counter. The camera slowly pushes in as she glances to the side and says clearly, \"This is good coffee.\" Low cafe chatter and soft ceramic contact on wood support the moment.",
  },
  image_to_video: {
    label: "Image-to-Video",
    works: [
      "Treat the uploaded image as the starting frame and describe only what happens next.",
      "Focus on motion, camera movement, atmosphere change, and short spoken dialogue if needed.",
      "Preserve the visible identity, clothing, lighting, framing, and environment from the source image.",
    ],
    avoid: [
      "Repeating the full still image description word for word.",
      "Static wording with no motion verbs.",
      "Conflicting camera moves or impossible action changes.",
    ],
    example:
      "She breathes nervously and slowly turns her head to the left, then to the right, scanning the room in growing fear while the camera creeps closer to her face. Her eyes widen, her shoulders tense, and she quietly says, \"Hello?\" A distorted male voice crackles from an off-screen loudspeaker as ominous suspense music rises underneath the scene.",
  },
  tutorial_video: {
    label: "Tutorial Video",
    works: [
      "Watch the video for a practical LTX 2.3 prompt breakdown.",
      "Use it when you want a real example of how to structure a better video prompt.",
      "Return here after watching and rewrite your prompt with clearer motion, camera, and sound details.",
    ],
    avoid: [
      "Skipping the video if you are unsure how to structure a scene.",
      "Copying random keywords without understanding shot flow and motion.",
      "Treating image-to-video and text-to-video as the same type of prompt.",
    ],
    example: "Watch the tutorial video below, then rewrite your prompt using clearer subject action, camera movement, environment, and dialogue.",
  },
};

const GPU_OPTIONS = [
  { value: "3090", label: "RTX 3090" },
  { value: "5060ti", label: "RTX 5060 Ti" },
  { value: "3060ti", label: "RTX 3060 Ti" },
];

const SCENE_TRANSITION_OPTIONS: Array<{ mode: Exclude<SceneTransitionMode, "auto">; label: string; helper: string }> = [
  {
    mode: "hard_cut",
    label: "Hard Cut",
    helper: "Change framing and composition for the next beat while preserving continuity.",
  },
  {
    mode: "same_location_hard_cut",
    label: "Same Location Hard Cut",
    helper: "Stay in the same environment and lighting logic, but shift to a distinct new composition and beat.",
  },
  {
    mode: "location_change_cut",
    label: "Location Change Cut",
    helper: "Move to a new environment while preserving character identity, wardrobe logic, and narrative continuity.",
  },
  {
    mode: "reaction_shot",
    label: "Reaction Shot",
    helper: "Center the responding character while preserving scene geography, eyelines, and continuity.",
  },
  {
    mode: "reverse_angle",
    label: "Reverse Angle",
    helper: "Flip perspective to the opposite side of the same exchange while keeping scene geography intact.",
  },
  {
    mode: "continue_shot",
    label: "Continue Shot",
    helper: "Continue the same active moment without making it feel like a disconnected new scene.",
  },
  {
    mode: "flashback_cut",
    label: "Flashback / Memory Cut",
    helper: "Shift to an earlier remembered beat while preserving identity and church-world or story-world continuity.",
  },
];

const SCENE_REFERENCE_SLOT_OPTIONS: Array<{ key: SceneReferenceSlotKey; label: string; kind: "character" | "background" }> = [
  { key: "char1", label: "Character 1", kind: "character" },
  { key: "char2", label: "Character 2", kind: "character" },
  { key: "char3", label: "Character 3", kind: "character" },
  { key: "bg", label: "Background", kind: "background" },
];

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function randomSeed() {
  return Math.floor(Math.random() * 2147483647) + 1;
}

function makeExtendRequestId() {
  return `gx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildGalleryExtendTitle(name?: string) {
  const base = String(name || "video")
    .split(/[\\/]+/)
    .pop()
    ?.replace(/\.[^.]+$/, "") || "video";
  const safe = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "video";
  return `gallery-extend-${safe}`;
}

function preferredImageMimeTypeFromName(name?: string) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

function looksLikeVideoWorkflow(value?: string) {
  const lower = String(value || "").toLowerCase();
  return lower.includes("video") || lower.includes("ltx") || lower.includes("animate") || lower.includes("skyreels") || lower.includes("wan");
}

function inferPromptGuideMode(workflow: WorkflowItem | undefined): PromptGuideMode {
  const haystack = `${String(workflow?.id || "")} ${String(workflow?.label || "")}`.toLowerCase();
  if (
    haystack.includes("starter image") ||
    haystack.includes("from image") ||
    haystack.includes("from picture") ||
    haystack.includes("from pictures") ||
    haystack.includes("animate")
  ) {
    return "image_to_video";
  }
  if (haystack.includes("video") || haystack.includes("ltx") || haystack.includes("skyreels") || haystack.includes("wan")) {
    return "text_to_video";
  }
  return "image";
}


const SUBJECT_TERMS = [
  "woman",
  "man",
  "girl",
  "boy",
  "person",
  "subject",
  "character",
  "speaker",
  "bird",
  "creature",
  "figure",
  "face",
  "she",
  "he",
  "they",
];
const ENVIRONMENT_TERMS = [
  "room",
  "hallway",
  "corridor",
  "corner",
  "wall",
  "window",
  "street",
  "forest",
  "office",
  "kitchen",
  "bedroom",
  "warehouse",
  "church",
  "coffee shop",
  "cafe",
  "interior",
  "exterior",
  "outside",
  "inside",
];
const MOTION_TERMS = [
  "turn",
  "turns",
  "walk",
  "walks",
  "run",
  "runs",
  "look",
  "looks",
  "glance",
  "glances",
  "breathes",
  "breathe",
  "raises",
  "lowers",
  "moves",
  "steps",
  "leans",
  "recoils",
  "freezes",
  "searches",
  "scans",
  "pushes",
  "zooms",
];
const CAMERA_TERMS = [
  "camera",
  "close-up",
  "close up",
  "medium shot",
  "wide shot",
  "push-in",
  "push in",
  "zoom",
  "zooms",
  "pan",
  "tilt",
  "tracking",
  "dolly",
  "hard cut",
  "cut to",
];
const AUDIO_TERMS = [
  "music",
  "sound",
  "voice",
  "speaker",
  "static",
  "ambience",
  "ambience",
  "room tone",
  "whisper",
  "speaks",
  "says",
  "crackles",
  "silence",
];
const DIALOGUE_TERMS = ["says", "asks", "whispers", "replies", "speaks", "shouts", "murmurs"];
const CONTINUITY_TERMS = [
  "same",
  "continue",
  "continues",
  "preserve",
  "matching",
  "still wearing",
  "same room",
  "same lighting",
  "same outfit",
  "same face",
  "without breaking continuity",
];
const STYLE_CONFLICT_GROUPS = [
  ["anime", "photorealistic", "realistic", "comic", "manga", "cartoon"],
  ["black and white", "vibrant color", "colorful"],
];

function hasAnyTerm(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function countTermHits(text: string, terms: string[]) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function derivePromptAssessmentGrade(score: number): PromptAssessmentGrade {
  if (score >= 95) return "A+";
  if (score >= 88) return "A";
  if (score >= 76) return "B";
  if (score >= 62) return "C";
  if (score >= 45) return "D";
  return "F";
}

function buildPromptAssessment(args: {
  prompt: string;
  mode: PromptGuideMode;
  hasStarterImage: boolean;
  starterImageMeta: { width: number; height: number } | null;
  styleLabel: string;
}): PromptAssessment {
  const rawPrompt = String(args.prompt || "").trim();
  const text = rawPrompt.toLowerCase();
  const correct: string[] = [];
  const weak: string[] = [];
  const missing: string[] = [];
  let score = 0;

  const subjectHits = countTermHits(text, SUBJECT_TERMS);
  if (subjectHits >= 1) {
    correct.push("The subject is identifiable.");
    score += 12;
  } else {
    missing.push("Add a clear subject so LTX knows who or what the scene follows.");
  }

  const environmentHits = countTermHits(text, ENVIRONMENT_TERMS);
  if (environmentHits >= 2) {
    correct.push("The environment is described clearly enough to stage the scene.");
    score += 12;
  } else if (environmentHits === 1) {
    weak.push("The environment is present, but it needs more detail about where the scene is happening.");
    score += 6;
  } else {
    missing.push("Add environment detail such as room, location, or scene geography.");
  }

  const motionHits = countTermHits(text, MOTION_TERMS);
  if (motionHits >= 3) {
    correct.push("The prompt has clear motion and action beats.");
    score += 18;
  } else if (motionHits >= 1) {
    weak.push("Motion is present, but the sequence needs clearer action progression.");
    score += 9;
  } else {
    missing.push("Add motion so LTX knows what changes over time.");
  }

  const cameraHits = countTermHits(text, CAMERA_TERMS);
  if (cameraHits >= 1) {
    correct.push("Camera direction is present.");
    score += 14;
  } else {
    missing.push("Add camera language such as close-up, push-in, hard cut, pan, or tracking.");
  }

  const hasDialogue = /["\u201C\u201D']/.test(rawPrompt) || hasAnyTerm(text, DIALOGUE_TERMS);
  if (hasDialogue) {
    correct.push("Dialogue or speaker direction is present.");
    score += 10;
  } else {
    weak.push("Dialogue is optional, but adding a short spoken line can help anchor timing and tension.");
    score += 4;
  }

  const audioHits = countTermHits(text, AUDIO_TERMS);
  if (audioHits >= 2) {
    correct.push("Audio cues are helping the scene feel cinematic.");
    score += 10;
  } else if (audioHits === 1) {
    weak.push("Audio is mentioned, but room tone, music, or voice texture could be clearer.");
    score += 5;
  } else {
    weak.push("Add sound detail such as music, room tone, speaker distortion, or ambience.");
  }

  const sequenceHits = countTermHits(text, ["then", "suddenly", "after", "before", "hard cut", "cut to", "while"]);
  if (sequenceHits >= 2) {
    correct.push("The scene has a readable beginning-to-middle-to-end flow.");
    score += 12;
  } else {
    weak.push("The scene beats are present, but the order of actions could be clearer.");
    score += 6;
  }

  if (args.styleLabel) {
    correct.push(`The ${args.styleLabel} preset gives the scene a clear style direction.`);
    score += 6;
  }

  let conflictCount = 0;
  for (const group of STYLE_CONFLICT_GROUPS) {
    if (countTermHits(text, group) >= 2) conflictCount += 1;
  }
  if (conflictCount > 0) {
    weak.push("The prompt mixes style directions that may fight each other.");
    score -= 6;
  }

  if (args.mode === "image_to_video") {
    if (args.hasStarterImage) {
      correct.push("A starter image is uploaded, so LTX has a visual anchor for identity, framing, and lighting.");
      score += 8;
      if (args.starterImageMeta) {
        const orientation = args.starterImageMeta.height > args.starterImageMeta.width ? "portrait" : "landscape";
        correct.push(`Starter image framing is ${orientation}, which gives the scene a clear visual starting point.`);
        score += 4;
      }
    } else {
      missing.push("Upload a starter image so image-to-video has a real visual starting point.");
    }

    const continuityHits = countTermHits(text, CONTINUITY_TERMS);
    if (continuityHits >= 1) {
      correct.push("The prompt hints at continuity with the existing shot.");
      score += 8;
    } else {
      weak.push("Add a continuity cue so the next motion feels connected to what is already visible in the starter image.");
      score += 4;
    }
  }

  score = Math.max(0, Math.min(100, score));
  const grade = derivePromptAssessmentGrade(score);

  let summary = "The prompt needs more scene structure before it will guide LTX well.";
  if (grade === "A+" || grade === "A") {
    summary = "This prompt is strong for LTX 2.3 and already reads like a clear cinematic scene.";
  } else if (grade === "B") {
    summary = "This prompt is usable, but tightening the weak areas would make the scene more reliable.";
  } else if (grade === "C") {
    summary = "This prompt has a workable core, but it still needs stronger camera, motion, or environment detail.";
  } else if (grade === "D") {
    summary = "This prompt has some useful pieces, but several important LTX scene elements are still weak or missing.";
  }

  return { grade, score, correct, weak, missing, summary };
}

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm md:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/78">{title}</h2>
        {right}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function PillButton({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-12 items-center justify-center rounded-full border px-4 py-3 text-sm font-semibold text-white transition",
        active
          ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))] shadow-[0_0_24px_rgba(90,160,255,0.18)]"
          : "border-white/10 bg-white/5 hover:bg-white/10"
      )}
    >
      {children}
    </button>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.35),rgba(40,200,255,0.28))] px-5 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 11.5a6 6 0 0 1-12 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17.5V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M4 7h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 4h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 11v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function getGalleryItemKey(item: GalleryItem) {
  return String(item.fileName || item.name || item.sourceName || item.meta?.renamedName || item.meta?.originalName || "").trim();
}


function readGalleryImageDimensionsFromBlob(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      URL.revokeObjectURL(objectUrl);
      if (!width || !height) {
        reject(new Error("Could not read gallery image dimensions."));
        return;
      }
      resolve({ width, height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not inspect gallery image."));
    };
    img.src = objectUrl;
  });
}

function isSupportedCharacterGalleryImage(name: string, item: GalleryItem) {
  const lowered = String(name || "").toLowerCase();
  if (item.video || item.kind === "video") return false;
  return /\.(png|jpg|jpeg|webp)$/i.test(lowered);
}

function galleryOriginalFileUrl(item: GalleryItem) {
  const name = getGalleryItemKey(item);
  if (!name) return "";
  const params = new URLSearchParams({
    name,
    scope: String(item.source || "user"),
  });
  return `/api/gallery/file?${params.toString()}`;
}


function readPersistedState(): PersistedGenerateState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(APP_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PersistedGenerateState) : null;
  } catch {
    return null;
  }
}

function clampDuration(value: number) {
  if (!Number.isFinite(value)) return 8;
  return Math.max(5, Math.min(15, Math.round(value)));
}

function clampGenerateDuration(value: number) {
  if (!Number.isFinite(value)) return 10;
  const num = Math.max(5, Math.min(60, Math.round(value)));
  let best: (typeof GENERATE_DURATION_OPTIONS)[number] = GENERATE_DURATION_OPTIONS[0];
  let bestDelta = Math.abs(num - best);
  for (const option of GENERATE_DURATION_OPTIONS) {
    const delta = Math.abs(num - option);
    if (delta < bestDelta) {
      best = option;
      bestDelta = delta;
    }
  }
  return best;
}

function guessRuntime(id: string, label: string) {
  const haystack = `${id} ${label}`.toLowerCase();
  if (haystack.includes("skyreels") || haystack.includes("video")) return "Estimated runtime: about 3 to 10 minutes.";
  if (haystack.includes("ltx") || haystack.includes("animate")) return "Estimated runtime: about 2 to 6 minutes.";
  if (haystack.includes("edit")) return "Estimated runtime: about 30 to 90 seconds.";
  return "Estimated runtime: about 20 to 60 seconds.";
}

function shouldSendSizeOverride(workflow: WorkflowItem | undefined) {
  const id = String(workflow?.id || "").toLowerCase();
  const label = String(workflow?.label || "").toLowerCase();
  return (
    label.includes("create image") ||
    label.includes("create a picture") ||
    label.includes("edit image") ||
    label.includes("edit picture") ||
    label.includes("edit a picture") ||
    id.includes("create-picture") ||
    id.includes("text_to_image") ||
    id.includes("image_edit")
  );
}

function normalizeGalleryItem(raw: any): GalleryItem {
  const fileName = raw?.fileName || raw?.name || raw?.sourceName || "";
  const displayName = raw?.displayName || raw?.renamedName || raw?.meta?.renamedName || raw?.name || raw?.sourceName || fileName || "";

  return {
    fileName,
    name: displayName,
    sourceName: raw?.sourceName || fileName || "",
    url: raw?.url || "",
    video: Boolean(raw?.video || raw?.kind === "video"),
    kind: raw?.kind === "video" ? "video" : "image",
    source: raw?.source || raw?.scope || "user",
    createdAt: Number(raw?.createdAt || raw?.ts || 0) || undefined,
    updatedAt: Number(raw?.updatedAt || 0) || undefined,
    meta: {
      favorite: Boolean(raw?.meta?.favorite ?? raw?.favorite),
      renamedName: raw?.meta?.renamedName ?? null,
      originalName: raw?.meta?.originalName ?? raw?.sourceName ?? raw?.name ?? null,
      positivePrompt: raw?.meta?.positivePrompt ?? null,
      negativePrompt: raw?.meta?.negativePrompt ?? null,
      submitPayload: raw?.meta?.submitPayload ?? null,
      workflowId: raw?.meta?.workflowId ?? null,
      workflowTitle: raw?.meta?.workflowTitle ?? null,
    },
  };
}

function readCachedUsername() {
  if (typeof window === "undefined") return "Guest";
  try {
    const raw = window.localStorage.getItem(APP_USER_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    const name = typeof cached?.username === "string" ? cached.username.trim() : "";
    return name || "Guest";
  } catch {
    return "Guest";
  }
}

function writeCachedUsername(username: string) {
  if (typeof window === "undefined") return;
  const name = username.trim();
  try {
    if (!name || name === "Guest") {
      window.localStorage.removeItem(APP_USER_CACHE_KEY);
      return;
    }
    window.localStorage.setItem(APP_USER_CACHE_KEY, JSON.stringify({ username: name, updatedAt: Date.now() }));
  } catch {
    // ignore storage failures
  }
}

async function fetchWhoAmI() {
  const res = await fetch("/api/whoami", {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) {
    const error = new Error("Session lookup failed") as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return (await res.json()) as WhoAmIResponse;
}

async function fetchWorkflowsForApp() {
  const res = await fetch("/api/workflows", {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Workflow lookup failed");

  const data = await res.json();
  const list = Array.isArray(data) ? data : Array.isArray(data?.workflows) ? data.workflows : [];

  return list
    .map((item: WorkflowApiItem, index: number) => {
      const rawId = item?.id || item?.key || item?.slug || `workflow-${index + 1}`;
      const rawLabel = item?.label || item?.name || item?.title || rawId;
      return {
        id: String(rawId),
        label: String(rawLabel),
        title: item?.title ? String(item.title) : String(rawLabel),
        runtime: guessRuntime(String(rawId), String(rawLabel)),
      } satisfies WorkflowItem;
    })
    .filter((item: WorkflowItem) => item.id && item.label);
}

export default function AppPageClient({ initialUser = null }: { initialUser?: InitialAppUser }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SpinTabId>("generate");
  const [assistanceTab, setAssistanceTab] = useState<AssistanceTab>("describe");
  const [username, setUsername] = useState(() => initialUser?.username || initialUser?.email || readCachedUsername());
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [isAdmin, setIsAdmin] = useState(Boolean(initialUser?.admin));

  const [workflows, setWorkflows] = useState<WorkflowItem[]>(WORKFLOW_FALLBACKS);
  const [workflowId, setWorkflowId] = useState(WORKFLOW_FALLBACKS[0].id);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [promptRelayBeat1, setPromptRelayBeat1] = useState("");
  const [promptRelayBeat2, setPromptRelayBeat2] = useState("");
  const [promptRelayBeat3, setPromptRelayBeat3] = useState("");
  const [promptRelayBeat4, setPromptRelayBeat4] = useState("");
  const [promptUndoStack, setPromptUndoStack] = useState<string[]>([]);
  const [negativePromptUndoStack, setNegativePromptUndoStack] = useState<string[]>([]);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [durationSeconds, setDurationSeconds] = useState(10);
  const [activeGenerateStyleId, setActiveGenerateStyleId] = useState("");
  const [recentGenerateStyleIds, setRecentGenerateStyleIds] = useState<string[]>([]);
  const [promptGuideOpen, setPromptGuideOpen] = useState(false);
  const [promptGuideMode, setPromptGuideMode] = useState<PromptGuideMode>("image");
  const [uploadedFileName, setUploadedFileName] = useState("");
  // OTG_CUSTOM_AUDIO_GENERATE: audio file state for Generate custom-audio I2V.
  const [customAudioFileName, setCustomAudioFileName] = useState("");
  const [customAudioPreviewUrl, setCustomAudioPreviewUrl] = useState("");
  const [uploadedImagePreviewUrl, setUploadedImagePreviewUrl] = useState("");
  const [lastFrameFileName, setLastFrameFileName] = useState("");
  const [lastFramePreviewUrl, setLastFramePreviewUrl] = useState("");
  const [lastFrameImageMeta, setLastFrameImageMeta] = useState<{ width: number; height: number } | null>(null);
  const [uploadedInputIsVideo, setUploadedInputIsVideo] = useState(false);
  const [uploadedImageMeta, setUploadedImageMeta] = useState<{ width: number; height: number } | null>(null);
  const [generateGalleryPickerOpen, setGenerateGalleryPickerOpen] = useState(false);
  const [generateGalleryItems, setGenerateGalleryItems] = useState<GalleryItem[]>([]);
  const [generateGalleryLoading, setGenerateGalleryLoading] = useState(false);
  const [generateGalleryError, setGenerateGalleryError] = useState("");
  const [generateGallerySelecting, setGenerateGallerySelecting] = useState("");
  const [createCharacterBusy, setCreateCharacterBusy] = useState(false);
  const [characterImportDraft, setCharacterImportDraft] = useState<ImportedCharacterDraft | null>(null);
  const [gpuTarget, setGpuTarget] = useState(GPU_OPTIONS[0].value);
  const [enhancing, setEnhancing] = useState(false);
  const [formattingPrompt, setFormattingPrompt] = useState(false);
  const [promptAssessmentOpen, setPromptAssessmentOpen] = useState(false);
  const [promptAssessment, setPromptAssessment] = useState<PromptAssessment | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<MicTarget | "">("");
  const [transcribingTarget, setTranscribingTarget] = useState<MicTarget | "">("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [settingsComfyBusy, setSettingsComfyBusy] = useState(false);
  const [settingsComfyBaseUrl, setSettingsComfyBaseUrl] = useState("");
  const [settingsComfyCheckedAt, setSettingsComfyCheckedAt] = useState("");
  const [settingsPipelineBusy, setSettingsPipelineBusy] = useState(false);
  const [settingsPipelineMessage, setSettingsPipelineMessage] = useState("");
  const [settingsLocalMessage, setSettingsLocalMessage] = useState("");
  const [appThemeId, setAppThemeId] = useState<AppThemeId>("midnight");
  const [appFontScale, setAppFontScale] = useState<AppFontScale>("normal");
  const [appUiMode, setAppUiMode] = useState<AppUiMode>("clean");
  const [settingsAppearanceMessage, setSettingsAppearanceMessage] = useState("");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNew, setPasswordNew] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [deleteAccountMessage, setDeleteAccountMessage] = useState("");

  const [generateBusy, setGenerateBusy] = useState(false);
  const [progressStatus, setProgressStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [progressQueue, setProgressQueue] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [activePromptId, setActivePromptId] = useState("");
  const [latestPreviewUrl, setLatestPreviewUrl] = useState("");
  const [latestPreviewName, setLatestPreviewName] = useState("");
  const [latestPreviewKind, setLatestPreviewKind] = useState<"image" | "video" | "">("");
  const [latestPreviewMeta, setLatestPreviewMeta] = useState<{ width: number; height: number } | null>(null);
  const latestPreviewIdentityRef = useRef("");
  const selectedAppTheme = APP_THEME_OPTIONS.find((theme) => theme.id === appThemeId) || APP_THEME_OPTIONS[0];
  const selectedFontScale = APP_FONT_SCALE_OPTIONS.find((option) => option.id === appFontScale) || APP_FONT_SCALE_OPTIONS[1];

  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<GalleryItem[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryForcePullBusy, setGalleryForcePullBusy] = useState(false);
  const [favoritesBusy, setFavoritesBusy] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<"all" | "images" | "videos">("all");
  const [gallerySort, setGallerySort] = useState<"newest" | "oldest" | "name">("newest");
  const [galleryViewMode, setGalleryViewMode] = useState<GalleryViewMode>("default");
  const [favoritesFilter, setFavoritesFilter] = useState<"all" | "images" | "videos">("all");
  const [favoritesSort, setFavoritesSort] = useState<"newest" | "oldest" | "name">("newest");
  const [favoritesViewMode, setFavoritesViewMode] = useState<GalleryViewMode>("default");
  const [favoritesSearch, setFavoritesSearch] = useState("");
  const deferredFavoritesSearch = useDeferredValue(favoritesSearch);
  const favoritesSearchQuery = useMemo(() => deferredFavoritesSearch.trim().toLowerCase(), [deferredFavoritesSearch]);
  const [galleryItemsPerPage, setGalleryItemsPerPage] = useState<number>(25);
  const [favoritesItemsPerPage, setFavoritesItemsPerPage] = useState<number>(25);
  const [galleryPage, setGalleryPage] = useState(1);
  const [favoritesPage, setFavoritesPage] = useState(1);
  const [gallerySearch, setGallerySearch] = useState("");
  const deferredGallerySearch = useDeferredValue(gallerySearch);
  const gallerySearchQuery = useMemo(() => deferredGallerySearch.trim(), [deferredGallerySearch]);
  const [galleryActionBusyName, setGalleryActionBusyName] = useState("");
  const [galleryActionBusyKind, setGalleryActionBusyKind] = useState<GalleryActionKind>("");
  const [viewerState, setViewerState] = useState<ViewerState | null>(null);
  const viewerTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [animateModal, setAnimateModal] = useState<AnimateModalState | null>(null);
  const [extendModal, setExtendModal] = useState<ExtendModalState | null>(null);
  const galleryAbortRef = useRef<AbortController | null>(null);
  const favoritesAbortRef = useRef<AbortController | null>(null);
  const galleryRequestSeqRef = useRef(0);
  const favoritesRequestSeqRef = useRef(0);

  const whoamiQuery = useQuery({
    queryKey: ["otg", "whoami"],
    queryFn: fetchWhoAmI,
    staleTime: 5 * 60_000,
    initialData: initialUser
      ? {
          ok: true,
          authenticated: true,
          username: initialUser.username,
          user: {
            admin: initialUser.admin,
            username: initialUser.username,
            email: initialUser.email,
          },
        }
      : undefined,
  });

  const workflowsQuery = useQuery({
    queryKey: ["otg", "workflows"],
    queryFn: fetchWorkflowsForApp,
    staleTime: 5 * 60_000,
  });

  const [describeMode, setDescribeMode] = useState<"background" | "identity">("background");
  const [describeImageName, setDescribeImageName] = useState("");
  const [describePreviewUrl, setDescribePreviewUrl] = useState("");
  const [describeOutput, setDescribeOutput] = useState("");
  const [describeBusy, setDescribeBusy] = useState(false);

  const [enhanceDraft, setEnhanceDraft] = useState("");
  const [enhanceLength, setEnhanceLength] = useState<"short" | "normal" | "long">("normal");
  const [enhanceImageFile, setEnhanceImageFile] = useState<File | null>(null);
  const [enhanceImageName, setEnhanceImageName] = useState("");
  const [enhanceImagePreviewUrl, setEnhanceImagePreviewUrl] = useState("");
  const [enhanceImageInputKey, setEnhanceImageInputKey] = useState(0);
  const [enhanceDraftBusy, setEnhanceDraftBusy] = useState(false);
  const [sceneDraft, setSceneDraft] = useState("");
  const [sceneOutput, setSceneOutput] = useState("");
  const [sceneCount, setSceneCount] = useState(5);
  const [sceneSeconds, setSceneSeconds] = useState(8);
  const [sceneStyle, setSceneStyle] = useState("realistic cinematic");
  const [sceneFormat, setSceneFormat] = useState<"scene_card" | "next_scenes">("scene_card");
  const [scenePlan, setScenePlan] = useState<Record<string, any> | null>(null);
  const [scenePlanBusy, setScenePlanBusy] = useState(false);
  const [sceneWriteBusy, setSceneWriteBusy] = useState(false);
  const [sceneReferenceCard, setSceneReferenceCard] = useState("");
  const [sceneTutorialOpen, setSceneTutorialOpen] = useState(false);
  const [sceneTutorialImageOpen, setSceneTutorialImageOpen] = useState("");
  const [sceneTutorialImageLabel, setSceneTutorialImageLabel] = useState("");
  const [sceneTutorialExampleKey, setSceneTutorialExampleKey] = useState<"example1" | "example2" | "">("");
  const [sceneTutorialDraft, setSceneTutorialDraft] = useState("");
  const [sceneChar1File, setSceneChar1File] = useState<File | null>(null);
  const [sceneChar2File, setSceneChar2File] = useState<File | null>(null);
  const [sceneChar3File, setSceneChar3File] = useState<File | null>(null);
  const [sceneBgFile, setSceneBgFile] = useState<File | null>(null);
  const [sceneChar1Name, setSceneChar1Name] = useState("");
  const [sceneChar2Name, setSceneChar2Name] = useState("");
  const [sceneChar3Name, setSceneChar3Name] = useState("");
  const [sceneBgName, setSceneBgName] = useState("");
  const [sceneChar1PreviewUrl, setSceneChar1PreviewUrl] = useState("");
  const [sceneChar2PreviewUrl, setSceneChar2PreviewUrl] = useState("");
  const [sceneChar3PreviewUrl, setSceneChar3PreviewUrl] = useState("");
  const [sceneBgPreviewUrl, setSceneBgPreviewUrl] = useState("");
  const [sceneChar1InputKey, setSceneChar1InputKey] = useState(0);
  const [sceneChar2InputKey, setSceneChar2InputKey] = useState(0);
  const [sceneChar3InputKey, setSceneChar3InputKey] = useState(0);
  const [sceneBgInputKey, setSceneBgInputKey] = useState(0);
  const [scenePreviewModalUrl, setScenePreviewModalUrl] = useState("");
  const [scenePreviewModalLabel, setScenePreviewModalLabel] = useState("");
  const [sceneVisionSummary, setSceneVisionSummary] = useState("");
  const [sceneReferencePickerOpen, setSceneReferencePickerOpen] = useState(false);
  const [sceneReferenceBusySlot, setSceneReferenceBusySlot] = useState<SceneReferenceSlotKey | "">("");
  const [sceneReferenceAnalyses, setSceneReferenceAnalyses] = useState<Record<SceneReferenceSlotKey, string>>({
    char1: "",
    char2: "",
    char3: "",
    bg: "",
  });
  const [sceneReferenceStatuses, setSceneReferenceStatuses] = useState<Record<SceneReferenceSlotKey, SceneReferenceSlotStatus>>({
    char1: "idle",
    char2: "idle",
    char3: "idle",
    bg: "idle",
  });
  const [sceneTransitionMode, setSceneTransitionMode] = useState<SceneTransitionMode>("auto");
  const [sceneTransitionPickerOpen, setSceneTransitionPickerOpen] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [askImageName, setAskImageName] = useState("");
  const [askImagePreviewUrl, setAskImagePreviewUrl] = useState("");

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const customAudioInputRef = useRef<HTMLInputElement | null>(null);
  const lastFrameInputRef = useRef<HTMLInputElement | null>(null);
  const describeInputRef = useRef<HTMLInputElement | null>(null);
  const askImageInputRef = useRef<HTMLInputElement | null>(null);
  const uploadedFileRef = useRef<File | null>(null);
  const customAudioFileRef = useRef<File | null>(null);
  const lastFrameFileRef = useRef<File | null>(null);
  const describeFileRef = useRef<File | null>(null);
  const askImageRef = useRef<File | null>(null);
  const refreshedCompletePromptRef = useRef("");
  const inputImageUrlRef = useRef<string | null>(null);
  const customAudioUrlRef = useRef<string | null>(null);
  const lastFrameUrlRef = useRef<string | null>(null);
  const describePreviewUrlRef = useRef<string | null>(null);
  const askPreviewUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const selectedWorkflow = useMemo(() => {
    return workflows.find((workflow) => workflow.id === workflowId) || workflows[0] || WORKFLOW_FALLBACKS[0];
  }, [workflowId, workflows]);

  const currentPromptGuideMode = useMemo(() => inferPromptGuideMode(selectedWorkflow), [selectedWorkflow]);
  const activePromptGuide = PROMPT_GUIDES[promptGuideMode];

  useEffect(() => {
    setPromptGuideMode(currentPromptGuideMode);
  }, [currentPromptGuideMode]);

  const showPromptBuilderAssistant = currentPromptGuideMode !== "image";
  const promptBuilderNeedsStarterImage = currentPromptGuideMode === "image_to_video";

  useEffect(() => {
    if (!showPromptBuilderAssistant) {
      setPromptAssessmentOpen(false);
      setPromptAssessment(null);
    }
  }, [showPromptBuilderAssistant]);

  const updateDescribePreview = useCallback((file: File | null) => {
    if (describePreviewUrlRef.current) {
      URL.revokeObjectURL(describePreviewUrlRef.current);
      describePreviewUrlRef.current = null;
    }

    if (!file) {
      setDescribePreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    describePreviewUrlRef.current = nextUrl;
    setDescribePreviewUrl(nextUrl);
  }, []);

  const updateAskPreview = useCallback((file: File | null) => {
    if (askPreviewUrlRef.current) {
      URL.revokeObjectURL(askPreviewUrlRef.current);
      askPreviewUrlRef.current = null;
    }

    if (!file) {
      setAskImagePreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    askPreviewUrlRef.current = nextUrl;
    setAskImagePreviewUrl(nextUrl);
  }, []);

  const appendPromptText = useCallback((current: string, addition: string) => {
    const next = String(addition || "").trim();
    if (!next) return current;
    return current.trim() ? `${current.trim()}\n\n${next}` : next;
  }, []);

  const isVideoWorkflowSelected = useMemo(() => {
    const id = String(selectedWorkflow?.id || "").toLowerCase();
    const label = String(selectedWorkflow?.label || "").toLowerCase();
    return id.includes("video") || label.includes("video") || id.includes("animate") || label.includes("animate");
  }, [selectedWorkflow]);

      const isFirstLastImageVideoWorkflowSelected = useMemo(() => {
    const id = String(selectedWorkflow?.id || "").toLowerCase();
    const label = String(selectedWorkflow?.label || "").toLowerCase();
    return id.includes("first image to last image") || label.includes("first to last image") || label.includes("first image to last image");
  }, [selectedWorkflow]);
const isVideoUpscalerWorkflowSelected = useMemo(() => {
    const id = String(selectedWorkflow?.id || "").toLowerCase();
    const label = String(selectedWorkflow?.label || "").toLowerCase();
    return id.includes("rtx sr upscaler") || label.includes("rtx sr") || label.includes("upscale video");
  }, [selectedWorkflow]);

  const isEditImageWorkflowSelected = useMemo(() => {
    const id = String(selectedWorkflow?.id || "").toLowerCase();
    const label = String(selectedWorkflow?.label || "").toLowerCase();
    return id.includes("edit image") || id.includes("edit picture") || label.includes("edit image") || label.includes("edit picture");
  }, [selectedWorkflow]);
const isAnimeImagesWorkflowSelected = useMemo(() => {
    const id = String(selectedWorkflow?.id || "").toLowerCase();
    const label = String(selectedWorkflow?.label || "").toLowerCase();
    return id.includes("create anime images") || label.includes("create anime images");
  }, [selectedWorkflow]);
  const isCustomAudioVideoWorkflowSelected = useMemo(() => {
    const id = String(selectedWorkflow?.id || "").toLowerCase();
    const label = String(selectedWorkflow?.label || "").toLowerCase();
    const haystack = id + " " + label;
    return (
      haystack.includes("custom audio") ||
      haystack.includes("audio image video") ||
      haystack.includes("image audio 2 video") ||
      haystack.includes("create video with custom audio")
    );
  }, [selectedWorkflow]);

const activeGenerateStylePreset = useMemo(
    () => GENERATE_STYLE_PRESETS.find((preset) => preset.id === activeGenerateStyleId) || null,
    [activeGenerateStyleId]
  );

  const activeGenerateStyleGuidance = useMemo(
    () => buildGenerateStyleGuidance(activeGenerateStylePreset),
    [activeGenerateStylePreset]
  );

  const recentGenerateStylePresets = useMemo(
    () =>
      recentGenerateStyleIds
        .map((id) => GENERATE_STYLE_PRESETS.find((preset) => preset.id === id) || null)
        .filter(Boolean) as GenerateStylePreset[],
    [recentGenerateStyleIds]
  );

  const composeGeneratePrompt = useCallback((bodyPrompt: string, stylePreset?: GenerateStylePreset | null) => {
    return composeGeneratePromptWithStyle(bodyPrompt, stylePreset);
  }, []);

  const applyGenerateStylePreset = useCallback(
    (preset: GenerateStylePreset) => {
      if (activeGenerateStyleId === preset.id) {
        setActiveGenerateStyleId("");
        setStatusMessage(`${preset.label} preset cleared.`);
        return;
      }

      setActiveGenerateStyleId(preset.id);
      setRecentGenerateStyleIds((prev) => [preset.id, ...prev.filter((id) => id !== preset.id)].slice(0, 3));
      setStatusMessage(`${preset.label} preset selected.`);
    },
    [activeGenerateStyleId]
  );

  const updateGenerateInputPreview = useCallback((file: File | null) => {
    if (inputImageUrlRef.current) {
      URL.revokeObjectURL(inputImageUrlRef.current);
      inputImageUrlRef.current = null;
    }
    setUploadedImageMeta(null);
    setUploadedInputIsVideo(false);
    setPromptAssessmentOpen(false);
    setPromptAssessment(null);

    if (!file) {
      setUploadedImagePreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    inputImageUrlRef.current = nextUrl;
    setUploadedImagePreviewUrl(nextUrl);

    const isVideoInput = file.type.startsWith("video/");
    setUploadedInputIsVideo(isVideoInput);
    if (isVideoInput) {
      setUploadedImageMeta(null);
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      setUploadedImageMeta({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    };
    img.onerror = () => {
      setUploadedImageMeta(null);
    };
    img.src = nextUrl;
  }, []);

  const getGenerateGalleryItemName = useCallback((item: GalleryItem) => {
    return item.meta?.renamedName || item.sourceName || item.fileName || item.name || "gallery-image.png";
  }, []);

  const loadGenerateGalleryItems = useCallback(async () => {
    setGenerateGalleryLoading(true);
    setGenerateGalleryError("");

    try {
      const res = await fetch("/api/gallery?media=image&sort=newest&per=500", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || "Gallery load failed (" + res.status + ")");
      }

      const rawItems = Array.isArray(data?.items) ? data.items : Array.isArray(data?.files) ? data.files : [];
      const imageItems = rawItems.filter((item: GalleryItem) => {
        const name = String(item.fileName || item.sourceName || item.name || item.url || "");
        const kind = String(item.kind || "").toLowerCase();
        return item.video !== true && kind !== "video" && (kind === "image" || /\.(png|jpe?g|webp|gif)$/i.test(name));
      });

      setGenerateGalleryItems(imageItems);
    } catch (e: any) {
      setGenerateGalleryItems([]);
      setGenerateGalleryError(String(e?.message || e));
    } finally {
      setGenerateGalleryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!generateGalleryPickerOpen) return;
    void loadGenerateGalleryItems();
  }, [generateGalleryPickerOpen, loadGenerateGalleryItems]);

  const handleSelectGenerateGalleryItem = useCallback(
    async (item: GalleryItem) => {
      const url = item.url;
      if (!url) {
        setGenerateGalleryError("This Gallery image is missing a usable URL.");
        return;
      }

      const displayName = getGenerateGalleryItemName(item);
      setGenerateGallerySelecting(displayName);
      setGenerateGalleryError("");

      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Could not read Gallery image (" + res.status + ")");
        }

        const blob = await res.blob();
        const inferredType = blob.type || (displayName.toLowerCase().endsWith(".webp") ? "image/webp" : displayName.toLowerCase().endsWith(".jpg") || displayName.toLowerCase().endsWith(".jpeg") ? "image/jpeg" : "image/png");
        const safeName = /\.(png|jpe?g|webp|gif)$/i.test(displayName) ? displayName : displayName + ".png";
        const file = new File([blob], safeName, { type: inferredType });

        uploadedFileRef.current = file;
        setUploadedFileName(safeName);
        updateGenerateInputPreview(file);
        setGenerateGalleryPickerOpen(false);
        setStatusMessage("Selected Gallery image: " + safeName);
      } catch (e: any) {
        setGenerateGalleryError(String(e?.message || e));
      } finally {
        setGenerateGallerySelecting("");
      }
    },
    [getGenerateGalleryItemName, updateGenerateInputPreview]
  );

    const updateGenerateCustomAudioPreview = useCallback((file: File | null) => {
    if (customAudioUrlRef.current) {
      URL.revokeObjectURL(customAudioUrlRef.current);
      customAudioUrlRef.current = null;
    }

    if (!file) {
      setCustomAudioPreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    customAudioUrlRef.current = nextUrl;
    setCustomAudioPreviewUrl(nextUrl);
  }, []);

  const updateLastFrameInputPreview = useCallback((file: File | null) => {
    if (lastFrameUrlRef.current) {
      URL.revokeObjectURL(lastFrameUrlRef.current);
      lastFrameUrlRef.current = null;
    }
    setLastFrameImageMeta(null);

    if (!file) {
      setLastFramePreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    lastFrameUrlRef.current = nextUrl;
    setLastFramePreviewUrl(nextUrl);

    const img = new window.Image();
    img.onload = () => {
      setLastFrameImageMeta({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    };
    img.onerror = () => {
      setLastFrameImageMeta(null);
    };
    img.src = nextUrl;
  }, []);
const handleCreateCharacterFromGenerate = useCallback(async () => {
    if (!latestPreviewUrl || latestPreviewKind !== "image") {
      setStatusMessage("Generate a portrait image first.");
      return;
    }
    if (!latestPreviewMeta || latestPreviewMeta.height <= latestPreviewMeta.width) {
      setStatusMessage("Create Character only works with generated portrait images.");
      return;
    }

    setCreateCharacterBusy(true);
    setStatusMessage("Sending generated portrait to Characters...");
    try {
      const response = await fetch(latestPreviewUrl, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Could not read the generated image (${response.status}).`);
      }
      const blob = await response.blob();
      const filename = latestPreviewName || "generated-portrait.png";
      const imageFile = new File([blob], filename, { type: blob.type || "image/png" });

      const form = new FormData();
      form.append("image", imageFile, imageFile.name);

      const res = await fetch("/api/characters/upload", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": "web_generate_character_import" },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.serverPath) {
        throw new Error(data?.error || `Character image upload failed (${res.status})`);
      }
      setCharacterImportDraft({
        token: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        imagePath: String(data.serverPath),
        imageUrl: String(data.fileUrl || ""),
        imageName: String(data.filename || imageFile.name || "portrait image"),
      });
      setTab("characters");
      setStatusMessage("Generated portrait sent to Characters. Finish the character record there.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send generated portrait to Characters.");
    } finally {
      setCreateCharacterBusy(false);
    }
  }, [latestPreviewKind, latestPreviewMeta, latestPreviewName, latestPreviewUrl]);


  const clearSceneReferenceAnalysis = useCallback((slot: SceneReferenceSlotKey) => {
    setSceneReferenceAnalyses((prev) => ({ ...prev, [slot]: "" }));
    setSceneReferenceStatuses((prev) => ({ ...prev, [slot]: "idle" }));
    setSceneReferenceBusySlot((prev) => (prev === slot ? "" : prev));
    setSceneReferenceCard("");
    setSceneOutput("");
    setScenePlan(null);
  }, []);

  const clearAllSceneReferenceAnalyses = useCallback(() => {
    setSceneReferenceAnalyses({ char1: "", char2: "", char3: "", bg: "" });
    setSceneReferenceStatuses({ char1: "idle", char2: "idle", char3: "idle", bg: "idle" });
    setSceneReferenceBusySlot("");
    setSceneReferenceCard("");
    setSceneOutput("");
    setScenePlan(null);
  }, []);

  const sceneReferenceImageCard = useMemo(() => {
    return SCENE_REFERENCE_SLOT_OPTIONS
      .map((slot) => sceneReferenceAnalyses[slot.key].trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }, [sceneReferenceAnalyses]);

  const completedSceneReferenceCount = useMemo(() => {
    return SCENE_REFERENCE_SLOT_OPTIONS.filter((slot) => sceneReferenceStatuses[slot.key] === "done").length;
  }, [sceneReferenceStatuses]);

  useEffect(() => {
    setSceneVisionSummary(sceneReferenceImageCard);
  }, [sceneReferenceImageCard]);

  const getSceneTransitionOption = useCallback((mode: Exclude<SceneTransitionMode, "auto">) => {
    return SCENE_TRANSITION_OPTIONS.find((option) => option.mode === mode) || SCENE_TRANSITION_OPTIONS[0];
  }, []);

  const getSceneTransitionLabel = useCallback(
    (mode: SceneTransitionMode) => {
      if (mode === "auto") return "Auto Detect";
      return getSceneTransitionOption(mode).label;
    },
    [getSceneTransitionOption]
  );

  const detectSceneTransitionMode = useCallback((input: string, referenceCard = ""): Exclude<SceneTransitionMode, "auto"> => {
    const hay = `${input || ""}
${referenceCard || ""}`.toLowerCase();

    if (/(flashback|memory cut|memory beat|remembered|remembers|childhood|years ago|as children|when they were kids|back then)/i.test(hay)) {
      return "flashback_cut";
    }
    if (/(continue shot|continuous shot|same shot|carry the same shot|pick up the same beat|keep the same camera momentum)/i.test(hay)) {
      return "continue_shot";
    }
    if (/(reverse angle|reverse-angle|opposite angle|shot reverse shot|shot-reverse-shot)/i.test(hay)) {
      return "reverse_angle";
    }
    if (/(reaction shot|reaction-shot|responding character|response beat|reaction beat)/i.test(hay)) {
      return "reaction_shot";
    }
    if (/(location change|location-change|new location|cut to another location|different location|moves to a new place|changes to a new environment)/i.test(hay)) {
      return "location_change_cut";
    }
    if (/(same-location hard cut|same location hard cut|stay in the same environment|same room hard cut|same sanctuary hard cut)/i.test(hay)) {
      return "same_location_hard_cut";
    }
    if (/(hard cut|hard-cut|clean cut)/i.test(hay)) {
      return "hard_cut";
    }
    return "hard_cut";
  }, []);

  const stripTransitionIntentLines = useCallback((input: string) => {
    return String(input || "")
      .split(/\r?\n/)
      .filter((line) => !/^\s*transition intent\s*:/i.test(line))
      .join("\n")
      .trim();
  }, []);

  const selectedTransitionMode = useMemo<Exclude<SceneTransitionMode, "auto">>(() => {
    return sceneTransitionMode === "auto"
      ? detectSceneTransitionMode(sceneDraft, sceneReferenceCard)
      : sceneTransitionMode;
  }, [detectSceneTransitionMode, sceneDraft, sceneReferenceCard, sceneTransitionMode]);

  const selectedTransitionOption = useMemo(() => {
    return getSceneTransitionOption(selectedTransitionMode);
  }, [getSceneTransitionOption, selectedTransitionMode]);

  const sceneTemporalSequenceHint = useMemo(() => {
    const hay = `${sceneDraft || ""}
${sceneReferenceCard || ""}`.toLowerCase();
    const hasFlashback = /(flashback|memory cut|memory beat|remembered|remembers|childhood|years ago|as children|when they were kids|back then)/i.test(hay);
    const hasReturn = /(returns? to|return to|back in the present|present day|back on the pew|returns? to the church|cut back|back to the sisters)/i.test(hay);
    const hasGroup = /(three sisters|three girls|all three|three women|three children)/i.test(hay);

    if (hasFlashback && hasReturn) {
      return "Temporal sequence detected: present day -> memory/flashback -> return to present.";
    }
    if (hasFlashback) {
      return "Temporal sequence detected: present day -> memory/flashback.";
    }
    if (hasGroup) {
      return "Multi-character group detected: keep each sister visually distinct instead of duplicating one identity across all three roles.";
    }
    return "";
  }, [sceneDraft, sceneReferenceCard]);

  async function handleReferenceImageSlot(slot: SceneReferenceSlotKey) {
    if (sceneReferenceBusySlot) return;

    const slotMeta = SCENE_REFERENCE_SLOT_OPTIONS.find((item) => item.key === slot);
    if (!slotMeta) return;

    const file =
      slot === "char1"
        ? sceneChar1File
        : slot === "char2"
          ? sceneChar2File
          : slot === "char3"
            ? sceneChar3File
            : sceneBgFile;

    if (!file) {
      setStatusMessage(`${slotMeta.label} image is missing.`);
      return;
    }

    if (sceneReferenceStatuses[slot] === "done") {
      setStatusMessage(`${slotMeta.label} reference is already locked. Clear it first if you want to rerun it.`);
      return;
    }

    setSceneReferenceBusySlot(slot);
    setSceneReferenceStatuses((prev) => ({ ...prev, [slot]: "running" }));
    setStatusMessage("");

    if (isFirstLastImageVideoWorkflowSelected && (!uploadedFileRef.current || !lastFrameFileRef.current)) {
      setStatusMessage("Upload both a first image and a last image first.");
      return;
    }

    if (isPromptRelayWorkflowSelected && !uploadedFileRef.current) {
      setStatusMessage("Prompt Relay needs a starter image.");
      return;

    }

    if (isPromptRelayWorkflowSelected && !promptRelayLocalPrompts.trim()) {
      setStatusMessage("Enter at least one Prompt Relay beat.");
      return;

    }


    try {
      const body = new FormData();
      const prompt = slotMeta.kind === "background"
        ? [
            `You are extracting visible reference facts for ${slotMeta.label}.`,
            `Analyze only the attached image for ${slotMeta.label}.`,
            `Return only the final block under this exact heading: ${slotMeta.label}:`,
            "Use short readable bullet points.",
            "Describe only visible facts relevant to LTX scene generation.",
            "Include: location type, lighting and time-of-day cues, color palette, materials and textures, props and layout, depth and framing clues, and continuity anchors.",
            "Do not invent names, motion, dialogue, or story facts that are not visible.",
            `Scene request context: ${sceneDraft.trim() || "No scene request provided."}`,
          ].join("\n")
        : [
            `You are extracting visible reference facts for ${slotMeta.label}.`,
            `Analyze only the attached image for ${slotMeta.label}.`,
            `Return only the final block under this exact heading: ${slotMeta.label}:`,
            "Use short readable bullet points.",
            "Describe only visible facts relevant to LTX scene generation.",
            "Include: visible identity anchors, face and hair cues, skin tone if visually clear, wardrobe and accessories, pose and posture, expression, framing clues, lighting and materials, and continuity anchors.",
            "Do not invent names, backstory, dialogue, or actions that are not visible.",
            `Scene request context: ${sceneDraft.trim() || "No scene request provided."}`,
          ].join("\n");

      body.set("messages", JSON.stringify([{ role: "user", content: prompt }]));
      body.set("image", file);

      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        body,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : `${slotMeta.label} analysis failed.`);
      }

      const rawText = typeof data?.message === "string" ? data.message.trim() : "";
      if (!rawText) {
        throw new Error(`${slotMeta.label} analysis returned empty text.`);
      }

      const headingPattern = new RegExp(`^${escapeRegExp(slotMeta.label)}\\s*:`, "i");
      const normalized = headingPattern.test(rawText) ? rawText : `${slotMeta.label}:\n${rawText}`;

      setSceneReferenceAnalyses((prev) => ({ ...prev, [slot]: normalized }));
      setSceneReferenceStatuses((prev) => ({ ...prev, [slot]: "done" }));
      setSceneReferenceCard("");
      setSceneOutput("");
      setScenePlan(null);
      setStatusMessage(`${slotMeta.label} reference captured and locked.`);
    } catch (error) {
      setSceneReferenceStatuses((prev) => ({ ...prev, [slot]: "idle" }));
      setStatusMessage(error instanceof Error ? error.message : `${slotMeta.label} analysis failed.`);
    } finally {
      setSceneReferenceBusySlot("");
    }
  }

  const stopMicCapture = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.onerror = null;
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    audioChunksRef.current = [];
  }, []);

  const findWorkflowByHint = useCallback(
    (kind: "edit" | "animate") => {
      const match = workflows.find((w) => {
        const hay = `${w.id} ${w.label}`.toLowerCase();
        if (kind === "edit") {
          return hay.includes("edit");
        }
        return hay.includes("ltx") || hay.includes("animate") || hay.includes("video");
      });
      if (match) return match;

      if (kind === "edit") {
        return WORKFLOW_FALLBACKS.find((w) => w.id === "edit-picture") || WORKFLOW_FALLBACKS[2];
      }

      return WORKFLOW_FALLBACKS.find((w) => w.id === "animate-image") || WORKFLOW_FALLBACKS[1];
    },
    [workflows]
  );

  useEffect(() => {
    const persisted = readPersistedState();
    if (persisted) {
      if (persisted.tab) setTab(persisted.tab);
      if (persisted.assistanceTab) setAssistanceTab(persisted.assistanceTab);
      if (typeof persisted.prompt === "string") setPrompt(persisted.prompt);
      if (typeof persisted.negativePrompt === "string") setNegativePrompt(persisted.negativePrompt);
      if (typeof persisted.workflowId === "string") setWorkflowId(persisted.workflowId);
      if (persisted.orientation === "portrait" || persisted.orientation === "landscape") setOrientation(persisted.orientation);
      if (typeof persisted.durationSeconds === "number") setDurationSeconds(clampGenerateDuration(persisted.durationSeconds));
      if (typeof persisted.uploadedFileName === "string") setUploadedFileName(persisted.uploadedFileName);
      if (typeof persisted.gpuTarget === "string") setGpuTarget(persisted.gpuTarget);
      if (typeof persisted.activeGenerateStyleId === "string") setActiveGenerateStyleId(persisted.activeGenerateStyleId);
      if (Array.isArray(persisted.recentGenerateStyleIds)) {
        setRecentGenerateStyleIds(
          persisted.recentGenerateStyleIds
            .map((value) => String(value || "").trim())
            .filter((value) => GENERATE_STYLE_PRESETS.some((preset) => preset.id === value))
            .slice(0, 3)
        );
      }
      if (persisted.galleryViewMode === "default" || persisted.galleryViewMode === "grid" || persisted.galleryViewMode === "list") {
        setGalleryViewMode(persisted.galleryViewMode);
      }
      if (ITEMS_PER_PAGE_OPTIONS.includes(Number(persisted.galleryItemsPerPage) as (typeof ITEMS_PER_PAGE_OPTIONS)[number])) {
        setGalleryItemsPerPage(Number(persisted.galleryItemsPerPage));
      }
      if (ITEMS_PER_PAGE_OPTIONS.includes(Number(persisted.favoritesItemsPerPage) as (typeof ITEMS_PER_PAGE_OPTIONS)[number])) {
        setFavoritesItemsPerPage(Number(persisted.favoritesItemsPerPage));
      }
    }

    try {
      const savedTheme = window.localStorage.getItem(APP_THEME_KEY) as AppThemeId | null;
      if (savedTheme && APP_THEME_OPTIONS.some((theme) => theme.id === savedTheme)) {
        setAppThemeId(savedTheme);
      }

      const savedFontScale = window.localStorage.getItem(APP_FONT_SCALE_KEY) as AppFontScale | null;
      if (savedFontScale && APP_FONT_SCALE_OPTIONS.some((option) => option.id === savedFontScale)) {
        setAppFontScale(savedFontScale);
      }

      const savedUiMode = window.localStorage.getItem(APP_UI_MODE_KEY) as AppUiMode | null;
      if (savedUiMode === "clean" || savedUiMode === "classic") {
        setAppUiMode(savedUiMode);
      }
    } catch {
      // ignore
    }

    try {
      const url = new URL(window.location.href);
      const tabParam = url.searchParams.get("tab");
      if (
        tabParam === "gethelp" ||
        tabParam === "generate" ||
        tabParam === "angles" ||
        tabParam === "storyboard" ||
        tabParam === "characters" ||
        tabParam === "gallery" ||
        tabParam === "voices" ||
        tabParam === "favorites" ||
        tabParam === "editvideo" ||
        tabParam === "settings" ||
        tabParam === "support"
      ) {
        setTab(tabParam);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const nextState: PersistedGenerateState = {
        tab,
        assistanceTab,
        prompt,
        negativePrompt,
        workflowId,
        orientation,
        durationSeconds: clampGenerateDuration(durationSeconds),
        uploadedFileName,
        gpuTarget,
        activeGenerateStyleId,
        recentGenerateStyleIds,
        galleryViewMode,
        galleryItemsPerPage,
        favoritesItemsPerPage,
      };
      window.localStorage.setItem(APP_STATE_KEY, JSON.stringify(nextState));
    } catch {
      // ignore
    }
    }, [
    tab,
    assistanceTab,
    prompt,
    negativePrompt,
    workflowId,
    orientation,
    durationSeconds,
    uploadedFileName,
    gpuTarget,
    activeGenerateStyleId,
    recentGenerateStyleIds,
    galleryViewMode,
    galleryItemsPerPage,
    favoritesItemsPerPage,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    root.style.setProperty("--otg-accent", selectedAppTheme.accent);
    root.style.setProperty("--otg-accent-soft", selectedAppTheme.accentSoft);
    root.style.setProperty("--otg-panel", selectedAppTheme.panel);
    root.style.fontSize = selectedFontScale.rootSize;
    root.dataset.otgUiMode = appUiMode;

    try {
      window.localStorage.setItem(APP_THEME_KEY, appThemeId);
      window.localStorage.setItem(APP_FONT_SCALE_KEY, appFontScale);
      window.localStorage.setItem(APP_UI_MODE_KEY, appUiMode);
    } catch {
      // ignore
    }
  }, [appThemeId, appFontScale, appUiMode, selectedAppTheme.accent, selectedAppTheme.accentSoft, selectedAppTheme.panel, selectedFontScale.rootSize]);

  useEffect(() => {
    return () => {
      if (inputImageUrlRef.current) {
        URL.revokeObjectURL(inputImageUrlRef.current);
        inputImageUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isVideoWorkflowSelected && orientation === "portrait") {
      setOrientation("landscape");
    }
  }, [isVideoWorkflowSelected, orientation]);

  const loadGallery = useCallback(async () => {
    const requestSeq = ++galleryRequestSeqRef.current;
    galleryAbortRef.current?.abort();
    const controller = new AbortController();
    galleryAbortRef.current = controller;
    const queryKey = ["otg", "gallery", gallerySort, galleryFilter, gallerySearchQuery] as const;
    const cached = queryClient.getQueryData<GalleryItem[]>(queryKey);
    if (cached) {
      setGalleryItems(cached);
    }

    setGalleryBusy(!cached);
    try {
      const params = new URLSearchParams();
      params.set("sort", gallerySort);
      params.set("filter", galleryFilter);
      params.set("per", "5000");
      if (gallerySearchQuery) params.set("search", gallerySearchQuery);

      const res = await fetch(`/api/gallery?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.files) ? data.files : [];
      const normalized = items.map(normalizeGalleryItem);
      queryClient.setQueryData(queryKey, normalized);
      if (galleryRequestSeqRef.current === requestSeq && !controller.signal.aborted) {
        setGalleryItems(normalized);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
      if (galleryRequestSeqRef.current === requestSeq) {
        setGalleryItems([]);
      }
    } finally {
      if (galleryRequestSeqRef.current === requestSeq) {
        setGalleryBusy(false);
      }
    }
  }, [galleryFilter, gallerySearchQuery, gallerySort, queryClient]);

  const loadFavorites = useCallback(async () => {
    const requestSeq = ++favoritesRequestSeqRef.current;
    favoritesAbortRef.current?.abort();
    const controller = new AbortController();
    favoritesAbortRef.current = controller;
    const queryKey = ["otg", "favorites"] as const;
    const cached = queryClient.getQueryData<GalleryItem[]>(queryKey);
    if (cached) {
      setFavoriteItems(cached);
    }

    setFavoritesBusy(!cached);
    try {
      const res = await fetch("/api/favorites", {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.files) ? data.files : [];
      const normalized = items.map(normalizeGalleryItem);
      queryClient.setQueryData(queryKey, normalized);
      if (favoritesRequestSeqRef.current === requestSeq && !controller.signal.aborted) {
        setFavoriteItems(normalized);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
      if (favoritesRequestSeqRef.current === requestSeq) {
        setFavoriteItems([]);
      }
    } finally {
      if (favoritesRequestSeqRef.current === requestSeq) {
        setFavoritesBusy(false);
      }
    }
  }, [queryClient]);

  useEffect(() => {
    return () => {
      galleryAbortRef.current?.abort();
      favoritesAbortRef.current?.abort();
    };
  }, []);

  const handleGalleryForcePull = useCallback(async () => {

    setGalleryForcePullBusy(true);
    setStatusMessage("Update Content started. Checking your ComfyUI history and render folders for new content.");

    try {
      const res = await fetch("/api/gallery/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ forcePull: true, limit: 5000 }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(String(data?.error || "Update Content failed."));
      }

      const checked = Number(data?.checked || 0);
      const imported = Number(data?.syncedCount || 0);
      const pending = Number(data?.pendingCount || 0);
      const already = Number(data?.alreadySyncedCount || 0);
      const errors = Number(data?.errorCount || 0);

      const summaryParts = [
        `Update Content checked ${checked} prompt${checked === 1 ? "" : "s"}.`,
        `Imported ${imported} item${imported === 1 ? "" : "s"}.`,
      ];

      if (already > 0) {
        summaryParts.push(`${already} prompt${already === 1 ? " was" : "s were"} already synced.`);
      }
      if (pending > 0) {
        summaryParts.push(`${pending} prompt${pending === 1 ? " is" : "s are"} still pending or not available in history.`);
      }
      if (errors > 0) {
        summaryParts.push(`${errors} prompt${errors === 1 ? " failed" : "s failed"}.`);
      }

      setStatusMessage(summaryParts.join(" "));
      await loadGallery();
      await loadFavorites();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Update Content failed.");
    } finally {
      setGalleryForcePullBusy(false);
    }
  }, [loadFavorites, loadGallery]);


  useEffect(() => {
    return () => {
      stopMicCapture();

      if (describePreviewUrlRef.current) {
        URL.revokeObjectURL(describePreviewUrlRef.current);
        describePreviewUrlRef.current = null;
      }

      if (askPreviewUrlRef.current) {
        URL.revokeObjectURL(askPreviewUrlRef.current);
        askPreviewUrlRef.current = null;
      }
    };
  }, [stopMicCapture]);

  useEffect(() => {
    if (!isAdmin && tab === "voices") {
      setTab("generate");
    }
  }, [isAdmin, tab]);

  useEffect(() => {
    const data = whoamiQuery.data;
    if (!data) {
      if ((whoamiQuery.error as (Error & { status?: number }) | null)?.status === 401) {
        setUsername("Guest");
        setIsAdmin(false);
        writeCachedUsername("Guest");
      }
      return;
    }

    const nextUsername = data?.username || data?.user?.username || data?.user?.name || data?.user?.email || "Guest";
    setUsername(nextUsername);
    writeCachedUsername(nextUsername);
    setIsAdmin(Boolean(data?.user?.admin));
  }, [whoamiQuery.data, whoamiQuery.error]);

  useEffect(() => {
    const mapped = workflowsQuery.data || [];
    if (mapped.length > 0) {
      setWorkflows(mapped);
      setWorkflowId((current) => (mapped.some((w: WorkflowItem) => w.id === current) ? current : mapped[0].id));
    }
  }, [workflowsQuery.data]);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const res = await fetch("/api/comfy-status", {
          cache: "no-store",
          credentials: "include",
        });

        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        setConnected(Boolean(data?.connected || data?.ok || data?.status === "connected"));
        if (typeof data?.message === "string" && data.message.trim()) {
          setStatusMessage(data.message.trim());
        }
      } catch {
        // ignore
      }
    }

    void loadStatus();

    const timer = window.setInterval(() => {
      void loadStatus();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (viewerState) return;

    if (tab === "gallery") {
      void loadGallery();
    }
    if (tab === "favorites") {
      void loadFavorites();
    }
  }, [tab, viewerState, loadGallery, loadFavorites]);

  const refreshLatestContent = useCallback(async (force = false) => {
    try {
      const res = await fetch("/api/content/last", {
        cache: "no-store",
        credentials: "include",
      });

      const data = (await res.json().catch(() => ({}))) as LatestContentResponse;
      const file = data?.file;

      if (file?.url) {
        const baseUrl = String(file.url || "").trim();
        const nextName = String(file.sourceName || file.name || "").trim();
        const nextKind = file.kind === "video" ? "video" : "image";
        const nextIdentity = `${nextKind}|${nextName}|${baseUrl}`;

        if (force || nextIdentity !== latestPreviewIdentityRef.current) {
          latestPreviewIdentityRef.current = nextIdentity;
          const bust = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
          setLatestPreviewUrl(bust);
          setLatestPreviewName(nextName);
          setLatestPreviewKind(nextKind);
          if (nextKind !== "image") setLatestPreviewMeta(null);
        }
        return;
      }

      latestPreviewIdentityRef.current = "";
      setLatestPreviewUrl("");
      setLatestPreviewName("");
      setLatestPreviewKind("");
      setLatestPreviewMeta(null);
    } catch {
      // ignore
    }
  }, []);


  useEffect(() => {
    if (!latestPreviewUrl || latestPreviewKind !== "image") {
      setLatestPreviewMeta(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setLatestPreviewMeta({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.onerror = () => {
      if (!cancelled) setLatestPreviewMeta(null);
    };
    img.src = latestPreviewUrl;

    return () => {
      cancelled = true;
    };
  }, [latestPreviewKind, latestPreviewUrl]);

  const refreshProgress = useCallback(async () => {
    try {
      const res = await fetch("/api/progress", {
        cache: "no-store",
        credentials: "include",
      });

      const data = (await res.json().catch(() => ({}))) as ProgressResponse;
      const nextStatus = String(data?.status || "idle").toLowerCase();
      const queueCount = Number(data?.queue_remaining ?? data?.queue ?? 0) || 0;
      const running = Boolean(data?.running) || nextStatus === "running";
      const promptId = String(data?.prompt_id || "").trim();

      setProgressQueue(queueCount);
      if (promptId) setActivePromptId(promptId);

      if (nextStatus === "error") {
        refreshedCompletePromptRef.current = "";
        setProgressStatus("error");
        setProgressPercent(100);
        return;
      }

      if (running) {
        refreshedCompletePromptRef.current = "";
        setProgressStatus("running");
        setProgressPercent((prev) => {
          const base = prev > 5 ? prev : 12;
          const next = queueCount > 0 ? Math.min(base + 8, 92) : Math.min(base + 5, 88);
          return next;
        });
        return;
      }

      if (nextStatus === "complete") {
        const completionKey = promptId || "__complete__";
        setProgressStatus("complete");
        setProgressPercent(100);

        if (refreshedCompletePromptRef.current !== completionKey) {
          refreshedCompletePromptRef.current = completionKey;
          await refreshLatestContent();
        }
        return;
      }

      refreshedCompletePromptRef.current = "";
      setProgressStatus("idle");
      setProgressPercent(0);
    } catch {
      // ignore
    }
  }, [refreshLatestContent]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;

      await refreshProgress().catch(() => null);

      if (cancelled) return;

      if (tab === "generate") {
        await refreshLatestContent().catch(() => null);
      }
    };

    void tick();

    const timer = window.setInterval(() => {
      void tick();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tab, refreshProgress, refreshLatestContent]);

  useEffect(() => {
    if (tab !== "gallery" && tab !== "favorites") return;
    if (viewerState) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;

      if (tab === "gallery") {
        await loadGallery().catch(() => null);
        return;
      }

      await loadFavorites().catch(() => null);
    };

    void tick();

    const timer = window.setInterval(() => {
      void tick();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tab, viewerState, loadGallery, loadFavorites]);

  useEffect(() => {
    if (tab !== "gallery" && tab !== "favorites") return;

    let cancelled = false;

    const runBackfill = async () => {
      await fetch("/api/gallery/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ limit: 8 }),
      }).catch(() => null);

      if (cancelled) return;

      if (tab === "gallery") {
        await loadGallery().catch(() => null);
      }

      if (tab === "favorites") {
        await loadFavorites().catch(() => null);
      }
    };

    void runBackfill();

    return () => {
      cancelled = true;
    };
  }, [tab, loadGallery, loadFavorites]);

  const enhancePromptText = useCallback(async (
    inputText: string,
    workflowHint?: string,
    options?: { styleLabel?: string; stylePrompt?: string; mode?: "image" | "video" }
  ) => {
    const cleaned = String(inputText || "").trim();
    if (!cleaned) {
      throw new Error("Nothing to enhance.");
    }

    const res = await fetch("/api/enhance-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        prompt: cleaned,
        workflowId: workflowHint || selectedWorkflow.id,
        styleLabel: options?.styleLabel || "",
        stylePrompt: options?.stylePrompt || "",
        mode: options?.mode || (looksLikeVideoWorkflow(workflowHint || selectedWorkflow.id) ? "video" : "image"),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Enhance Prompt failed");
    }

    const nextPrompt = typeof data?.enhancedPrompt === "string" ? data.enhancedPrompt.trim() : "";
    if (!nextPrompt) {
      throw new Error("Empty enhancement response");
    }

    return nextPrompt;
  }, [selectedWorkflow.id]);

  const submitToComfy = useCallback(
    async (
      formData: FormData,
      options?: {
        expectedRequestKind?: string;
        expectedSourceType?: string;
        expectedWorkflowId?: string;
        successMessage?: string;
      }
    ) => {
      const res = await fetch("/api/comfy", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "ComfyUI submission failed");
      }

      const debug = data?.otgRequestDebug && typeof data.otgRequestDebug === "object" ? data.otgRequestDebug : null;
      const expectedRequestKind = String(options?.expectedRequestKind || "").trim();
      const expectedSourceType = String(options?.expectedSourceType || "").trim();
      const expectedWorkflowId = String(options?.expectedWorkflowId || "").trim();

      if (expectedRequestKind) {
        const actualRequestKind = String(debug?.requestKind || "").trim();
        const actualSourceType = String(debug?.sourceType || "").trim();
        const actualWorkflowId = String(debug?.workflowId || data?.workflowId || formData.get("workflowId") || formData.get("preset") || "").trim();

        const requestKindMatches = actualRequestKind === expectedRequestKind;
        const sourceTypeMatches = !expectedSourceType || actualSourceType === expectedSourceType;
        const workflowMatches = !expectedWorkflowId || actualWorkflowId === expectedWorkflowId;

        if (!requestKindMatches || !sourceTypeMatches || !workflowMatches) {
          throw new Error(
            [
              "Extend submission wiring mismatch.",
              `expected requestKind=${expectedRequestKind}`,
              expectedSourceType ? `expected sourceType=${expectedSourceType}` : "",
              expectedWorkflowId ? `expected workflowId=${expectedWorkflowId}` : "",
              `actual requestKind=${actualRequestKind || "<empty>"}`,
              `actual sourceType=${actualSourceType || "<empty>"}`,
              `actual workflowId=${actualWorkflowId || "<empty>"}`,
            ]
              .filter(Boolean)
              .join(" | ")
          );
        }
      }

      const promptId = String(data?.prompt_id || data?.promptId || "").trim();
      const baseMessage = String(options?.successMessage || "Submitted to ComfyUI.").trim() || "Submitted to ComfyUI.";
      if (promptId) {
        setActivePromptId(promptId);
        setStatusMessage(`${baseMessage} Prompt ID: ${promptId}`);
      } else {
        setStatusMessage(baseMessage);
      }

      setProgressStatus("running");
      setProgressPercent(8);
      refreshedCompletePromptRef.current = "";
      await Promise.all([refreshProgress(), loadGallery(), loadFavorites()]);
    },
    [loadFavorites, loadGallery, refreshProgress]
  );

  const fetchGalleryItemAsFile = useCallback(async (item: GalleryItem, fallbackBaseName: string) => {
    const fileUrl = String(item.url || "").trim();
    if (!fileUrl) {
      throw new Error("This gallery item has no usable URL.");
    }

    const res = await fetch(fileUrl, {
      cache: "no-store",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Failed to load gallery media.");
    }

    const blob = await res.blob();
        const rawName = getGalleryItemKey(item) || fallbackBaseName;
    const safeBaseName = String(rawName)
      .split(/[\\/]+/)
      .pop() || fallbackBaseName;
    const extension =
      blob.type === "image/png"
        ? "png"
        : blob.type === "image/webp"
          ? "webp"
          : blob.type === "image/jpeg"
            ? "jpg"
            : blob.type === "video/mp4"
              ? "mp4"
              : "";
        const fileName = safeBaseName.includes(".")
      ? safeBaseName
      : extension
        ? `${safeBaseName}.${extension}`
        : safeBaseName;

    return new File([blob], fileName, { type: blob.type || "application/octet-stream" });
  }, []);

  const fetchUrlAsFile = useCallback(async (fileUrl: string, fallbackBaseName: string, preferredType = "application/octet-stream") => {
    const res = await fetch(fileUrl, {
      cache: "no-store",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Failed to load the prepared source file.");
    }

    const blob = await res.blob();
    const safeBaseName = String(fallbackBaseName).split(/[\/]+/).pop() || "source-file";
    const extension =
      blob.type === "image/png"
        ? "png"
        : blob.type === "image/webp"
          ? "webp"
          : blob.type === "image/jpeg"
            ? "jpg"
            : blob.type === "video/mp4"
              ? "mp4"
              : preferredType === "image/png"
                ? "png"
                : preferredType === "image/webp"
                  ? "webp"
                  : preferredType === "image/jpeg"
                    ? "jpg"
                    : preferredType === "video/mp4"
                      ? "mp4"
                      : "";

    const fileName = safeBaseName.includes(".") ? safeBaseName : extension ? `${safeBaseName}.${extension}` : safeBaseName;
    return new File([blob], fileName, { type: blob.type || preferredType });
  }, []);

  const enhancePromptWithVision = useCallback(
    async (
      item: GalleryItem,
      currentPrompt: string,
      negativePrompt: string,
      mode: "edit" | "animate",
      durationSeconds?: number
    ) => {
      const fileUrl = String(item.url || "").trim();
      if (!fileUrl) {
        throw new Error("This gallery item has no usable URL.");
      }

      const imageRes = await fetch(fileUrl, {
        cache: "no-store",
        credentials: "include",
      });

      if (!imageRes.ok) {
        throw new Error("Failed to load the source image for vision enhancement.");
      }

      const blob = await imageRes.blob();
      const fileBase = getGalleryItemKey(item) || (mode === "edit" ? "edit-source" : "animate-source");
      const extension =
        blob.type === "image/png"
          ? "png"
          : blob.type === "image/webp"
            ? "webp"
            : "jpg";

      const imageFile = new File([blob], fileBase.includes(".") ? fileBase : `${fileBase}.${extension}`, {
        type: blob.type || "image/jpeg",
      });

      const instruction =
        mode === "edit"
          ? [
              "You are refining an image edit prompt.",
              "Analyze the attached source image and the user's requested edit.",
              "Preserve the original subject identity, composition, and visual continuity unless the user explicitly requests a change.",
              "Return one improved positive prompt only, optimized for image editing.",
              `User request: ${currentPrompt.trim() || "No request provided."}`,
              `Negative context: ${negativePrompt.trim() || "None."}`,
            ].join("\n")
          : [
              "You are refining an image-to-video prompt.",
              "Analyze the attached source image and the user's requested animation.",
              "Preserve the original subject identity, scene continuity, and visual consistency.",
              "Add useful motion, camera, atmosphere, and temporal detail without changing the core subject unless requested.",
              "Return one improved positive prompt only, optimized for image-to-video generation.",
              `User request: ${currentPrompt.trim() || "No request provided."}`,
              `Negative context: ${negativePrompt.trim() || "None."}`,
              `Duration seconds: ${Number.isFinite(Number(durationSeconds)) ? Math.floor(Number(durationSeconds)) : 8}`,
            ].join("\n");

      const body = new FormData();
      body.set(
        "messages",
        JSON.stringify([
          {
            role: "user",
            content: instruction,
          },
        ])
      );
      body.set("image", imageFile);

      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        body,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Vision enhance failed");
      }

      const nextPrompt = typeof data?.message === "string" ? data.message.trim() : "";
      if (!nextPrompt) {
        throw new Error("Vision enhancement returned an empty prompt.");
      }

      return nextPrompt;
    },
    []
  );
  useEffect(() => {
    setGalleryPage(1);
  }, [deferredGallerySearch, galleryFilter, gallerySort, galleryItemsPerPage]);

  useEffect(() => {
    setFavoritesPage(1);
  }, [deferredFavoritesSearch, favoritesFilter, favoritesSort, favoritesItemsPerPage]);

  const galleryTotalPages = useMemo(() => {
    if (galleryItemsPerPage <= 0) return 1;
    return Math.max(1, Math.ceil(galleryItems.length / galleryItemsPerPage));
  }, [galleryItems.length, galleryItemsPerPage]);

  const filteredFavoriteItems = useMemo(() => {
    const items = favoriteItems.filter((item) => {
      const itemKind = item.kind || (item.video ? "video" : "image");
      if (favoritesFilter === "images" && itemKind !== "image") return false;
      if (favoritesFilter === "videos" && itemKind !== "video") return false;
      if (!favoritesSearchQuery) return true;

      const label = String(item.meta?.renamedName || item.name || item.fileName || item.sourceName || "").toLowerCase();
      const original = String(item.meta?.originalName || "").toLowerCase();
      const workflow = String(item.meta?.workflowTitle || item.meta?.workflowId || "").toLowerCase();
      return (label + " " + original + " " + workflow).includes(favoritesSearchQuery);
    });

    return [...items].sort((a, b) => {
      if (favoritesSort === "name") {
        const aName = String(a.meta?.renamedName || a.name || a.fileName || a.sourceName || "").toLowerCase();
        const bName = String(b.meta?.renamedName || b.name || b.fileName || b.sourceName || "").toLowerCase();
        return aName.localeCompare(bName);
      }

      const aTime = Number(a.updatedAt || a.createdAt || 0);
      const bTime = Number(b.updatedAt || b.createdAt || 0);
      return favoritesSort === "oldest" ? aTime - bTime : bTime - aTime;
    });
  }, [favoriteItems, favoritesFilter, favoritesSearchQuery, favoritesSort]);

  const favoritesTotalPages = useMemo(() => {
    if (favoritesItemsPerPage <= 0) return 1;
    return Math.max(1, Math.ceil(filteredFavoriteItems.length / favoritesItemsPerPage));
  }, [filteredFavoriteItems.length, favoritesItemsPerPage]);

  useEffect(() => {
    setGalleryPage((current) => Math.min(Math.max(1, current), galleryTotalPages));
  }, [galleryTotalPages]);

  useEffect(() => {
    setFavoritesPage((current) => Math.min(Math.max(1, current), favoritesTotalPages));
  }, [favoritesTotalPages]);

  const visibleGalleryItems = useMemo(() => {
    if (galleryItemsPerPage <= 0) return galleryItems;
    const start = (galleryPage - 1) * galleryItemsPerPage;
    return galleryItems.slice(start, start + galleryItemsPerPage);
  }, [galleryItems, galleryItemsPerPage, galleryPage]);

  const visibleFavoriteItems = useMemo(() => {
    if (favoritesItemsPerPage <= 0) return filteredFavoriteItems;
    const start = (favoritesPage - 1) * favoritesItemsPerPage;
    return filteredFavoriteItems.slice(start, start + favoritesItemsPerPage);
  }, [filteredFavoriteItems, favoritesItemsPerPage, favoritesPage]);

  const galleryItemKeySet = useMemo(() => {
    return new Set(galleryItems.map((item) => getGalleryItemKey(item)).filter(Boolean));
  }, [galleryItems]);

  const favoriteItemKeySet = useMemo(() => {
    return new Set(favoriteItems.map((item) => getGalleryItemKey(item)).filter(Boolean));
  }, [favoriteItems]);

  const openViewer = useCallback(
    (item: GalleryItem) => {
      const url = String(item.url || "").trim();
      const itemKey = getGalleryItemKey(item);
      if (!url || !itemKey) return;

      setViewerState({
        collection: tab === "favorites" ? "favorites" : "gallery",
        itemKey,
        item,
      });
    },
    [tab]
  );

  const viewerItems = useMemo(() => {
    if (!viewerState) return [] as GalleryItem[];
    return viewerState.collection === "favorites" ? favoriteItems : galleryItems;
  }, [viewerState, favoriteItems, galleryItems]);

  const viewerIndex = useMemo(() => {
    if (!viewerState) return -1;
    return viewerItems.findIndex((entry) => getGalleryItemKey(entry) === viewerState.itemKey);
  }, [viewerItems, viewerState]);

  const viewerItem = useMemo(() => {
    if (!viewerState) return null;
    if (viewerIndex >= 0) return viewerItems[viewerIndex] || null;
    return viewerState.item;
  }, [viewerIndex, viewerItems, viewerState]);

  const viewerTitle = useMemo(() => String(viewerItem?.name || viewerItem?.sourceName || "Viewer"), [viewerItem]);
  const viewerUrl = useMemo(() => String(viewerItem?.url || "").trim(), [viewerItem]);
  const viewerIsVideo = useMemo(() => Boolean(viewerItem?.video || viewerItem?.kind === "video"), [viewerItem]);
  const viewerCanPrev = viewerIndex > 0;
  const viewerCanNext = viewerIndex >= 0 && viewerIndex < viewerItems.length - 1;

  useEffect(() => {
    if (!viewerState?.itemKey) return;
    const keySet = viewerState.collection === "favorites" ? favoriteItemKeySet : galleryItemKeySet;
    if (!keySet.has(viewerState.itemKey)) {
      setViewerState(null);
    }
  }, [favoriteItemKeySet, galleryItemKeySet, viewerState]);

  useEffect(() => {
    if (editModal && !galleryItemKeySet.has(getGalleryItemKey(editModal.item))) {
      setEditModal(null);
    }
  }, [editModal, galleryItemKeySet]);

  useEffect(() => {
    if (animateModal && !galleryItemKeySet.has(getGalleryItemKey(animateModal.item))) {
      setAnimateModal(null);
    }
  }, [animateModal, galleryItemKeySet]);

  useEffect(() => {
    if (extendModal && !galleryItemKeySet.has(getGalleryItemKey(extendModal.item))) {
      setExtendModal(null);
    }
  }, [extendModal, galleryItemKeySet]);

  const moveViewer = useCallback(
    (direction: "prev" | "next") => {
      if (!viewerState || viewerIndex < 0) return;
      const offset = direction === "next" ? 1 : -1;
      const nextIndex = viewerIndex + offset;
      if (nextIndex < 0 || nextIndex >= viewerItems.length) return;
      const nextItem = viewerItems[nextIndex];
      const nextKey = getGalleryItemKey(nextItem);
      if (!nextItem || !nextKey) return;
      setViewerState({
        collection: viewerState.collection,
        itemKey: nextKey,
        item: nextItem,
      });
    },
    [viewerIndex, viewerItems, viewerState]
  );

  const handleViewerTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    viewerTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleViewerTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const start = viewerTouchStartRef.current;
      viewerTouchStartRef.current = null;
      const touch = event.changedTouches?.[0];
      if (!start || !touch) return;

      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;

      if (dx < 0) {
        moveViewer("next");
      } else {
        moveViewer("prev");
      }
    },
    [moveViewer]
  );

  useEffect(() => {
    if (!viewerState) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewerState(null);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveViewer("prev");
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveViewer("next");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveViewer, viewerState]);

  const isPromptRelayWorkflowSelected = useMemo(() => {
    const id = String(selectedWorkflow?.id || "").toLowerCase();
    const label = String(selectedWorkflow?.label || "").toLowerCase();
    const haystack = `${id} ${label}`;
    return haystack.includes("prompt relay") || haystack.includes("scene-controlled") || haystack.includes("scene controlled");
  }, [selectedWorkflow]);

  const promptRelayLocalPrompts = useMemo(() => {
    return [promptRelayBeat1, promptRelayBeat2, promptRelayBeat3, promptRelayBeat4]
      .map((beat) => beat.trim())
      .filter(Boolean)
      .join("\n|\n");
  }, [promptRelayBeat1, promptRelayBeat2, promptRelayBeat3, promptRelayBeat4]);
  const handleGenerate = useCallback(async () => {
    if (generateBusy) return;
    const finalPrompt = composeGeneratePrompt(prompt, activeGenerateStylePreset);
    const relayLocalPromptsForSubmit = promptRelayLocalPrompts.trim();
    if (!isVideoUpscalerWorkflowSelected && !finalPrompt.trim()) {
      setStatusMessage("Enter a prompt first.");
      return;
    }

    if (isVideoUpscalerWorkflowSelected && !uploadedFileRef.current) {
      setStatusMessage("Upload a source video first.");
      return;
    }

    if (isEditImageWorkflowSelected && !uploadedFileRef.current) {
      setStatusMessage("Upload an input image first.");
      return;
    }

    if (isCustomAudioVideoWorkflowSelected && (!uploadedFileRef.current || !customAudioFileRef.current)) {
      setStatusMessage("Upload an input image and a custom audio file first.");
      return;
    }

    setGenerateBusy(true);
    setStatusMessage("");
    refreshedCompletePromptRef.current = "";
    latestPreviewIdentityRef.current = "";
    setProgressStatus("running");
    setProgressPercent(8);
    setLatestPreviewUrl("");
    setLatestPreviewName("");
    setLatestPreviewKind("");

    if (isFirstLastImageVideoWorkflowSelected && (!uploadedFileRef.current || !lastFrameFileRef.current)) {
      setStatusMessage("Upload both a first image and a last image first.");
      return;
    }

    try {
      const body = new FormData();
      body.set("workflowId", workflowId);
      body.set("prompt", finalPrompt);
      body.set("negativePrompt", negativePrompt);
      if (isPromptRelayWorkflowSelected) {
        body.set("promptRelayGlobalPrompt", finalPrompt);
        body.set("promptRelayLocalPrompts", relayLocalPromptsForSubmit);
        body.set("promptRelaySegmentLengths", "");
        body.set("promptRelayEpsilon", "0.001");
      }
      body.set("orientation", orientation);
      body.set("durationSeconds", String(durationSeconds));
      body.set("gpuTarget", gpuTarget);
      body.set("seed", String(randomSeed()));
      if (isAnimeImagesWorkflowSelected) {
        body.set("width", orientation === "portrait" ? "720" : "1280");
        body.set("height", orientation === "portrait" ? "1280" : "720");
        body.delete("durationSeconds");
        body.set("requestKind", "anime-image");
      }

      if (!isAnimeImagesWorkflowSelected && shouldSendSizeOverride(selectedWorkflow)) {
        body.set("width", orientation === "portrait" ? "720" : "1280");
        body.set("height", orientation === "portrait" ? "1280" : "720");
      }

      if (uploadedFileRef.current) {
        if (isVideoUpscalerWorkflowSelected) {
          body.set("videoA", uploadedFileRef.current);
        } else {
          body.set("imageA", uploadedFileRef.current);
        }
      }

      if (isCustomAudioVideoWorkflowSelected && customAudioFileRef.current) {
        body.set("audioA", customAudioFileRef.current);
        body.set("requestKind", "custom-audio-image-video");
      }

      if (isFirstLastImageVideoWorkflowSelected && lastFrameFileRef.current) {
        body.set("imageB", lastFrameFileRef.current);
      }

      if (isFirstLastImageVideoWorkflowSelected) {
        body.set("workflowId", "presets/Create First Image to Last Image Video");
        body.set("workflow", "presets/Create First Image to Last Image Video");
        if (uploadedFileRef.current) {
          body.set("imageA", uploadedFileRef.current);
        }
        if (lastFrameFileRef.current) {
          body.set("imageB", lastFrameFileRef.current);
        }
      }
      await submitToComfy(body);
    } catch (error) {
      setProgressStatus("error");
      setProgressPercent(100);
      setStatusMessage(error instanceof Error ? error.message : "Generate failed.");
    } finally {
      setGenerateBusy(false);
    }
  }, [
    activeGenerateStylePreset,
    composeGeneratePrompt,
    durationSeconds,
    generateBusy,
    gpuTarget,
    negativePrompt,
    orientation,
    prompt,
    selectedWorkflow,
    submitToComfy,
    workflowId,
    isAnimeImagesWorkflowSelected,

    isPromptRelayWorkflowSelected,
    isEditImageWorkflowSelected,
    isCustomAudioVideoWorkflowSelected,
    promptRelayLocalPrompts,]);


  const galleryActionsLocked = galleryBusy || galleryForcePullBusy || favoritesBusy || !!galleryActionBusyName;

  function beginGalleryAction(name: string, kind: GalleryActionKind) {
    setGalleryActionBusyName(name);
    setGalleryActionBusyKind(kind);
  }

  function finishGalleryAction() {
    setGalleryActionBusyName("");
    setGalleryActionBusyKind("");
  }

  function canStartGalleryAction() {
    if (!galleryActionsLocked) return true;
    const busyLabel = (galleryActionBusyKind || "action").replace(/-/g, " ");
    setStatusMessage(`Finish the current gallery ${busyLabel} first.`);
    return false;
  }

  function clearGalleryUiForItem(name: string) {
    if (!name) return;
    if (viewerState?.itemKey === name) setViewerState(null);
    if (editModal && getGalleryItemKey(editModal.item) === name) setEditModal(null);
    if (animateModal && getGalleryItemKey(animateModal.item) === name) setAnimateModal(null);
    if (extendModal && getGalleryItemKey(extendModal.item) === name) setExtendModal(null);
  }


  async function handleGalleryCreateCharacter(item: GalleryItem) {
    const name = getGalleryItemKey(item);
    if (!name) {
      setStatusMessage("Missing gallery image name.");
      return;
    }
    if (!isSupportedCharacterGalleryImage(name, item)) {
      setStatusMessage("Characters can only use Gallery images, not videos.");
      return;
    }
    if (!canStartGalleryAction()) return;

    beginGalleryAction(name, "character-import");
    setStatusMessage("Checking Gallery image for portrait character import...");
    try {
      const fileUrl = galleryOriginalFileUrl(item) || String(item.url || "");
      if (!fileUrl) {
        throw new Error("Could not resolve the Gallery image file.");
      }

      const response = await fetch(fileUrl, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Could not read the Gallery image (${response.status}).`);
      }

      const blob = await response.blob();
      if (!String(blob.type || "").startsWith("image/")) {
        throw new Error("Characters can only use image files, not videos.");
      }

      const dimensions = await readGalleryImageDimensionsFromBlob(blob);
      if (dimensions.height <= dimensions.width) {
        throw new Error("Characters requires a portrait image. Choose an image where height is greater than width.");
      }

      const imageFile = new File([blob], name || "gallery-portrait.png", { type: blob.type || "image/png" });
      const form = new FormData();
      form.append("image", imageFile, imageFile.name);

      const res = await fetch("/api/characters/upload", {
        method: "POST",
        credentials: "include",
        headers: { "x-otg-device-id": "web_gallery_character_import" },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.serverPath) {
        throw new Error(data?.error || `Character image upload failed (${res.status})`);
      }

      setCharacterImportDraft({
        token: `gallery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        imagePath: String(data.serverPath),
        imageUrl: String(data.fileUrl || ""),
        imageName: String(data.filename || imageFile.name || "gallery portrait image"),
      });
      setTab("characters");
      setStatusMessage("Gallery portrait sent to Characters. Finish the character record there.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send Gallery portrait to Characters.");
    } finally {
      finishGalleryAction();
    }
  }

  async function handleGalleryDownload(item: GalleryItem) {
    const name = getGalleryItemKey(item);
    if (!name) return;

    const a = document.createElement("a");
    a.href = `/api/gallery/file?name=${encodeURIComponent(name)}&scope=${encodeURIComponent(String(item.source || "user"))}&download=1`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleGalleryFavorite(item: GalleryItem) {
    const name = getGalleryItemKey(item);
    if (!name) {
      setStatusMessage("Missing name");
      return;
    }

    if (!canStartGalleryAction()) return;

    beginGalleryAction(name, "favorite");

    try {
      const res = await fetch("/api/gallery/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          scope: item.source,
          favorite: !item.meta?.favorite,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Favorite toggle failed");
      }

      setStatusMessage(data?.favorite ? "Saved to favorites." : "Removed from favorites.");
      if (!data?.favorite && viewerState?.collection === "favorites" && viewerState.itemKey === name) {
        setViewerState(null);
      }
      await Promise.all([loadGallery(), loadFavorites()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Favorite toggle failed.");
    } finally {
      finishGalleryAction();
    }
  }

  async function handleGalleryRename(item: GalleryItem) {
    const fileName = getGalleryItemKey(item);
    const displayName = String(item.name || fileName).trim();

    if (!fileName) {
      setStatusMessage("Missing name");
      return;
    }

    const nextName = window.prompt("Rename item", displayName);
    if (!nextName || !nextName.trim() || nextName.trim() === displayName) return;

    if (!canStartGalleryAction()) return;

    beginGalleryAction(fileName, "rename");

    try {
      const res = await fetch("/api/gallery/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: fileName,
          newName: nextName.trim(),
          scope: item.source,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Rename failed");
      }

      setStatusMessage("Gallery item renamed.");
      clearGalleryUiForItem(fileName);
      await Promise.all([loadGallery(), loadFavorites()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Rename failed.");
    } finally {
      finishGalleryAction();
    }
  }

  async function handleGalleryDelete(item: GalleryItem) {
    const name = getGalleryItemKey(item);
    if (!name) {
      setStatusMessage("Missing name");
      return;
    }

    if (!window.confirm(`Delete "${item.name || name}"? This removes the gallery file and metadata.`)) {
      return;
    }

    if (!canStartGalleryAction()) return;

    beginGalleryAction(name, "delete");

    try {
      const res = await fetch("/api/gallery/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          scope: item.source,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Delete failed");
      }

      setStatusMessage("Gallery item deleted.");
      clearGalleryUiForItem(name);
      await Promise.all([loadGallery(), loadFavorites()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      finishGalleryAction();
    }
  }

    async function handleGalleryRedo(item: GalleryItem) {
    const itemName = getGalleryItemKey(item);
    const storedPayload =
      item.meta?.submitPayload && typeof item.meta.submitPayload === "object"
        ? item.meta.submitPayload
        : {};

    if (!itemName) {
      setStatusMessage("Missing name");
      return;
    }

    if (!canStartGalleryAction()) return;

    beginGalleryAction(itemName, "redo");

    try {
      const nextWorkflowId = String(
        (storedPayload as any).workflowId ||
        (storedPayload as any).preset ||
        item.meta?.workflowId ||
        ""
      ).trim();

      const nextPrompt = String(
        (storedPayload as any).positivePrompt ||
        (storedPayload as any).prompt ||
        item.meta?.positivePrompt ||
        ""
      ).trim();

      const nextNegative = String(
        (storedPayload as any).negativePrompt ||
        (storedPayload as any).neg ||
        item.meta?.negativePrompt ||
        ""
      ).trim();

      const nextOrientation =
        (storedPayload as any).orientation === "portrait" || (storedPayload as any).orientation === "landscape"
          ? (storedPayload as any).orientation
          : orientation;

      const nextDuration = clampDuration(
        Number(
          (storedPayload as any).durationSeconds ||
          (storedPayload as any).durationSec ||
          durationSeconds
        )
      );

      const nextGpuTarget =
        String((storedPayload as any).gpuTarget || gpuTarget || "").trim() || gpuTarget;

      if (!nextWorkflowId || !nextPrompt) {
        throw new Error("This item has no complete redo metadata.");
      }

      const body = new FormData();
      body.set("workflowId", nextWorkflowId);
      body.set("prompt", nextPrompt);
      body.set("negativePrompt", nextNegative);
      body.set("orientation", nextOrientation);
      body.set("durationSeconds", String(nextDuration));
      body.set("gpuTarget", nextGpuTarget);
      body.set("seed", String(randomSeed()));
      if (isAnimeImagesWorkflowSelected) {
        body.set("width", orientation === "portrait" ? "720" : "1280");
        body.set("height", orientation === "portrait" ? "1280" : "720");
        body.delete("durationSeconds");
        body.set("requestKind", "anime-image");
      }

      const workflowForSize =
        workflows.find((w) => w.id === nextWorkflowId) ||
        WORKFLOW_FALLBACKS.find((w) => w.id === nextWorkflowId) ||
        selectedWorkflow;

      if (shouldSendSizeOverride(workflowForSize)) {
        body.set("width", nextOrientation === "portrait" ? "720" : "1280");
        body.set("height", nextOrientation === "portrait" ? "1280" : "720");
      }

      const workflowHay = `${nextWorkflowId} ${item.meta?.workflowTitle || ""}`.toLowerCase();

      const needsVideoSource =
        workflowHay.includes("extend a video") ||
        workflowHay.includes("video_to_video") ||
        workflowHay.includes("video-to-video");

      const needsImageSource =
        !needsVideoSource &&
        (
          workflowHay.includes("edit") ||
          workflowHay.includes("ltx") ||
          workflowHay.includes("animate") ||
          workflowHay.includes("image_to_video") ||
          workflowHay.includes("image-to-video") ||
          workflowHay.includes("image-edit")
        );

      if (needsVideoSource) {
        const isVideo = Boolean(item.video || item.kind === "video");
        if (!isVideo) {
          throw new Error("Redo for this workflow requires a source video.");
        }

        const sourceFile = await fetchGalleryItemAsFile(item, "gallery-video-source");
        body.set("videoA", sourceFile);
      } else if (needsImageSource) {
        const isImage = !item.video && item.kind !== "video";
        if (!isImage) {
          throw new Error("Redo for this workflow requires a source image.");
        }

        const sourceFile = await fetchGalleryItemAsFile(item, "gallery-image-source");
        body.set("imageA", sourceFile);
      }

      if (isFirstLastImageVideoWorkflowSelected && lastFrameFileRef.current) {
        body.set("imageB", lastFrameFileRef.current);
      }

      if (isFirstLastImageVideoWorkflowSelected) {
        body.set("workflowId", "presets/Create First Image to Last Image Video");
        body.set("workflow", "presets/Create First Image to Last Image Video");
        if (uploadedFileRef.current) {
          body.set("imageA", uploadedFileRef.current);
        }
        if (lastFrameFileRef.current) {
          body.set("imageB", lastFrameFileRef.current);
        }
      }
      await submitToComfy(body);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Redo failed."
      );
    } finally {
      finishGalleryAction();
    }
  }

  async function handleGalleryExtend(item: GalleryItem) {
    const isVideo = Boolean(item.video || item.kind === "video");
    if (!isVideo) {
      setStatusMessage("Only videos can be extended.");
      return;
    }

    const fileName = getGalleryItemKey(item);
    if (!fileName) {
      setStatusMessage("Missing gallery item name.");
      return;
    }

    if (!canStartGalleryAction()) return;

    beginGalleryAction(fileName, "extend-prepare");
    setStatusMessage("");

    if (isFirstLastImageVideoWorkflowSelected && (!uploadedFileRef.current || !lastFrameFileRef.current)) {
      setStatusMessage("Upload both a first image and a last image first.");
      return;
    }

    try {
      const body = new FormData();
      body.set("name", fileName);
      body.set("scope", String(item.source || "user"));

      const res = await fetch("/api/gallery/extend/prepare", {
        method: "POST",
        body,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Could not prepare the video extension frame.");
      }

      const nextOrientation = data?.video?.orientation === "portrait" ? "portrait" : "landscape";
      const nextDuration = clampDuration(Number(data?.defaults?.durationSeconds || 8));
      const nextPositive = String(data?.defaults?.positivePrompt || item.meta?.positivePrompt || "").trim();
      const nextNegative = String(data?.defaults?.negativePrompt || item.meta?.negativePrompt || "").trim();
      const nextFrameUrl = String(data?.frame?.url || "").trim();
      const nextFrameName = String(data?.frame?.name || `${fileName.replace(/\.[^/.]+$/, "")}-tail-frame.png`).trim();

      if (!nextFrameUrl) {
        throw new Error("Extend prepare did not return a usable last-frame preview.");
      }

      setExtendModal({
        item,
        frameUrl: nextFrameUrl,
        frameName: nextFrameName,
        orientation: nextOrientation,
        positivePrompt: nextPositive,
        negativePrompt: nextNegative,
        durationSeconds: nextDuration,
        enhancing: false,
      });
      setStatusMessage("Last frame ready. Review the prompt and press Extend.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Video extend prepare failed.");
    } finally {
      finishGalleryAction();
    }
  }

  function handleGalleryEdit(item: GalleryItem) {

    const isImage = !item.video && item.kind !== "video";
    if (!isImage) {
      setStatusMessage("Only pictures can be edited.");
      return;
    }

    setEditModal({
      item,
      positivePrompt: String(item.meta?.positivePrompt || "").trim(),
      negativePrompt: String(item.meta?.negativePrompt || "").trim(),
      enhancing: false,
    });
  }

    async function handleEnhanceEditModal() {
    if (!editModal) return;
    if (!editModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt to enhance.");
      return;
    }

    setEditModal((prev) => (prev ? { ...prev, enhancing: true } : prev));
    setStatusMessage("");

    try {
      const nextPrompt = await enhancePromptWithVision(
        editModal.item,
        editModal.positivePrompt,
        editModal.negativePrompt,
        "edit"
      );

      setEditModal((prev) => (prev ? { ...prev, positivePrompt: nextPrompt, enhancing: false } : prev));
      setStatusMessage("Edit prompt enhanced from the image.");
    } catch (error) {
      setEditModal((prev) => (prev ? { ...prev, enhancing: false } : prev));
      setStatusMessage(error instanceof Error ? error.message : "Edit prompt enhancement failed.");
    }
  }

    async function submitGalleryEdit() {
    if (!editModal) return;

    const fileName = getGalleryItemKey(editModal.item);
    if (!fileName) {
      setStatusMessage("Missing gallery item name.");
      return;
    }

    if (!editModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt for the edit.");
      return;
    }

    if (!canStartGalleryAction()) return;

    beginGalleryAction(fileName, "edit-submit");

    try {
      const sourceFile = await fetchGalleryItemAsFile(editModal.item, "gallery-edit-source");
      if (!sourceFile) {
        throw new Error("Could not build the source image file.");
      }

      const body = new FormData();
      body.set("workflowId", GALLERY_EDIT_WORKFLOW_ID);
      body.set("prompt", editModal.positivePrompt.trim());
      body.set("negativePrompt", editModal.negativePrompt.trim());
      body.set("orientation", orientation);
      body.set("durationSeconds", String(durationSeconds));
      body.set("gpuTarget", gpuTarget);
      body.set("seed", String(randomSeed()));
      if (isAnimeImagesWorkflowSelected) {
        body.set("width", orientation === "portrait" ? "720" : "1280");
        body.set("height", orientation === "portrait" ? "1280" : "720");
        body.delete("durationSeconds");
        body.set("requestKind", "anime-image");
      }
      body.set("imageA", sourceFile, sourceFile.name);

      if (!body.has("imageA")) {
        throw new Error("Edit submission is missing imageA.");
      }

      body.set("width", orientation === "portrait" ? "720" : "1280");
      body.set("height", orientation === "portrait" ? "1280" : "720");

      if (isFirstLastImageVideoWorkflowSelected && lastFrameFileRef.current) {
        body.set("imageB", lastFrameFileRef.current);
      }

      if (isFirstLastImageVideoWorkflowSelected) {
        body.set("workflowId", "presets/Create First Image to Last Image Video");
        body.set("workflow", "presets/Create First Image to Last Image Video");
        if (uploadedFileRef.current) {
          body.set("imageA", uploadedFileRef.current);
        }
        if (lastFrameFileRef.current) {
          body.set("imageB", lastFrameFileRef.current);
        }
      }
      await submitToComfy(body);
      setEditModal(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Edit submission failed.");
    } finally {
      finishGalleryAction();
    }
  }

  function handleGalleryAnimate(item: GalleryItem) {
    const isImage = !item.video && item.kind !== "video";
    if (!isImage) {
      setStatusMessage("Only pictures can be animated.");
      return;
    }

    setAnimateModal({
      item,
      positivePrompt: String(item.meta?.positivePrompt || "").trim(),
      negativePrompt: String(item.meta?.negativePrompt || "").trim(),
      durationSeconds: 8,
      enhancing: false,
    });
  }

    async function handleEnhanceAnimateModal() {
    if (!animateModal) return;
    if (!animateModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt to enhance.");
      return;
    }

    setAnimateModal((prev) => (prev ? { ...prev, enhancing: true } : prev));
    setStatusMessage("");

    try {
      const nextPrompt = await enhancePromptWithVision(
        animateModal.item,
        animateModal.positivePrompt,
        animateModal.negativePrompt,
        "animate",
        animateModal.durationSeconds
      );

      setAnimateModal((prev) => (prev ? { ...prev, positivePrompt: nextPrompt, enhancing: false } : prev));
      setStatusMessage("Animate prompt enhanced from the image.");
    } catch (error) {
      setAnimateModal((prev) => (prev ? { ...prev, enhancing: false } : prev));
      setStatusMessage(error instanceof Error ? error.message : "Animate prompt enhancement failed.");
    }
  }

    async function submitGalleryAnimate() {
    if (!animateModal) return;

    const fileName = getGalleryItemKey(animateModal.item);
    if (!fileName) {
      setStatusMessage("Missing gallery item name.");
      return;
    }

    if (!animateModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt for animation.");
      return;
    }

    if (!canStartGalleryAction()) return;

    beginGalleryAction(fileName, "animate-submit");

    try {
      const sourceFile = await fetchGalleryItemAsFile(animateModal.item, "gallery-animate-source");
      if (!sourceFile) {
        throw new Error("Could not build the source image file.");
      }

      const body = new FormData();
      body.set("workflowId", GALLERY_ANIMATE_WORKFLOW_ID);
      body.set("prompt", animateModal.positivePrompt.trim());
      body.set("negativePrompt", animateModal.negativePrompt.trim());
      body.set("orientation", orientation);
      body.set("durationSeconds", String(clampDuration(animateModal.durationSeconds)));
      body.set("gpuTarget", gpuTarget);
      body.set("seed", String(randomSeed()));
      if (isAnimeImagesWorkflowSelected) {
        body.set("width", orientation === "portrait" ? "720" : "1280");
        body.set("height", orientation === "portrait" ? "1280" : "720");
        body.delete("durationSeconds");
        body.set("requestKind", "anime-image");
      }
      body.set("imageA", sourceFile, sourceFile.name);

      if (!body.has("imageA")) {
        throw new Error("Animate submission is missing imageA.");
      }

      if (isFirstLastImageVideoWorkflowSelected && lastFrameFileRef.current) {
        body.set("imageB", lastFrameFileRef.current);
      }

      if (isFirstLastImageVideoWorkflowSelected) {
        body.set("workflowId", "presets/Create First Image to Last Image Video");
        body.set("workflow", "presets/Create First Image to Last Image Video");
        if (uploadedFileRef.current) {
          body.set("imageA", uploadedFileRef.current);
        }
        if (lastFrameFileRef.current) {
          body.set("imageB", lastFrameFileRef.current);
        }
      }
      await submitToComfy(body);
      setAnimateModal(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Animate submission failed.");
    } finally {
      finishGalleryAction();
    }
  }

  async function handleEnhanceExtendModal() {
    if (!extendModal) return;
    if (!extendModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt to enhance.");
      return;
    }

    setExtendModal((prev) => (prev ? { ...prev, enhancing: true } : prev));
    setStatusMessage("");

    try {
      const imageFile = await fetchUrlAsFile(extendModal.frameUrl, extendModal.frameName || "extend-tail-frame.jpg", preferredImageMimeTypeFromName(extendModal.frameName));
      const instruction = [
        "You are refining an image-to-video prompt.",
        "Analyze the attached source image and the user's requested video continuation.",
        "This image is the last frame of an existing video. Preserve subject identity, framing continuity, lighting continuity, and temporal continuity unless the user explicitly requests a change.",
        "Return one improved positive prompt only, optimized for image-to-video generation.",
        `User request: ${extendModal.positivePrompt.trim() || "No request provided."}`,
        `Negative context: ${extendModal.negativePrompt.trim() || "None."}`,
        `Duration seconds: ${clampDuration(extendModal.durationSeconds)}`,
      ].join("\n");

      const body = new FormData();
      body.set(
        "messages",
        JSON.stringify([
          {
            role: "user",
            content: instruction,
          },
        ])
      );
      body.set("image", imageFile);

      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        body,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Vision enhance failed");
      }

      const nextPrompt = typeof data?.message === "string" ? data.message.trim() : "";
      if (!nextPrompt) {
        throw new Error("Vision enhancement returned an empty prompt.");
      }

      setExtendModal((prev) => (prev ? { ...prev, positivePrompt: nextPrompt, enhancing: false } : prev));
      setStatusMessage("Extend prompt enhanced from the last frame.");
    } catch (error) {
      setExtendModal((prev) => (prev ? { ...prev, enhancing: false } : prev));
      setStatusMessage(error instanceof Error ? error.message : "Extend prompt enhancement failed.");
    }
  }

  async function submitGalleryExtend() {
    if (!extendModal) return;

    const fileName = getGalleryItemKey(extendModal.item);
    if (!fileName) {
      setStatusMessage("Missing gallery item name.");
      return;
    }

    if (!extendModal.positivePrompt.trim()) {
      setStatusMessage("Enter a positive prompt for the video extension.");
      return;
    }

    if (!canStartGalleryAction()) return;

    beginGalleryAction(fileName, "extend-submit");

    try {
      const sourceFile = await fetchUrlAsFile(extendModal.frameUrl, extendModal.frameName || "extend-tail-frame.jpg", preferredImageMimeTypeFromName(extendModal.frameName));
      if (!sourceFile) {
        throw new Error("Could not build the prepared last-frame file.");
      }

      const extendRequestId = makeExtendRequestId();
      const extendTitle = buildGalleryExtendTitle(fileName);
      const extendMeta = {
        preset: GALLERY_ANIMATE_WORKFLOW_ID,
        workflowId: GALLERY_ANIMATE_WORKFLOW_ID,
        workflowLabel: "Gallery Extend",
        title: extendTitle,
        requestKind: "gallery-extend",
        extendRequestId,
        sourceType: "gallery-extend",
        extendedFromName: fileName,
        extendSourceFrame: "tail-frame",
        extendMode: "last-frame-continue",
        requestOrigin: "gallery-extend-modal",
      } as const;

      const body = new FormData();
      body.set("preset", extendMeta.preset);
      body.set("workflowId", extendMeta.workflowId);
      body.set("workflowLabel", extendMeta.workflowLabel);
      body.set("title", extendMeta.title);
      body.set("requestKind", extendMeta.requestKind);
      body.set("extendRequestId", extendMeta.extendRequestId);
      body.set("prompt", extendModal.positivePrompt.trim());
      body.set("positivePrompt", extendModal.positivePrompt.trim());
      body.set("negativePrompt", extendModal.negativePrompt.trim());
      body.set("orientation", extendModal.orientation);
      body.set("durationSeconds", String(clampDuration(extendModal.durationSeconds)));
      body.set("seed", String(randomSeed()));
      if (isAnimeImagesWorkflowSelected) {
        body.set("width", orientation === "portrait" ? "720" : "1280");
        body.set("height", orientation === "portrait" ? "1280" : "720");
        body.delete("durationSeconds");
        body.set("requestKind", "anime-image");
      }
      body.set("imageA", sourceFile, sourceFile.name);
      body.set("sourceType", extendMeta.sourceType);
      body.set("extendedFromName", extendMeta.extendedFromName);
      body.set("extendSourceFrame", extendMeta.extendSourceFrame);
      body.set("extendMode", extendMeta.extendMode);
      body.set("requestOrigin", extendMeta.requestOrigin);
      body.set("otgMeta", JSON.stringify(extendMeta));

      await submitToComfy(body, {
        expectedRequestKind: "gallery-extend",
        expectedSourceType: "gallery-extend",
        expectedWorkflowId: GALLERY_ANIMATE_WORKFLOW_ID,
        successMessage: "Video continuation submitted from the prepared last frame.",
      });
      setExtendModal(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Extend submission failed.");
    } finally {
      finishGalleryAction();
    }
  }

  function pushPromptUndoSnapshot(value: string) {
    setPromptUndoStack((prev) => {
      if ((prev[prev.length - 1] ?? null) === value) return prev;
      const next = [...prev, value];
      return next.length > 40 ? next.slice(next.length - 40) : next;
    });
  }

  function pushNegativePromptUndoSnapshot(value: string) {
    setNegativePromptUndoStack((prev) => {
      if ((prev[prev.length - 1] ?? null) === value) return prev;
      const next = [...prev, value];
      return next.length > 40 ? next.slice(next.length - 40) : next;
    });
  }

  function handleClearPrompt() {
    if (!prompt) return;
    pushPromptUndoSnapshot(prompt);
    setPrompt("");
    setPromptAssessmentOpen(false);
    setPromptAssessment(null);
    setStatusMessage("Prompt cleared.");
  }

  function handleUndoPrompt() {
    setPromptUndoStack((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const restore = next.pop() ?? "";
      setPrompt(restore);
      setPromptAssessmentOpen(false);
      setPromptAssessment(null);
      setStatusMessage("Prompt restored.");
      return next;
    });
  }

  function handleClearNegativePrompt() {
    if (!negativePrompt) return;
    pushNegativePromptUndoSnapshot(negativePrompt);
    setNegativePrompt("");
    setStatusMessage("Negative prompt cleared.");
  }

  function handleUndoNegativePrompt() {
    setNegativePromptUndoStack((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const restore = next.pop() ?? "";
      setNegativePrompt(restore);
      setStatusMessage("Negative prompt restored.");
      return next;
    });
  }

  async function handleEnhancePrompt() {
    if (!prompt.trim() || enhancing) return;

    setEnhancing(true);
    setStatusMessage("");
    try {
      const nextPrompt = await enhancePromptText(prompt, selectedWorkflow.id, {
        styleLabel: activeGenerateStylePreset?.label || "",
        stylePrompt: activeGenerateStyleGuidance,
        mode: isVideoWorkflowSelected ? "video" : "image",
      });
      pushPromptUndoSnapshot(prompt);
      setPrompt(nextPrompt);
      setPromptAssessmentOpen(false);
      setPromptAssessment(null);
      setStatusMessage("Prompt enhanced.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Enhance Prompt failed");
    } finally {
      setEnhancing(false);
    }
  }

  async function handlePromptBuilderAssistant() {
    if (!prompt.trim() || formattingPrompt || !showPromptBuilderAssistant) return;

    setFormattingPrompt(true);
    setStatusMessage("");
    try {
      const assessment = buildPromptAssessment({
        prompt: prompt.trim(),
        mode: currentPromptGuideMode,
        hasStarterImage: Boolean(uploadedFileRef.current),
        starterImageMeta: uploadedImageMeta,
        styleLabel: activeGenerateStylePreset?.label || "",
      });
      setPromptAssessment(assessment);
      setPromptAssessmentOpen(true);
      setStatusMessage("Prompt Builder Assistant reviewed the prompt.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Prompt Builder Assistant failed");
    } finally {
      setFormattingPrompt(false);
    }
  }

  function handleGenerateStyleDropdownChange(nextId: string) {
    const normalized = String(nextId || "").trim();
    if (!normalized) {
      if (activeGenerateStylePreset) {
        setActiveGenerateStyleId("");
        setStatusMessage(`${activeGenerateStylePreset.label} preset cleared.`);
      }
      return;
    }

    const preset = GENERATE_STYLE_PRESETS.find((item) => item.id === normalized);
    if (!preset) return;
    applyGenerateStylePreset(preset);
  }

  async function transcribeAudioBlob(blob: Blob) {
    const body = new FormData();
    body.set("audio", new File([blob], `otg-${Date.now()}.webm`, { type: blob.type || "audio/webm" }));

    const res = await fetch("/api/ollama-ai/transcribe", {
      method: "POST",
      body,
      credentials: "include",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      throw new Error(typeof data?.detail === "string" ? data.detail : typeof data?.error === "string" ? data.error : "Transcription failed");
    }

    return typeof data?.text === "string" ? data.text.trim() : "";
  }

  async function handleMicClick(target: MicTarget, applyText: (text: string) => void) {
    if (recordingTarget && recordingTarget !== target) {
      setStatusMessage("Finish the current recording first.");
      return;
    }

    if (recordingTarget === target && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusMessage("This browser does not support microphone capture.");
      return;
    }

    try {
      setStatusMessage("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      setRecordingTarget(target);

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        stopMicCapture();
        setRecordingTarget("");
        setTranscribingTarget("");
        setStatusMessage("Microphone recording failed.");
      };

      recorder.onstop = async () => {
        const chunks = [...audioChunksRef.current];
        stopMicCapture();
        setRecordingTarget("");

        if (!chunks.length) {
          setStatusMessage("No audio captured.");
          return;
        }

        setTranscribingTarget(target);
        setStatusMessage("Transcribing...");

        try {
          const blob = new Blob(chunks, { type: "audio/webm" });
          const transcript = await transcribeAudioBlob(blob);
          if (!transcript) {
            throw new Error("No transcript returned.");
          }
          applyText(transcript);
          setStatusMessage("Transcription added.");
        } catch (error) {
          setStatusMessage(error instanceof Error ? error.message : "Transcription failed.");
        } finally {
          setTranscribingTarget("");
        }
      };

      recorder.start();
      setStatusMessage("Recording...");
    } catch (error) {
      stopMicCapture();
      setRecordingTarget("");
      setTranscribingTarget("");
      setStatusMessage(error instanceof Error ? error.message : "Microphone access failed.");
    }
  }


  async function handleSettingsCheckComfy() {
    if (settingsComfyBusy) return;

    setSettingsComfyBusy(true);
    setStatusMessage("Checking Comfy connection...");
    try {
      const res = await fetch("/api/comfy-status", {
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      const ok = Boolean(res.ok && (data?.serverState === "idle" || data?.serverHint === "Connected" || data?.connected || data?.ok));
      const baseUrl = typeof data?.comfyBaseUrl === "string" ? data.comfyBaseUrl : "";

      setConnected(ok);
      setSettingsComfyBaseUrl(baseUrl);
      setSettingsComfyCheckedAt(new Date().toLocaleString());
      setStatusMessage(ok ? "Comfy connection verified." : "Comfy connection failed.");
      if (typeof data?.serverHint === "string" && data.serverHint.trim()) {
        setStatusMessage(ok ? `Comfy connected: ${data.serverHint.trim()}.` : `Comfy disconnected: ${data.serverHint.trim()}.`);
      }
    } catch (error) {
      setConnected(false);
      setSettingsComfyCheckedAt(new Date().toLocaleString());
      setStatusMessage(error instanceof Error ? error.message : "Comfy connection check failed.");
    } finally {
      setSettingsComfyBusy(false);
    }
  }

  async function handleSettingsClearPipeline() {
    if (settingsPipelineBusy) return;

    setSettingsPipelineBusy(true);
    setSettingsPipelineMessage("Clearing current pipeline state...");
    setStatusMessage("Clearing current pipeline state...");
    try {
      const res = await fetch("/api/content/clear", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(String(data?.error || `Clear failed with status ${res.status}.`));
      }

      setProgressStatus("idle");
      setProgressQueue(0);
      setProgressPercent(0);
      setActivePromptId("");
      setLatestPreviewUrl("");
      setLatestPreviewName("");
      setLatestPreviewKind("");
      setLatestPreviewMeta(null);
      setSettingsPipelineMessage("Pipeline state cleared. Gallery and Favorites were not deleted.");
      setStatusMessage("Pipeline state cleared.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pipeline clear failed.";
      setSettingsPipelineMessage(message);
      setStatusMessage(message);
    } finally {
      setSettingsPipelineBusy(false);
    }
  }

  function handleSettingsClearLocalState() {
    try {
      window.localStorage.removeItem(APP_STATE_KEY);
      setSettingsLocalMessage("Local UI state cleared. Server files, Gallery, Favorites, and Production projects were not deleted.");
      setStatusMessage("Local UI state cleared.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local UI state clear failed.";
      setSettingsLocalMessage(message);
      setStatusMessage(message);
    }
  }

  function handleThemeChange(nextThemeId: AppThemeId) {
    setAppThemeId(nextThemeId);
    const label = APP_THEME_OPTIONS.find((theme) => theme.id === nextThemeId)?.label || "selected";
    setSettingsAppearanceMessage(`Theme changed to ${label}.`);
  }

  function handleFontScaleChange(nextFontScale: AppFontScale) {
    setAppFontScale(nextFontScale);
    const label = APP_FONT_SCALE_OPTIONS.find((option) => option.id === nextFontScale)?.label || "selected";
    setSettingsAppearanceMessage(`Font size changed to ${label}.`);
  }

  function handleUiModeChange(nextUiMode: AppUiMode) {
    setAppUiMode(nextUiMode);
    const label = APP_UI_MODE_OPTIONS.find((option) => option.id === nextUiMode)?.label || "selected";
    setSettingsAppearanceMessage(`${label} UI enabled. You can switch back here any time.`);
  }

  async function handleChangePassword() {
    if (passwordBusy) return;

    const nextPassword = passwordNew.trim();
    if (!passwordCurrent || !nextPassword || !passwordConfirm) {
      setPasswordMessage("Current password, new password, and confirmation are required.");
      return;
    }
    if (nextPassword !== passwordConfirm) {
      setPasswordMessage("New password and confirmation do not match.");
      return;
    }
    if (nextPassword.length < 10) {
      setPasswordMessage("New password must be at least 10 characters.");
      return;
    }

    setPasswordBusy(true);
    setPasswordMessage("Updating password...");
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
        body: JSON.stringify({
          currentPassword: passwordCurrent,
          newPassword: nextPassword,
          confirmPassword: passwordConfirm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(String(data?.error || `Password update failed with status ${res.status}.`));
      }

      setPasswordCurrent("");
      setPasswordNew("");
      setPasswordConfirm("");
      setPasswordMessage("Password changed. Use the new password next time you sign in.");
      setStatusMessage("Password changed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Password update failed.";
      setPasswordMessage(message);
      setStatusMessage(message);
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteAccountBusy) return;

    if (!deletePassword.trim()) {
      setDeleteAccountMessage("Password is required before deleting the account.");
      return;
    }
    if (deleteConfirmText.trim() !== "DELETE") {
      setDeleteAccountMessage('Type DELETE to confirm account deletion.');
      return;
    }

    setDeleteAccountBusy(true);
    setDeleteAccountMessage("Deleting account...");
    try {
      const res = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
        body: JSON.stringify({ password: deletePassword, confirmText: deleteConfirmText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(String(data?.error || `Account deletion failed with status ${res.status}.`));
      }

      setDeleteAccountMessage("Account deleted. Redirecting to login...");
      window.location.href = "/login?reason=account-deleted";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Account deletion failed.";
      setDeleteAccountMessage(message);
      setStatusMessage(message);
    } finally {
      setDeleteAccountBusy(false);
    }
  }

  async function handleLogout() {
    if (logoutBusy) return;

    setLogoutBusy(true);
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      }).catch(() => null);

      window.location.href = "/login";
    } finally {
      setLogoutBusy(false);
    }
  }

  function copyText(text: string) {
    void navigator.clipboard?.writeText(text || "");
    setStatusMessage("Copied.");
  }

  function sendTextToGenerate(text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;

    pushPromptUndoSnapshot(prompt);
    setPrompt((prev) => (prev.trim() ? `${prev.trim()}\n\n${cleaned}` : cleaned));
    setTab("generate");
    setStatusMessage("Sent to Generate.");
  }

  async function handleDescribe() {
    if (!describeFileRef.current) {
      setStatusMessage("Choose an image first.");
      return;
    }

    setDescribeBusy(true);
    setStatusMessage("");

    try {
      const instruction =
        describeMode === "background"
          ? "Describe only the background scene in direct visual detail for prompt writing."
          : "Describe the person's identity, face, hair, clothing, and distinguishing features in direct visual detail for prompt writing.";

      const body = new FormData();
      body.set(
        "messages",
        JSON.stringify([
          {
            role: "user",
            content: instruction,
          },
        ])
      );
      body.set("image", describeFileRef.current);

      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        body,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Describe failed");
      }

      const output = typeof data?.message === "string" ? data.message.trim() : "";
      setDescribeOutput(output || "No description returned.");
      setStatusMessage("Description created.");
    } catch (error) {
      setDescribeOutput("");
      setStatusMessage(error instanceof Error ? error.message : "Describe failed.");
    } finally {
      setDescribeBusy(false);
    }
  }


  function handleEnhanceImageSelect(file: File | null) {
    if (enhanceImagePreviewUrl) {
      try {
        URL.revokeObjectURL(enhanceImagePreviewUrl);
      } catch {
        // ignore
      }
    }

    if (!file) {
      setEnhanceImageFile(null);
      setEnhanceImageName("");
      setEnhanceImagePreviewUrl("");
      setEnhanceImageInputKey((prev) => prev + 1);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setEnhanceImageFile(file);
    setEnhanceImageName(file.name || "");
    setEnhanceImagePreviewUrl(nextUrl);
  }

  function clearEnhanceImage() {
    if (enhanceImagePreviewUrl) {
      try {
        URL.revokeObjectURL(enhanceImagePreviewUrl);
      } catch {
        // ignore
      }
    }

    setEnhanceImageFile(null);
    setEnhanceImageName("");
    setEnhanceImagePreviewUrl("");
    setEnhanceImageInputKey((prev) => prev + 1);
  }

  async function handleEnhanceDraft() {
    if (!enhanceDraft.trim() || enhanceDraftBusy) return;

    setEnhanceDraftBusy(true);
    setStatusMessage("");

    try {
      const lengthInstruction =
        enhanceLength === "short"
          ? "Keep it short: 1 to 2 sentences, compact and direct."
          : enhanceLength === "long"
            ? "Make it long: 4 to 6 detailed sentences with richer cinematic detail."
            : "Keep it normal length: about 2 to 3 sentences, balanced detail.";

      const workflowHint = selectedWorkflow?.title || selectedWorkflow?.id || "generate";

      const userMessage = [
        "You are improving a text prompt for image or video generation.",
        enhanceImageFile
          ? "Use the attached image as visual context and strengthen the user's prompt to better match or build from that image."
          : "No image is attached. Improve the prompt using text only.",
        "Preserve the user's core intent.",
        "Make the result more vivid, visually clear, and generation-ready.",
        lengthInstruction,
        "Return only the final enhanced prompt.",
        "Do not return bullets, labels, quotes, explanations, or markdown.",
        `Workflow hint: ${workflowHint}`,
        `User draft: ${enhanceDraft.trim()}`
      ].join("\n");

      const body = new FormData();
      body.set(
        "messages",
        JSON.stringify([
          {
            role: "user",
            content: userMessage,
          },
        ])
      );

      if (enhanceImageFile) {
        body.set("image", enhanceImageFile);
      }

      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        body,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Enhance Prompt failed");
      }

      const nextPrompt = typeof data?.message === "string" ? data.message.trim() : "";
      if (!nextPrompt) {
        throw new Error("Empty enhancement response");
      }

      setEnhanceDraft(nextPrompt);
      setStatusMessage(enhanceImageFile ? "Prompt enhanced with image context." : "Prompt enhanced.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Enhance Prompt failed");
    } finally {
      setEnhanceDraftBusy(false);
    }
  }

  function revokeScenePreview(url: string) {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  function setSceneReference(
    slot: "char1" | "char2" | "char3" | "bg",
    file: File | null
  ) {
    clearSceneReferenceAnalysis(slot);
    if (slot === "char1") {
      revokeScenePreview(sceneChar1PreviewUrl);
      if (!file) {
        setSceneChar1File(null);
        setSceneChar1Name("");
        setSceneChar1PreviewUrl("");
        setSceneChar1InputKey((prev) => prev + 1);
        return;
      }
      setSceneChar1File(file);
      setSceneChar1Name(file.name || "");
      setSceneChar1PreviewUrl(URL.createObjectURL(file));
      return;
    }

    if (slot === "char2") {
      revokeScenePreview(sceneChar2PreviewUrl);
      if (!file) {
        setSceneChar2File(null);
        setSceneChar2Name("");
        setSceneChar2PreviewUrl("");
        setSceneChar2InputKey((prev) => prev + 1);
        return;
      }
      setSceneChar2File(file);
      setSceneChar2Name(file.name || "");
      setSceneChar2PreviewUrl(URL.createObjectURL(file));
      return;
    }

    if (slot === "char3") {
      revokeScenePreview(sceneChar3PreviewUrl);
      if (!file) {
        setSceneChar3File(null);
        setSceneChar3Name("");
        setSceneChar3PreviewUrl("");
        setSceneChar3InputKey((prev) => prev + 1);
        return;
      }
      setSceneChar3File(file);
      setSceneChar3Name(file.name || "");
      setSceneChar3PreviewUrl(URL.createObjectURL(file));
      return;
    }

    revokeScenePreview(sceneBgPreviewUrl);
    if (!file) {
      setSceneBgFile(null);
      setSceneBgName("");
      setSceneBgPreviewUrl("");
      setSceneBgInputKey((prev) => prev + 1);
      return;
    }
    setSceneBgFile(file);
    setSceneBgName(file.name || "");
    setSceneBgPreviewUrl(URL.createObjectURL(file));
  }

  async function resizeImageFileToBase64(file: File, maxDimension = 768): Promise<string> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImg = new Image();
        nextImg.onload = () => resolve(nextImg);
        nextImg.onerror = () => reject(new Error("Failed to load image."));
        nextImg.src = objectUrl;
      });

      const width = img.naturalWidth || img.width || maxDimension;
      const height = img.naturalHeight || img.height || maxDimension;
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      const outW = Math.max(1, Math.round(width * scale));
      const outH = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to prepare image canvas.");
      }

      ctx.drawImage(img, 0, 0, outW, outH);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
      const commaIndex = dataUrl.indexOf(",");
      if (commaIndex < 0) {
        throw new Error("Failed to encode image.");
      }

      return dataUrl.slice(commaIndex + 1);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function buildSceneVisionContext() {
    return sceneReferenceImageCard.trim();
  }


  const SCENE_TUTORIAL_EXAMPLES = {
    example1: {
      title: "Example 1 - Mother Chases the Ice Cream Truck",
      imageSrc: "/tutorial/ltx-key-aspects-1.jpg",
      videoSrc: "/tutorial/example-1.mp4",
      positivePrompt:
        "A realistic cinematic disaster scene, 15-second video. Establishing wide shot of a suburban neighborhood in chaos during an Armageddon meteor strike, fiery meteors tearing through the sky, smoke, ash, distant explosions, flashing emergency lights, terrified people running for cover. A desperate young mother rides a bicycle at full speed down the street, shouting that her child still needs a SpongeBob ice cream cone before the truck gets away. The ice cream truck races ahead, swerving through debris and cracked pavement, trying to flee the destruction as fast as possible. Hard cut to a tighter side tracking shot of the mother pedaling furiously, hair whipping in the wind, face filled with panic, determination, and absurd urgency, gripping the handlebars while dodging falling debris. Hard cut to a rear three-quarter shot of the speeding ice cream truck bouncing over broken asphalt, its bright cartoon decals contrasting against the apocalyptic sky, the driver focused on escape. Hard cut to a near-catch moment as the mother closes the distance, reaching forward while meteors streak overhead and burning fragments slam into the street behind her. Dramatic realistic lighting, high tension, fast motion, cinematic framing, clear action progression, visible emotion, strong environmental detail, intense disaster atmosphere, dynamic camera movement, desperate but darkly comedic tone, audible sirens, explosions, rumbling impacts, bicycle rattling, distant screaming, distorted ice cream truck music fading in and out.",
      negativePrompt:
        "low detail, blurry, soft focus, flat lighting, boring composition, weak action, no urgency, no bicycle motion, frozen pose, duplicated people, extra limbs, deformed hands, warped bicycle, broken wheels, distorted face, incorrect anatomy, bad perspective, low realism, muddy background, washed out colors, cartoon look, anime look, low contrast, empty street, peaceful atmosphere, no meteors, no destruction, no smoke, no debris, no emergency lights, no visible ice cream truck, unreadable action, random teleporting, scene changing to a different location, bad hard cuts, jumpy incoherent motion, broken continuity, text, watermark, logo, subtitles, UI overlays",
    },
    example2: {
      title: "Example 2 - Little Fish Finds Lost Turtle Friend",
      imageSrc: "/tutorial/ltx-key-aspects-2.jpg",
      videoSrc: "/tutorial/example-2.mp4",
      positivePrompt:
        "A 3D Pixar-style underwater adventure scene, 15-second video. Establishing shot of a colorful underwater reef with soft blue sunlight rays filtering through the ocean, drifting sea plants, coral formations, bubbles, and a gentle but emotional atmosphere. A small bright-orange fish searches anxiously for a lost turtle friend, swimming quickly through coral arches and around rocks, calling out with worried energy. Hard cut to a medium tracking shot following the little fish weaving through sea grass and coral, scanning every shadow, eyes wide with concern, fins moving fast, particles floating in the water, soft underwater ambience and distant whale-like calls. Hard cut to the frightened turtle hidden under a rock shelf, curled into a scared protective posture, trembling slightly in the dimmer blue-green shadow, eyes wide and uncertain, sand shifting softly beneath the shell. Hard cut to the fish discovering the turtle and slowing down carefully, hovering near the rock with relief and tenderness, the turtle recognizing the friend and relaxing as the lighting becomes warmer and more hopeful. Final emotional reunion beat in the same underwater environment, both characters framed together in a safe, heartwarming composition. Strong 3D animated family-film style, expressive character emotion, polished Pixar-inspired look, clear subject definition, soft cinematic lighting, readable action flow, emotional continuity, gentle camera movement, distinct hard cuts that keep the same ocean world while changing perspective and focus, ambient underwater sound, soft current movement, warm hopeful ending.",
      negativePrompt:
        "photorealistic style, live action, horror tone, dark muddy water, ugly characters, broken anatomy, extra fins, deformed eyes, distorted shell, blurry image, low detail, stiff animation, frozen poses, poor composition, flat lighting, empty background, no coral, no sea plants, no bubbles, no visible reef, aggressive shark-like design, random fish crowd, wrong species focus, turtle missing, fish missing, incoherent hard cuts, changing to a different world, changing to land, desert, city, broken continuity, glitchy motion, text, watermark, logo, subtitles, UI overlays",
    },
  } as const;

  function evaluateScenePromptStrength(input: string) {
    const cleaned = String(input || "").trim();
    if (!cleaned) {
      return {
        score: 0,
        rating: "weak",
        canGenerate: false,
        missing: ["subject", "setting", "action", "tone", "shot"],
        present: [],
      } as const;
    }

    const checks = [
      {
        key: "subject",
        pass: /\b(man|woman|person|boy|girl|character|mother|father|child|soldier|warrior|priest|king|queen|he|she|they|two men|two women|couple)\b/i.test(cleaned),
      },
      {
        key: "setting",
        pass: /\b(in|inside|outside|at|on|under|near|room|house|street|hallway|church|forest|desert|living room|kitchen|city|castle|bedroom|alley|office|temple|yard|apartment)\b/i.test(cleaned),
      },
      {
        key: "action",
        pass: /\b(walks?|runs?|turns?|looks?|grabs?|sits?|stands?|opens?|closes?|talks?|speaks?|shouts?|cries?|fights?|stops?|moves?|stares?|falls?|smiles?|leans?|argues?|pulls?|pushes?|kneels?|embraces?)\b/i.test(cleaned),
      },
      {
        key: "tone",
        pass: /\b(angry|sad|tense|calm|fearful|happy|emotional|dark|gentle|violent|dramatic|romantic|serious|sinister|mournful|hopeful|urgent|awkward|hostile|intimate)\b/i.test(cleaned),
      },
      {
        key: "shot",
        pass: /\b(close-up|wide shot|medium shot|over-the-shoulder|tracking shot|dolly|pan|tilt|frontal|profile|low angle|high angle|camera|shot|frame|framing|hard cut|reaction shot|reverse angle|continue shot|flashback|memory cut)\b/i.test(cleaned),
      },
    ];

    const present = checks.filter((item) => item.pass).map((item) => item.key);
    const missing = checks.filter((item) => !item.pass).map((item) => item.key);
    const score = present.length;

    let rating: "weak" | "usable" | "strong" = "weak";
    if (score >= 4) rating = "strong";
    else if (score >= 3) rating = "usable";

    const canGenerate = score >= 3 && present.includes("subject") && present.includes("action");

    return {
      score,
      rating,
      canGenerate,
      missing,
      present,
    } as const;
  }

  function evaluateTutorialPromptPreview(input: string) {
    const cleaned = String(input || "").trim();

    const checks = {
      establishShot: /\b(close-up|wide shot|medium shot|over-the-shoulder|tracking shot|dolly|pan|tilt|low angle|high angle|framing|shot|camera|hard cut|reaction shot|reverse angle)\b/i.test(cleaned),
      setScene: /\b(room|house|street|hallway|church|forest|desert|living room|kitchen|city|castle|bedroom|alley|office|temple|yard|apartment|underwater|reef|ocean|suburban|neighborhood)\b/i.test(cleaned),
      describeAction: /\b(walks?|runs?|turns?|looks?|grabs?|sits?|stands?|opens?|closes?|talks?|speaks?|shouts?|cries?|fights?|stops?|moves?|stares?|falls?|smiles?|leans?|argues?|pulls?|pushes?|kneels?|embraces?|chases?|searches?|finds?)\b/i.test(cleaned),
      defineCharacter: /\b(man|woman|person|boy|girl|character|mother|father|child|soldier|warrior|priest|king|queen|he|she|they|fish|turtle|young mother)\b/i.test(cleaned),
      cameraMovement: /\b(tracking shot|dolly|pan|tilt|close-up|wide shot|reverse angle|over-the-shoulder|hard cut|reaction shot|camera)\b/i.test(cleaned),
      describeAudio: /\b(audio|sound|music|sirens|explosions|voice|shouting|screaming|ambient|rumbling|speaker|whale|bubbles)\b/i.test(cleaned),
    };

    const score = Object.values(checks).filter(Boolean).length;
    let rating: "weak" | "usable" | "strong" = "weak";
    if (score >= 5) rating = "strong";
    else if (score >= 3) rating = "usable";

    return { checks, score, rating };
  }

  async function handleBuildSceneCard() {
    if (!sceneReferenceImageCard.trim()) {
      setStatusMessage("Run Reference Image for at least one slot first.");
      return;
    }

    if (!sceneDraft.trim()) {
      setStatusMessage("Enter the scene request first.");
      return;
    }

    const promptCheck = evaluateScenePromptStrength(sceneDraft);
    if (!promptCheck.canGenerate) {
      setStatusMessage(`Prompt too weak. Add: ${promptCheck.missing.join(", ")}.`);
      return;
    }

    if (scenePlanBusy) return;

    setScenePlanBusy(true);
    setStatusMessage("");
    try {
      const sceneVisionContext = await buildSceneVisionContext();
      const cleanedSceneDraft = stripTransitionIntentLines(sceneDraft);
      const transitionOption = getSceneTransitionOption(selectedTransitionMode);

      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                "You are building a persistent reference card for an LTX 2.3 scene generator.",
                "Return only the final reference card.",
                "Do not add commentary outside the card.",
                "Use these exact sections and in this order:",
                "Characters:",
                "Background:",
                "Style:",
                "Continuity Anchors:",
                "Transition Policy:",
                "Scene Intent:",
                "Continuity Notes:",
                "",
                "Reference handling rules:",
                "- Treat uploaded character images as identity anchors first: face, skin tone, age range, hair cues, build, and recognizable presence.",
                "- Separate identity continuity from wardrobe continuity. Preserve identity first. Only preserve clothing and accessories when they are continuity-critical and not contradicted by the current scene request.",
                "- If the scene request explicitly changes wardrobe, time period, church attire, age state, or styling, obey the scene request over the source image clothing.",
                "- If the scene implies a flashback or childhood memory, preserve recognizability across age states without forcing adult clothing onto child versions.",
                "- If multiple character slots appear to use the same source image or near-identical visual notes, do not collapse all roles into one duplicated person. Instead keep them as three distinct sisters or three distinct characters with believable family resemblance and differentiating cues.",
                "- Never assign the exact same literal image description to Character 1, Character 2, and Character 3 unless the user explicitly says they are identical or triplets.",
                "",
                "Reference card formatting rules:",
                "- Under Characters, keep each character role distinct and readable.",
                "- When relevant, describe present-day identity anchors separately from childhood or memory-state appearance logic.",
                "- Under Continuity Anchors, explicitly separate identity anchors from wardrobe/styling overrides when the scene request changes clothing or age state.",
                "- Under Transition Policy, state whether the request is a simple cut, same-location cut, reverse angle, reaction shot, location change, continue shot, or a temporal memory/flashback sequence.",
                "- If the draft contains present-day action, a memory beat, and a return to present, state that as a three-beat sequence rather than flattening it into one generic hard cut.",
                "",
                "Transition policy rules:",
                `- Active transition mode: ${transitionOption.label}.`,
                `- Transition helper intent: ${transitionOption.helper}`,
                "- Preserve location unless the user explicitly changes it.",
                "- Preserve character identity, spatial relationships, and screen direction when relevant.",
                "- Preserve lighting logic unless the user intentionally changes it.",
                "- If the active transition is Flashback / Memory Cut, mark it as a temporal shift rather than an ordinary same-moment cut.",
                "",
                "Scene sequencing rules:",
                "- If the request includes a present-day beat, a memory or flashback beat, and a return to present, make each beat visually explicit in order inside one flowing prompt.",
                "- For flashback or memory cuts, make the age-state change clear and readable on camera.",
                "- For return-to-present beats, re-establish the present-day framing and geography clearly instead of leaving the scene in the memory state.",
                "- If the prompt mentions a group like three sisters, keep all three present when requested and differentiate them through placement, movement, and family resemblance rather than generic duplication.",
                `Style request: ${sceneStyle.trim() || "realistic cinematic"}`,
                `Scene request: ${cleanedSceneDraft}`,
                "",
                "Reference Image Card:",
                sceneVisionContext || "No reference image analysis available.",
              ].join("\n"),
            },
          ],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Scene card build failed.");
      }

      const cardText = typeof data?.message === "string" ? data.message.trim() : "";
      if (!cardText) {
        throw new Error("Empty scene card response.");
      }

      setSceneReferenceCard(cardText);
      setScenePlan({ referenceCard: cardText });
      setSceneOutput("");
      setStatusMessage("Reference card built.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Scene card build failed.");
    } finally {
      setScenePlanBusy(false);
    }
  }


  async function handleCreateScene() {
    if (!sceneReferenceCard.trim()) {
      setStatusMessage("Build the Scene Card first.");
      return;
    }

    if (!sceneDraft.trim()) {
      setStatusMessage("Enter the scene request first.");
      return;
    }

    const promptCheck = evaluateScenePromptStrength(sceneDraft);
    if (!promptCheck.canGenerate) {
      setStatusMessage(`Prompt too weak. Add: ${promptCheck.missing.join(", ")}.`);
      return;
    }

    if (sceneWriteBusy) return;

    setSceneWriteBusy(true);
    setStatusMessage("");
    try {
      const previousScene = sceneOutput.trim();
      const cleanedSceneDraft = stripTransitionIntentLines(sceneDraft);
      const transitionOption = getSceneTransitionOption(selectedTransitionMode);

      const res = await fetch("/api/ollama-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                "You are writing one LTX 2.3-ready video scene prompt.",
                "Return only the final prompt as one flowing paragraph with no labels, bullets, markdown, or explanation.",
                "Write a concrete cinematic prompt, not a summary and not a screenplay.",
                "The prompt should usually read like 4 to 8 dense cinematic sentences in present tense.",
                "Start with framing and shot language, then environment, action, character physical behavior, camera behavior, lighting/style, continuity, and optional audio if requested.",
                "",
                "Continuity priorities:",
                "1. Current scene request",
                "2. Reference card continuity anchors",
                "3. Previous generated scene context",
                "4. Uploaded image identity anchors",
                "",
                "Critical continuity rules:",
                "- Preserve Character 1, Character 2, and Character 3 visual identity.",
                "- Keep multi-character roles distinct. Do not collapse three sisters into one duplicated person or repeat the same literal source-image description for all three roles.",
                "- Preserve wardrobe and accessories only when they are continuity-critical and not contradicted by the current scene request.",
                "- If the current scene request changes attire, age state, time period, church clothing, or child/adult presentation, obey the current scene request while keeping the characters recognizable.",
                "- Preserve background continuity unless the transition explicitly changes location.",
                "- Preserve lighting logic unless intentionally changed.",
                "- Preserve screen direction and spatial relationships where relevant.",
                "- Do not reuse the exact same framing unless the active transition is Continue Shot.",
                "",
                "Transition mode instructions:",
                `- Active transition mode: ${transitionOption.label}.`,
                `- Transition behavior: ${transitionOption.helper}`,
                sceneTemporalSequenceHint ? `- Sequence note: ${sceneTemporalSequenceHint}` : "- Sequence note: none.",
                "- Hard Cut: create a clear composition change and a new visual beat while preserving story continuity.",
                "- Same Location Hard Cut: keep the same environment and lighting logic, but noticeably change shot size, angle, emphasis, or blocking.",
                "- Location Change Cut: clearly establish the new environment while preserving narrative continuity and character identity.",
                "- Reaction Shot: focus on the responding character, preserve eyelines and geography, and make the emotional response visible through physical behavior.",
                "- Reverse Angle: preserve the same exchange and scene geography but flip to the opposite viewing perspective.",
                "- Continue Shot: continue the same active moment and momentum without making it feel like a disconnected new setup.",
                "- Flashback / Memory Cut: make the temporal shift clear, keep the same story-world continuity, and preserve recognizability across past and present versions.",
                "- If the request includes a return from memory back to the present scene, stage that return explicitly instead of blending the time states together.",
                "",
                "LTX-friendly behavior rules:",
                "- Use explicit framing like wide shot, medium shot, close-up, over-the-shoulder, side angle, rear three-quarter, or frontal composition when appropriate.",
                "- Use visible physical acting cues instead of abstract emotional labels by themselves.",
                "- Keep the prompt grounded in what the camera can see.",
                "- Avoid generic phrases like deep connection, heartfelt moment, beautiful scene, or warm atmosphere unless they are tied to visible evidence.",
                "- Avoid random scene drift, wardrobe drift, character swaps, or location drift.",
                "- If the request contains multiple beats, stage them in order with explicit visual transitions: beat 1, cut, beat 2, cut back, beat 3, while still returning one flowing paragraph.",
                "- For multi-character groups, keep each person distinguishable by role, placement, or behavior instead of repeating the same description three times.",
                "- For childhood memory beats, adapt the characters into child versions with recognizable family resemblance rather than cloning adult appearance or adult clothing onto children.",
                "- Use stronger shot logic: establish the first beat, make the cut read clearly, then re-establish the return beat with a changed but coherent composition.",
                "",
                `Style request: ${sceneStyle.trim() || "realistic cinematic"}`,
                "",
                "Reference Card:",
                sceneReferenceCard.trim(),
                "",
                "Current Scene Request:",
                cleanedSceneDraft,
                "",
                "Previous Scene Context:",
                previousScene || "None.",
              ].join("\n"),
            },
          ],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Create Scene failed.");
      }

      const nextScene = typeof data?.message === "string" ? data.message.trim() : "";
      if (!nextScene) {
        throw new Error("Empty scene output response.");
      }

      setSceneOutput(nextScene);
      setStatusMessage("Scene created.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Create Scene failed.");
    } finally {
      setSceneWriteBusy(false);
    }
  }


  async function handleSceneBuild() {
    await handleBuildSceneCard();
  }
  async function handleAskAi() {
    if ((!askInput.trim() && !askImageRef.current) || askBusy) return;

    setAskBusy(true);
    setStatusMessage("");

    try {
      let res: Response;
      if (askImageRef.current) {
        const body = new FormData();
        body.set(
          "messages",
          JSON.stringify([
            {
              role: "user",
              content: askInput.trim() || "Answer using the attached image.",
            },
          ])
        );
        body.set("image", askImageRef.current);

        res = await fetch("/api/ollama-ai/chat", {
          method: "POST",
          body,
          credentials: "include",
        });
      } else {
        res = await fetch("/api/ollama-ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            messages: [
              {
                role: "user",
                content: askInput,
              },
            ],
          }),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Ask AI failed");
      }

      const answer =
        typeof data?.message === "string"
          ? data.message
          : typeof data?.answer === "string"
            ? data.answer
            : typeof data?.text === "string"
              ? data.text
              : "";

      setAskAnswer(answer || "No answer returned.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Ask AI failed";
      setAskAnswer(msg);
      setStatusMessage(msg);
    } finally {
      setAskBusy(false);
    }
  }

  const activeTabLabel = APP_TAB_LABELS[tab] || "OTG";
  const appShellBackground = appUiMode === "clean" ? "#08090d" : selectedAppTheme.background;

  return (
    <main className="min-h-screen text-white transition-[background] duration-300" style={{ background: appShellBackground }} data-otg-theme={appThemeId} data-otg-font-scale={appFontScale} data-otg-ui-mode={appUiMode}>
      <div className={cn("pointer-events-none fixed inset-0 z-0", appUiMode === "clean" ? "hidden" : "")}>
        <div className="absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_center,rgba(80,120,255,0.18),rgba(120,60,255,0.10),transparent_62%)]" />
      </div>

      {appUiMode === "clean" ? (
        <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#08090d]/95 px-3 py-3 backdrop-blur-md md:px-5">
          <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/42">SLR Studios OTG</div>
              <div className="mt-0.5 flex items-center gap-3">
                <h1 className="truncate text-xl font-black tracking-tight text-white">{activeTabLabel}</h1>
                <span className="hidden rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-white/52 sm:inline-flex">
                  {connected ? "Comfy connected" : "Comfy offline"}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => handleUiModeChange(appUiMode === "clean" ? "classic" : "clean")}
                className="rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-white/72 transition hover:bg-white/[0.08]"
              >
                {appUiMode === "clean" ? "Classic UI" : "Clean UI"}
              </button>
              <button
                type="button"
                onClick={() => setTab("settings")}
                className="rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-white/72 transition hover:bg-white/[0.08]"
              >
                Settings
              </button>
              <div className="max-w-[160px] truncate rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/62">
                {username || "Guest"}
              </div>
            </div>
          </div>
        </header>
      ) : null}

      {appUiMode === "classic" ? (
      <div className="pointer-events-none fixed left-3 top-4 z-30 md:left-5 md:top-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(0,0,0,0.35)]">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-400" />
          <span className="max-w-[180px] truncate">{username}</span>
        </div>
      </div>
      ) : null}

      {appUiMode === "classic" ? (
      <div className="pointer-events-none fixed right-3 top-4 z-30 md:right-5 md:top-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(0,0,0,0.35)]">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", connected ? "bg-green-400" : "bg-red-400")} />
          <span>{connected ? "Connected" : "Disconnected"}</span>
        </div>
      </div>
      ) : null}

      <div className={cn("relative z-10 mx-auto px-3 pb-28 pt-24 md:px-5 md:pt-28", appUiMode === "clean" ? "max-w-[1480px]" : "max-w-[1400px]")}>
        {statusMessage ? (
          <div className="mb-3 rounded-[20px] border border-red-600/40 bg-red-950/60 px-4 py-3 text-sm font-semibold text-red-100">
            {statusMessage}
          </div>
        ) : null}

        {tab === "generate" ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
              <h1 className="text-4xl font-black tracking-tight text-white">Generate</h1>
            </div>

            <Card title="Workflow">
              <select
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
                className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
              >
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id} className="bg-[#0b1020]">
                    {workflow.label}
                  </option>
                ))}
              </select>
              <p className="text-sm text-white/72">{selectedWorkflow.runtime}</p>
              <p className="text-sm text-white/50">Select a runnable workflow from comfy_workflows.</p>
            </Card>

            <Card
              title="Choose style of picture and video"
              right={
                activeGenerateStylePreset ? (
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-100">
                    {activeGenerateStylePreset.label}
                  </span>
                ) : null
              }
            >
              <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
                <div className="space-y-3">
                  <select
                    value={activeGenerateStyleId}
                    onChange={(e) => handleGenerateStyleDropdownChange(e.target.value)}
                    className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                  >
                    <option value="" className="bg-[#0b1020]">
                      None / Clear style
                    </option>
                    {GENERATE_STYLE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id} className="bg-[#0b1020]">
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-sm text-white/55">
                    One style stays active at a time. Choosing a different style replaces the current one instead of duplicating it.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">3 most recent presets</div>
                  <div className="flex flex-wrap gap-2">
                    {recentGenerateStylePresets.length ? (
                      recentGenerateStylePresets.map((preset) => {
                        const active = activeGenerateStyleId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => applyGenerateStylePreset(preset)}
                            className={cn(
                              "inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2.5 text-sm font-semibold transition",
                              active
                                ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-50 shadow-[0_0_20px_rgba(16,185,129,0.18)]"
                                : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                            )}
                          >
                            {preset.label}
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-3 text-sm text-white/40">
                        Recent styles appear here after you choose them.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            <Card
              title="Prompt Guide"
              right={
                <GhostButton onClick={() => setPromptGuideOpen((prev) => !prev)}>
                  {promptGuideOpen ? "Hide" : "Show"}
                </GhostButton>
              }
            >
              {promptGuideOpen ? (
                <div className="space-y-4">
                  <p className="text-sm text-white/60">
                    Use these guidelines to write better prompts for the current workflow without cluttering the page.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {(["image", "text_to_video", "image_to_video", "tutorial_video"] as PromptGuideMode[]).map((mode) => {
                      const guide = PROMPT_GUIDES[mode];
                      const active = promptGuideMode === mode;
                      const isCurrent = currentPromptGuideMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setPromptGuideMode(mode)}
                          className={cn(
                            "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition",
                            active
                              ? "border-cyan-400/35 bg-cyan-500/15 text-cyan-50 shadow-[0_0_20px_rgba(34,211,238,0.16)]"
                              : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                          )}
                        >
                          <span>{guide.label}</span>
                          {isCurrent ? (
                            <span className="rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-emerald-100">
                              Current
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  {promptGuideMode === "tutorial_video" ? (
                    <div className="space-y-4">
                      <div className="rounded-[22px] border border-white/10 bg-black/45 p-3">
                        <div className="aspect-video overflow-hidden rounded-[18px] border border-white/10 bg-black">
                          <iframe
                            src={PROMPT_TUTORIAL_VIDEO_EMBED_URL}
                            title="LTX 2.3 prompt tutorial"
                            className="h-full w-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <GhostButton onClick={() => window.open(PROMPT_TUTORIAL_VIDEO_URL, "_blank", "noopener,noreferrer")}>
                          Open on YouTube
                        </GhostButton>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-[22px] border border-white/10 bg-black/40 px-4 py-4">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200/80">What works</div>
                          <ul className="space-y-2 text-sm text-white/80">
                            {activePromptGuide.works.map((item) => (
                              <li key={item} className="flex gap-2">
                                <span className="mt-[2px] text-emerald-300">-</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="rounded-[22px] border border-white/10 bg-black/40 px-4 py-4">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-200/80">What to avoid</div>
                          <ul className="space-y-2 text-sm text-white/80">
                            {activePromptGuide.avoid.map((item) => (
                              <li key={item} className="flex gap-2">
                                <span className="mt-[2px] text-rose-300">-</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="rounded-[22px] border border-white/10 bg-black/45 px-4 py-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Example prompt</div>
                            <div className="text-sm text-white/55">A stronger starting example for {activePromptGuide.label.toLowerCase()}.</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <GhostButton onClick={() => copyText(activePromptGuide.example)}>Copy Example</GhostButton>
                            <GhostButton
                              onClick={() => {
                                if (activePromptGuide.example !== prompt) pushPromptUndoSnapshot(prompt);
                                setPrompt(activePromptGuide.example);
                              }}
                            >
                              Use Example
                            </GhostButton>
                          </div>
                        </div>
                        <div className="rounded-[18px] border border-white/10 bg-black/55 px-4 py-4 text-sm leading-7 text-white/85">
                          {activePromptGuide.example}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-white/55">
                  Show quick guidance for Image, Text-to-Video, Image-to-Video, and a tutorial video.
                </p>
              )}
            </Card>

            <Card title="Prompt">
              <textarea
                value={prompt}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next !== prompt) pushPromptUndoSnapshot(prompt);
                  setPrompt(next);
                  setPromptAssessmentOpen(false);
                  setPromptAssessment(null);
                }}
                rows={6}
                placeholder="Describe the image or video you want to generate."
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              {activeGenerateStylePreset ? (
                <div className="rounded-[20px] border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100/95">
                  Active style wrapper: <span className="font-semibold">{activeGenerateStylePreset.label}</span>. Generate applies a strong style wrapper before and after your prompt at enhance and submit time instead of silently burying it in the text box.
                  {activeGenerateStyleGuidance ? (
                    <div className="mt-2 text-xs leading-6 text-emerald-50/85">{activeGenerateStyleGuidance}</div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <ActionButton onClick={handleEnhancePrompt} disabled={enhancing || !prompt.trim()}>
                  {enhancing ? "Enhancing..." : "Enhance Prompt"}
                </ActionButton>
                {showPromptBuilderAssistant ? (
                  <ActionButton onClick={handlePromptBuilderAssistant} disabled={formattingPrompt || !prompt.trim()}>
                    {formattingPrompt ? "Checking Prompt..." : "Prompt Builder Assistant"}
                  </ActionButton>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    void handleMicClick("generate", (text) => {
                      pushPromptUndoSnapshot(prompt);
                      setPrompt((prev) => appendPromptText(prev, text));
                    })
                  }
                  className={cn(
                    "inline-flex h-12 w-12 items-center justify-center rounded-full border text-white transition",
                    recordingTarget === "generate"
                      ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))]"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  )}
                  disabled={transcribingTarget === "generate"}
                >
                  <IconMic />
                </button>
                <GhostButton onClick={handleClearPrompt} disabled={!prompt}>
                  Clear
                </GhostButton>
                <GhostButton onClick={handleUndoPrompt} disabled={!promptUndoStack.length}>
                  Undo
                </GhostButton>
              </div>
              {showPromptBuilderAssistant ? (
                <>
                  <p className="text-sm text-white/55">
                    {promptBuilderNeedsStarterImage
                      ? "Prompt Builder Assistant grades your current prompt and starter image for LTX 2.3. It does not rewrite your prompt."
                      : "Prompt Builder Assistant grades your current prompt for LTX 2.3 and shows what is strong, weak, or missing. It does not rewrite your prompt."}
                  </p>
                  {promptAssessmentOpen && promptAssessment ? (
                    <div className="rounded-[24px] border border-cyan-400/25 bg-black/55 p-4 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Prompt Builder Assistant</div>
                          <div className="mt-1 text-sm text-white/60">LTX 2.3 prompt readiness review. Your prompt text was not changed.</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100">
                            Grade {promptAssessment.grade} - {promptAssessment.score}/100
                          </div>
                          <GhostButton onClick={() => setPromptAssessmentOpen(false)}>Hide</GhostButton>
                        </div>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-3">
                        <div className="rounded-[20px] border border-emerald-400/20 bg-emerald-500/10 p-4">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100/70">Correct</div>
                          <ul className="space-y-2 text-sm leading-6 text-emerald-50/90">
                            {promptAssessment.correct.length ? (
                              promptAssessment.correct.map((item) => <li key={item}>- {item}</li>)
                            ) : (
                              <li>- No strong elements were detected yet.</li>
                            )}
                          </ul>
                        </div>
                        <div className="rounded-[20px] border border-amber-400/20 bg-amber-500/10 p-4">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-100/70">Weak</div>
                          <ul className="space-y-2 text-sm leading-6 text-amber-50/90">
                            {promptAssessment.weak.length ? (
                              promptAssessment.weak.map((item) => <li key={item}>- {item}</li>)
                            ) : (
                              <li>- No weak areas were detected.</li>
                            )}
                          </ul>
                        </div>
                        <div className="rounded-[20px] border border-rose-400/20 bg-rose-500/10 p-4">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-100/70">Missing</div>
                          <ul className="space-y-2 text-sm leading-6 text-rose-50/90">
                            {promptAssessment.missing.length ? (
                              promptAssessment.missing.map((item) => <li key={item}>- {item}</li>)
                            ) : (
                              <li>- No critical missing elements were detected.</li>
                            )}
                          </ul>
                        </div>
                      </div>

                      <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-7 text-white/85">
                        <span className="font-semibold text-white">Summary:</span> {promptAssessment.summary}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </Card>
            {isPromptRelayWorkflowSelected ? (
              <Card title="Need help?">
                <div className="space-y-4 text-sm leading-6 text-white/68">
                  <p>
                    Prompt Relay splits one image-to-video render into timed beats. Use the main Prompt box as the global anchor: character identity, location, lighting, style, camera feel, and continuity rules.
                  </p>

                  <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/80">Quick tutorial</div>
                    <ol className="list-decimal space-y-2 pl-5">
                      <li>Upload one starter image.</li>
                      <li>Main Prompt describes what must stay consistent for the whole clip.</li>
                      <li>Beat 1 should describe the opening visible state or a small first motion.</li>
                      <li>Beats 2-4 should describe only what changes: action, camera movement, expression, or scene motion.</li>
                      <li>Keep each beat short. Do not repeat the full character and background description in every beat.</li>
                    </ol>
                  </div>

                  <div className="rounded-[20px] border border-cyan-300/15 bg-cyan-300/[0.05] p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/80">Example</div>
                    <div className="space-y-3">
                      <div>
                        <div className="text-white/80">Main Prompt</div>
                        <p className="mt-1 text-white/55">
                          A single continuous cinematic shot of the same character in the same room, realistic lighting, stable identity, natural motion, smooth camera movement.
                        </p>
                      </div>
                      <div>
                        <div className="text-white/80">Beat 1</div>
                        <p className="mt-1 text-white/55">
                          The character holds still for a brief establishing moment, eyes focused forward, posture calm, camera locked off.
                        </p>
                      </div>
                      <div>
                        <div className="text-white/80">Beat 2</div>
                        <p className="mt-1 text-white/55">
                          The character slowly turns toward the side, shoulders shifting naturally while the camera begins a subtle push-in.
                        </p>
                      </div>
                      <div>
                        <div className="text-white/80">Beat 3</div>
                        <p className="mt-1 text-white/55">
                          The character raises one hand slightly and reacts with a controlled expression change, lighting and background unchanged.
                        </p>
                      </div>
                      <div>
                        <div className="text-white/80">Beat 4</div>
                        <p className="mt-1 text-white/55">
                          The character settles back into a steady pose as the camera eases to a clean final frame.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ) : null}
            {isPromptRelayWorkflowSelected ? (
              <Card title="Prompt Relay beats">
                <p className="text-sm leading-6 text-white/60">
                  Prompt Relay uses the main Prompt box above as the global anchor. Add the timed action beats below. Beats are sent to ComfyUI separated by | so the PromptRelayEncode node can route them across the video.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  <textarea
                    value={promptRelayBeat1}
                    onChange={(e) => setPromptRelayBeat1(e.target.value)}
                    rows={4}
                    placeholder="Beat 1: static visible state or opening motion."
                    className="w-full rounded-[20px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                  />
                  <textarea
                    value={promptRelayBeat2}
                    onChange={(e) => setPromptRelayBeat2(e.target.value)}
                    rows={4}
                    placeholder="Beat 2: first action or camera move."
                    className="w-full rounded-[20px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                  />
                  <textarea
                    value={promptRelayBeat3}
                    onChange={(e) => setPromptRelayBeat3(e.target.value)}
                    rows={4}
                    placeholder="Beat 3: continued motion or second action."
                    className="w-full rounded-[20px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                  />
                  <textarea
                    value={promptRelayBeat4}
                    onChange={(e) => setPromptRelayBeat4(e.target.value)}
                    rows={4}
                    placeholder="Beat 4: final action or clean ending."
                    className="w-full rounded-[20px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <GhostButton
                    onClick={() => {
                      setPromptRelayBeat1("");
                      setPromptRelayBeat2("");
                      setPromptRelayBeat3("");
                      setPromptRelayBeat4("");
                    }}
                    disabled={!promptRelayLocalPrompts.trim()}
                  >
                    Clear beats
                  </GhostButton>
                  <span className="text-sm text-white/55">
                    {promptRelayLocalPrompts.trim() ? "Prompt Relay beats ready." : "Enter at least one beat before generating."}
                  </span>
                </div>
              </Card>
            ) : null}

            <Card title="Negative prompt">
              <textarea
                value={negativePrompt}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next !== negativePrompt) pushNegativePromptUndoSnapshot(negativePrompt);
                  setNegativePrompt(next);
                }}
                rows={4}
                placeholder="Describe what to avoid."
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <div className="flex flex-wrap items-center gap-3">
                <GhostButton onClick={handleClearNegativePrompt} disabled={!negativePrompt}>
                  Clear
                </GhostButton>
                <GhostButton onClick={handleUndoNegativePrompt} disabled={!negativePromptUndoStack.length}>
                  Undo
                </GhostButton>
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Card title="Orientation">
                <div className="flex flex-wrap gap-3">
                  <PillButton active={orientation === "portrait"} onClick={() => !isVideoWorkflowSelected && setOrientation("portrait")}>
                    Portrait
                  </PillButton>
                  <PillButton active={orientation === "landscape"} onClick={() => setOrientation("landscape")}>
                    Landscape
                  </PillButton>
                </div>
                <p className="text-sm text-white/50">
                  {isVideoWorkflowSelected ? "Video is currently landscape-only." : "Images can switch between portrait and landscape."}
                </p>
              </Card>

              <Card title="Duration">
                <select
                  value={String(durationSeconds)}
                  onChange={(e) => setDurationSeconds(clampGenerateDuration(Number(e.target.value)))}
                  className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                >
                  {GENERATE_DURATION_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds} className="bg-[#0b1020]">
                      {seconds} seconds
                    </option>
                  ))}
                </select>
                <p className="text-sm text-white/50">Choose 5, 10, or 15 seconds.</p>
              </Card>
            </div>

            <div>
              <Card title={isVideoUpscalerWorkflowSelected ? "Input video" : "Input image"}>
                <div className="flex flex-wrap items-center gap-3">
                  <ActionButton onClick={() => imageInputRef.current?.click()}>{isVideoUpscalerWorkflowSelected ? "Upload video" : "Upload image"}</ActionButton>
                  <ActionButton
                    onClick={() => {
                      setGenerateGalleryPickerOpen(true);
                      void loadGenerateGalleryItems();
                    }}
                    disabled={isVideoUpscalerWorkflowSelected}
                  >
                    Gallery
                  </ActionButton>
                  <span className="text-sm text-white/60">{uploadedFileName || "No file selected"}</span>
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept={isVideoUpscalerWorkflowSelected ? "video/*" : "image/*"}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    uploadedFileRef.current = file;
                    setUploadedFileName(file?.name || "");
                    updateGenerateInputPreview(file);
                  }}
                />
                <div className="mt-4 overflow-hidden rounded-[24px] border border-white/10 bg-black/45">
                  <div className="aspect-[4/5] max-h-[320px] bg-black/60">
                    {uploadedImagePreviewUrl ? (
                      uploadedInputIsVideo ? (
                        <video src={uploadedImagePreviewUrl} controls muted playsInline className="h-full w-full object-contain" />
                      ) : (
                        <img src={uploadedImagePreviewUrl} alt={uploadedFileName || "Generate input preview"} className="h-full w-full object-contain" />
                      )
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/40">
                        {isVideoUpscalerWorkflowSelected ? "Uploaded source video preview appears here." : "Uploaded input image preview appears here."}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-white/10 px-4 py-3">
                    <div className="text-xs text-white/52">
                      {uploadedImageMeta
                        ? `Starter image: ${uploadedImageMeta.width} x ${uploadedImageMeta.height}${uploadedImageMeta.height > uploadedImageMeta.width ? " - portrait" : " - landscape"}`
                        : isVideoUpscalerWorkflowSelected
                      ? "Upload the source video you want to upscale with RTX SR."
                      : "Upload a starter image if you want to build image-to-video from a still frame."}
                    </div>
                  </div>
                </div>
              </Card>
              {generateGalleryPickerOpen ? (
                <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur-sm">
                  <div className="mx-auto flex max-h-[86vh] max-w-5xl flex-col overflow-hidden rounded-[28px] border border-cyan-400/20 bg-[#070b16] shadow-[0_0_60px_rgba(0,0,0,0.55)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                      <div>
                        <h3 className="text-lg font-semibold text-white">Choose Gallery image</h3>
                        <p className="text-sm text-white/55">Only image files are shown. Selecting one uses it as the Generate input image.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton onClick={loadGenerateGalleryItems} disabled={generateGalleryLoading}>
                          {generateGalleryLoading ? "Loading..." : "Refresh"}
                        </ActionButton>
                        <ActionButton onClick={() => setGenerateGalleryPickerOpen(false)}>Close</ActionButton>
                      </div>
                    </div>

                    <div className="min-h-[260px] overflow-y-auto p-5">
                      {generateGalleryError ? (
                        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">{generateGalleryError}</div>
                      ) : null}

                      {!generateGalleryError && generateGalleryLoading ? (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/65">Loading Gallery images...</div>
                      ) : null}

                      {!generateGalleryLoading && !generateGalleryError && generateGalleryItems.length === 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/65">No Gallery images found.</div>
                      ) : null}

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {generateGalleryItems.map((item) => {
                          const label = getGenerateGalleryItemName(item);
                          return (
                            <button
                              key={(item.url || label) + "-" + (item.updatedAt || item.createdAt || "gallery")}
                              type="button"
                              onClick={() => void handleSelectGenerateGalleryItem(item)}
                              disabled={Boolean(generateGallerySelecting)}
                              className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-left transition hover:border-cyan-300/40 hover:bg-white/[0.07] disabled:cursor-wait disabled:opacity-60"
                            >
                              <div className="aspect-square bg-black/45">
                                {item.url ? <img src={item.url} alt={label} className="h-full w-full object-cover" loading="lazy" /> : null}
                              </div>
                              <div className="border-t border-white/10 px-3 py-2">
                                <div className="truncate text-xs font-semibold text-white">{label}</div>
                                {generateGallerySelecting === label ? <div className="mt-1 text-[11px] text-cyan-200">Selecting...</div> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {isCustomAudioVideoWorkflowSelected ? (
                <Card title="Custom audio">
                  <div className="flex flex-wrap items-center gap-3">
                    <ActionButton onClick={() => customAudioInputRef.current?.click()}>Upload audio</ActionButton>
                    <span className="text-sm text-white/60">{customAudioFileName || "No audio selected"}</span>
                  </div>
                  <input
                    ref={customAudioInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.aac"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      customAudioFileRef.current = file;
                      setCustomAudioFileName(file?.name || "");
                      updateGenerateCustomAudioPreview(file);
                    }}
                  />
                  <div className="mt-4 rounded-[24px] border border-white/10 bg-black/45 p-4">
                    {customAudioPreviewUrl ? (
                      <audio src={customAudioPreviewUrl} controls className="w-full" />
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-white/10 bg-black/35 px-4 py-6 text-center text-sm text-white/40">
                        Uploaded MP3, WAV, M4A, or AAC preview appears here.
                      </div>
                    )}
                    <p className="mt-3 text-xs text-white/52">
                      Use this for uploaded dialogue, music, or custom audio that should drive the LTX 2.3 custom-audio image-to-video workflow.
                    </p>
                  </div>
                </Card>
              ) : null}

              {isFirstLastImageVideoWorkflowSelected ? (
                <Card title="Last frame image">
                  <div className="flex flex-wrap items-center gap-3">
                    <ActionButton onClick={() => lastFrameInputRef.current?.click()}>Upload last image</ActionButton>
                    <span className="text-sm text-white/60">{lastFrameFileName || "No last image selected"}</span>
                  </div>
                  <input
                    ref={lastFrameInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      lastFrameFileRef.current = file;
                      setLastFrameFileName(file?.name || "");
                      updateLastFrameInputPreview(file);
                    }}
                  />
                  <div className="mt-4 overflow-hidden rounded-[24px] border border-white/10 bg-black/45">
                    <div className="aspect-[4/5] max-h-[320px] bg-black/60">
                      {lastFramePreviewUrl ? (
                        <img src={lastFramePreviewUrl} alt={lastFrameFileName || "Last frame preview"} className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/40">
                          Last frame image preview appears here.
                        </div>
                      )}
                    </div>
                    <div className="border-t border-white/10 px-4 py-3">
                      <div className="text-xs text-white/52">
                        {lastFrameImageMeta
                          ? `Last image: ${lastFrameImageMeta.width} x ${lastFrameImageMeta.height}${lastFrameImageMeta.height > lastFrameImageMeta.width ? " portrait" : " landscape"}`
                          : "Upload the final frame image for the transition target."}
                      </div>
                    </div>
                  </div>
                </Card>
              ) : null}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Card title="Preview">
                <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/45">
                  <div className="aspect-[16/9] bg-black/60">
                    {latestPreviewUrl ? (
                      latestPreviewKind === "video" ? (
                        <video src={latestPreviewUrl} className="h-full w-full object-contain" controls playsInline muted />
                      ) : (
                        <img src={latestPreviewUrl} alt={latestPreviewName || "Latest generated content"} className="h-full w-full object-contain" />
                      )
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-white/45">
                        Preview will appear here after ComfyUI finishes creating content.
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/60">
                  <div className="min-w-0 space-y-1">
                    <div className="truncate">{latestPreviewName || "No completed output yet"}</div>
                    <div className="text-xs text-white/45">
                      {latestPreviewKind === "image" && latestPreviewMeta
                        ? `Generated image: ${latestPreviewMeta.width} x ${latestPreviewMeta.height}${latestPreviewMeta.height > latestPreviewMeta.width ? " - portrait" : " - landscape"}`
                        : latestPreviewKind === "video"
                          ? "Create Character works only with generated portrait images."
                          : "Create Character works only with generated portrait images."}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionButton
                      onClick={() => void handleCreateCharacterFromGenerate()}
                      disabled={
                        createCharacterBusy ||
                        progressStatus === "running" ||
                        latestPreviewKind !== "image" ||
                        !latestPreviewUrl ||
                        !latestPreviewMeta ||
                        latestPreviewMeta.height <= latestPreviewMeta.width
                      }
                    >
                      {createCharacterBusy ? "Sending..." : "Create Character"}
                    </ActionButton>
                    <GhostButton onClick={() => void refreshLatestContent(true)} disabled={progressStatus === "running"}>
                      Refresh preview
                    </GhostButton>
                  </div>
                </div>
              </Card>

              <Card title="Progress">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 text-sm font-semibold text-white/80">
                    <span className="capitalize">{progressStatus}</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(145,92,255,0.95),rgba(40,200,255,0.95))] transition-all duration-500"
                      style={{ width: `${Math.max(0, Math.min(progressPercent, 100))}%` }}
                    />
                  </div>
                  <div className="space-y-1 text-sm text-white/60">
                    <div>Queue remaining: {progressQueue}</div>
                    <div className="break-all">Prompt ID: {activePromptId || "Not submitted yet"}</div>
                    <div>
                      {progressStatus === "running"
                        ? "ComfyUI is still generating."
                        : progressStatus === "complete"
                          ? "Generation complete."
                          : progressStatus === "error"
                            ? "Generation failed."
                            : "Ready."}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <Card title="Generate action">
              <p className="text-sm text-white/60">The Generate button stays here as the last step.</p>
              <div className="flex flex-wrap items-center gap-3">
                <ActionButton onClick={handleGenerate} disabled={generateBusy || !prompt.trim() || (isPromptRelayWorkflowSelected && (!uploadedFileName || !promptRelayLocalPrompts.trim())) || (isCustomAudioVideoWorkflowSelected && (!uploadedFileName || !customAudioFileName))}>
                  {generateBusy ? "Submitting..." : "Generate"}
                </ActionButton>
                <span className="text-sm text-white/55">Sends the current prompt and controls to ComfyUI.</span>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "gethelp" ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
              <h1 className="text-4xl font-black tracking-tight text-white">AI Assistance</h1>
              <div className="mt-4 overflow-x-auto">
                <div className="flex min-w-max gap-2 pb-1">
                  <PillButton active={assistanceTab === "describe"} onClick={() => setAssistanceTab("describe")}>
                    Describe Picture
                  </PillButton>
                  <PillButton active={assistanceTab === "enhance"} onClick={() => setAssistanceTab("enhance")}>
                    Enhance Prompt
                  </PillButton>
                  <PillButton active={assistanceTab === "scene"} onClick={() => setAssistanceTab("scene")}>
                    Scene Creator
                  </PillButton>
                  <PillButton active={assistanceTab === "ask"} onClick={() => setAssistanceTab("ask")}>
                    Ask AI
                  </PillButton>
                </div>
              </div>
            </div>
            {assistanceTab === "describe" ? (
              <Card title="Describe Picture">
                <p className="text-white/70">Choose an image, preview it, select the mode, then generate a description you can copy, enhance, or send to Generate.</p>
                <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-3">
                      <ActionButton onClick={() => describeInputRef.current?.click()}>Choose image</ActionButton>
                      <GhostButton
                        onClick={() => {
                          describeFileRef.current = null;
                          setDescribeImageName("");
                          setDescribeOutput("");
                          updateDescribePreview(null);
                          if (describeInputRef.current) {
                            describeInputRef.current.value = "";
                          }
                        }}
                        disabled={!describeImageName}
                      >
                        Clear
                      </GhostButton>
                    </div>
                    <input
                      ref={describeInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        describeFileRef.current = file;
                        setDescribeImageName(file?.name || "");
                        updateDescribePreview(file);
                      }}
                    />
                    <div className="rounded-[22px] border border-white/10 bg-black/35 p-4 text-white/70">
                      {describeImageName || "No image selected"}
                    </div>
                    <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black/45">
                      {describePreviewUrl ? (
                        <img src={describePreviewUrl} alt={describeImageName || "Describe preview"} className="aspect-[4/3] w-full object-contain" />
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center px-4 text-center text-sm text-white/40">Image preview will appear here.</div>
                      )}
                    </div>
                    <select
                      value={describeMode}
                      onChange={(e) => setDescribeMode(e.target.value as "background" | "identity")}
                      className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                    >
                      <option value="background">Background Scene</option>
                      <option value="identity">Person Identity</option>
                    </select>
                    <ActionButton onClick={handleDescribe} disabled={describeBusy || !describeImageName}>
                      {describeBusy ? "Describing..." : "Describe"}
                    </ActionButton>
                  </div>

                  <div className="space-y-4">
                    <textarea
                      value={describeOutput}
                      onChange={(e) => setDescribeOutput(e.target.value)}
                      rows={10}
                      placeholder="Description result will appear here."
                      className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                    />
                    <div className="flex flex-wrap gap-3">
                      <GhostButton onClick={() => copyText(describeOutput)} disabled={!describeOutput.trim()}>
                        Copy
                      </GhostButton>
                      <ActionButton
                        onClick={async () => {
                          try {
                            if (!describeOutput.trim()) return;
                            setDescribeBusy(true);
                            const nextPrompt = await enhancePromptText(describeOutput, selectedWorkflow.id);
                            setDescribeOutput(nextPrompt);
                            setStatusMessage("Description enhanced.");
                          } catch (error) {
                            setStatusMessage(error instanceof Error ? error.message : "Enhance Prompt failed");
                          } finally {
                            setDescribeBusy(false);
                          }
                        }}
                        disabled={describeBusy || !describeOutput.trim()}
                      >
                        {describeBusy ? "Working..." : "Enhance"}
                      </ActionButton>
                      <ActionButton onClick={() => sendTextToGenerate(describeOutput)} disabled={!describeOutput.trim()}>
                        Send to Prompt
                      </ActionButton>
                    </div>
                  </div>
                </div>
              </Card>
            ) : null}
            {assistanceTab === "enhance" ? (
              <Card title="Enhance Prompt">
                <p className="text-white/70">Write or dictate a draft, optionally upload an image, then enhance it with Ollama. When an image is attached, Ollama Vision will use it as visual context.</p>

                <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-3">
                      <label className="inline-flex cursor-pointer items-center justify-center rounded-[22px] border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10">
                        Upload image
                        <input
                          key={enhanceImageInputKey}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleEnhanceImageSelect(e.target.files?.[0] || null)}
                        />
                      </label>

                      <GhostButton onClick={clearEnhanceImage} disabled={!enhanceImageFile}>
                        Remove image
                      </GhostButton>
                    </div>

                    <div className="rounded-[22px] border border-white/10 bg-black/35 p-4 text-white/70">
                      {enhanceImageName || "No image selected"}
                    </div>

                    {enhanceImagePreviewUrl ? (
                      <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black/35">
                        <img
                          src={enhanceImagePreviewUrl}
                          alt="Enhance prompt reference"
                          className="h-auto max-h-[260px] w-full object-contain"
                        />
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-white/55">Length</div>
                      <div className="flex flex-wrap gap-3">
                        <PillButton active={enhanceLength === "short"} onClick={() => setEnhanceLength("short")}>
                          Short
                        </PillButton>
                        <PillButton active={enhanceLength === "normal"} onClick={() => setEnhanceLength("normal")}>
                          Normal
                        </PillButton>
                        <PillButton active={enhanceLength === "long"} onClick={() => setEnhanceLength("long")}>
                          Long
                        </PillButton>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <textarea
                      value={enhanceDraft}
                      onChange={(e) => setEnhanceDraft(e.target.value)}
                      rows={10}
                      placeholder="Write the draft prompt you want to improve."
                      className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                    />

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleMicClick("enhance", (text) => setEnhanceDraft((prev) => appendPromptText(prev, text)))}
                        className={cn(
                          "inline-flex h-12 w-12 items-center justify-center rounded-full border text-white transition",
                          recordingTarget === "enhance"
                            ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))]"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        )}
                        disabled={transcribingTarget === "enhance"}
                      >
                        <IconMic />
                      </button>

                      <ActionButton onClick={handleEnhanceDraft} disabled={enhanceDraftBusy || !enhanceDraft.trim()}>
                        {enhanceDraftBusy ? "Enhancing..." : "Enhance"}
                      </ActionButton>

                      <GhostButton onClick={() => copyText(enhanceDraft)} disabled={!enhanceDraft.trim()}>
                        Copy
                      </GhostButton>

                      <ActionButton onClick={() => sendTextToGenerate(enhanceDraft)} disabled={!enhanceDraft.trim()}>
                        Send to Prompt
                      </ActionButton>
                    </div>
                  </div>
                </div>
              </Card>
            ) : null}
            {assistanceTab === "scene" ? (
              <Card title="Scene Creator">
                <p className="text-white/70">Upload Character 1, optionally add Character 2, Character 3, and Background, then build a persistent Scene Card. After that, create the final LTX-ready scene prompt for Generate.</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <GhostButton onClick={() => setSceneTutorialOpen(true)}>
                    Tutorial
                  </GhostButton>
                  <div className="text-xs text-white/45">
                    Quick guide for building stronger LTX-style scene prompts.
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="space-y-2">
                        <label className="inline-flex w-full cursor-pointer items-center justify-center rounded-[18px] border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10">
                          Character 1
                          <input
                            key={sceneChar1InputKey}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => setSceneReference("char1", e.target.files?.[0] || null)}
                          />
                        </label>
                        <div className="overflow-hidden rounded-[14px] border border-white/10 bg-black/35 p-2">
                          {sceneChar1PreviewUrl ? (
                            <img src={sceneChar1PreviewUrl} alt="Character 1 reference" className="h-20 w-full rounded-[10px] object-cover" />
                          ) : (
                            <div className="flex h-20 items-center justify-center text-xs text-white/35">Required</div>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-white/50">{sceneChar1Name || "Required"}</div>
                      </div>

                      <div className="space-y-2">
                        <label className="inline-flex w-full cursor-pointer items-center justify-center rounded-[18px] border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10">
                          Character 2
                          <input
                            key={sceneChar2InputKey}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => setSceneReference("char2", e.target.files?.[0] || null)}
                          />
                        </label>
                        <div className="overflow-hidden rounded-[14px] border border-white/10 bg-black/35 p-2">
                          {sceneChar2PreviewUrl ? (
                            <img src={sceneChar2PreviewUrl} alt="Character 2 reference" className="h-20 w-full rounded-[10px] object-cover" />
                          ) : (
                            <div className="flex h-20 items-center justify-center text-xs text-white/35">Optional</div>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-white/50">{sceneChar2Name || "Optional"}</div>
                      </div>

                      <div className="space-y-2">
                        <label className="inline-flex w-full cursor-pointer items-center justify-center rounded-[18px] border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10">
                          Character 3
                          <input
                            key={sceneChar3InputKey}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => setSceneReference("char3", e.target.files?.[0] || null)}
                          />
                        </label>
                        <div className="overflow-hidden rounded-[14px] border border-white/10 bg-black/35 p-2">
                          {sceneChar3PreviewUrl ? (
                            <img src={sceneChar3PreviewUrl} alt="Character 3 reference" className="h-20 w-full rounded-[10px] object-cover" />
                          ) : (
                            <div className="flex h-20 items-center justify-center text-xs text-white/35">Optional</div>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-white/50">{sceneChar3Name || "Optional"}</div>
                      </div>

                      <div className="space-y-2">
                        <label className="inline-flex w-full cursor-pointer items-center justify-center rounded-[18px] border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10">
                          Background
                          <input
                            key={sceneBgInputKey}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => setSceneReference("bg", e.target.files?.[0] || null)}
                          />
                        </label>
                        <div className="overflow-hidden rounded-[14px] border border-white/10 bg-black/35 p-2">
                          {sceneBgPreviewUrl ? (
                            <img src={sceneBgPreviewUrl} alt="Background reference" className="h-20 w-full rounded-[10px] object-cover" />
                          ) : (
                            <div className="flex h-20 items-center justify-center text-xs text-white/35">Optional</div>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-white/50">{sceneBgName || "Optional"}</div>
                      </div>
                    </div>

                    <label className="space-y-2 text-sm text-white/70">
                      <span>Style</span>
                      <input
                        type="text"
                        value={sceneStyle}
                        onChange={(e) => setSceneStyle(e.target.value)}
                        className="w-full rounded-[18px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none focus:border-cyan-400/45"
                      />
                    </label>

                    <textarea
                      value={sceneDraft}
                      onChange={(e) => setSceneDraft(e.target.value)}
                      rows={10}
                      placeholder="Describe what happens in this scene."
                      className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                    />

                    <div className="rounded-[20px] border border-white/10 bg-black/35 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">Transition helper</div>
                          <div className="mt-2 text-sm text-white/70">
                            Choose how this scene should connect to the previous beat. The transition mode is stored separately from the prompt box.
                          </div>
                        </div>
                        <div className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
                          Transition: {selectedTransitionOption.label}
                          {sceneTransitionMode === "auto" ? " (detected)" : ""}
                        </div>
                      </div>

                      <div className="mt-3 text-sm text-white/80">{selectedTransitionOption.helper}</div>
                      {sceneTemporalSequenceHint ? <div className="mt-2 text-xs leading-5 text-cyan-100/85">{sceneTemporalSequenceHint}</div> : null}

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <GhostButton onClick={() => setSceneTransitionPickerOpen((prev) => !prev)}>
                          {sceneTransitionPickerOpen ? "Close Hard Cut Helper" : "Hard Cut Helper"}
                        </GhostButton>
                        <PillButton active={sceneTransitionMode === "auto"} onClick={() => setSceneTransitionMode("auto")}>
                          Auto Detect
                        </PillButton>
                      </div>

                      {sceneTransitionPickerOpen ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {SCENE_TRANSITION_OPTIONS.map((option) => (
                            <button
                              key={option.mode}
                              type="button"
                              onClick={() => {
                                setSceneTransitionMode(option.mode);
                                setSceneTransitionPickerOpen(false);
                              }}
                              className={cn(
                                "rounded-[18px] border px-4 py-3 text-left transition",
                                sceneTransitionMode === option.mode
                                  ? "border-cyan-400/35 bg-[linear-gradient(90deg,rgba(145,92,255,0.28),rgba(40,200,255,0.18))] text-white"
                                  : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                              )}
                            >
                              <div className="text-sm font-semibold text-white">{option.label}</div>
                              <div className="mt-2 text-xs leading-5 text-white/65">{option.helper}</div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-[20px] border border-white/10 bg-black/35 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">Reference Image</div>
                          <div className="mt-2 text-sm text-white/70">
                            Run Ollama Vision one slot at a time. Completed slots turn green and lock until you clear them.
                          </div>
                        </div>
                        <div className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
                          {completedSceneReferenceCount}/{SCENE_REFERENCE_SLOT_OPTIONS.length} complete
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <GhostButton onClick={() => setSceneReferencePickerOpen((prev) => !prev)}>
                          {sceneReferencePickerOpen ? "Close Reference Image" : "Reference Image"}
                        </GhostButton>
                        <GhostButton onClick={clearAllSceneReferenceAnalyses} disabled={!sceneReferenceImageCard.trim() && !sceneReferenceBusySlot}>
                          Clear All
                        </GhostButton>
                      </div>

                      {sceneReferencePickerOpen ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          {SCENE_REFERENCE_SLOT_OPTIONS.map((slot) => {
                            const hasFile =
                              slot.key === "char1"
                                ? !!sceneChar1File
                                : slot.key === "char2"
                                  ? !!sceneChar2File
                                  : slot.key === "char3"
                                    ? !!sceneChar3File
                                    : !!sceneBgFile;
                            const status = sceneReferenceStatuses[slot.key];
                            const isRunning = sceneReferenceBusySlot === slot.key || status === "running";
                            const isDone = status === "done";
                            return (
                              <button
                                key={slot.key}
                                type="button"
                                onClick={() => void handleReferenceImageSlot(slot.key)}
                                disabled={!hasFile || !!sceneReferenceBusySlot || isDone}
                                className={cn(
                                  "rounded-[18px] border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                                  isDone
                                    ? "border-emerald-400/35 bg-[linear-gradient(90deg,rgba(34,197,94,0.22),rgba(16,185,129,0.16))] text-white"
                                    : isRunning
                                      ? "border-cyan-400/35 bg-[linear-gradient(90deg,rgba(145,92,255,0.28),rgba(40,200,255,0.18))] text-white"
                                      : hasFile
                                        ? "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                                        : "border-white/10 bg-white/5 text-white/40"
                                )}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-semibold text-white">{slot.label}</div>
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65">
                                    {isDone ? "Locked" : isRunning ? "Running" : hasFile ? "Ready" : "No image"}
                                  </div>
                                </div>
                                <div className="mt-2 text-xs leading-5 text-white/65">
                                  {slot.kind === "background"
                                    ? "Extract visible environment details and continuity anchors for the background image."
                                    : "Extract visible identity, wardrobe, pose, and lighting details for this character image."}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    {(() => {
                      const promptCheck = evaluateScenePromptStrength(sceneDraft);
                      const toneClass =
                        promptCheck.rating === "strong"
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                          : promptCheck.rating === "usable"
                            ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
                            : "border-red-400/30 bg-red-500/10 text-red-200";

                      return (
                        <div className="rounded-[20px] border border-white/10 bg-black/35 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">Prompt strength</div>
                            <div className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${toneClass}`}>
                              {promptCheck.rating}
                            </div>
                          </div>
                          <div className="mt-3 text-sm text-white/70">
                            A strong scene prompt usually includes: subject, setting, action, tone/emotion, and shot/camera intent.
                          </div>
                          <div className="mt-3 text-sm text-white/80">
                            <span className="font-semibold">Detected:</span> {promptCheck.present.length ? promptCheck.present.join(", ") : "none"}
                          </div>
                          <div className="mt-2 text-sm text-white/80">
                            <span className="font-semibold">Missing:</span> {promptCheck.missing.length ? promptCheck.missing.join(", ") : "none"}
                          </div>
                          {!promptCheck.canGenerate ? (
                            <div className="mt-3 rounded-[16px] border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                              Prompt is too weak to generate reliably. Add more scene information before building or creating the scene.
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleMicClick("scene", (text) => setSceneDraft((prev) => appendPromptText(prev, text)))}
                        className={cn(
                          "inline-flex h-12 w-12 items-center justify-center rounded-full border text-white transition",
                          recordingTarget === "scene"
                            ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))]"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        )}
                        disabled={transcribingTarget === "scene"}
                      >
                        <IconMic />
                      </button>

                      <ActionButton onClick={handleBuildSceneCard} disabled={scenePlanBusy || !sceneDraft.trim() || !sceneReferenceImageCard.trim()}>
                        {scenePlanBusy ? "Building..." : "Build Reference Card"}
                      </ActionButton>

                      <ActionButton onClick={handleCreateScene} disabled={sceneWriteBusy || !sceneReferenceCard.trim() || !sceneDraft.trim()}>
                        {sceneWriteBusy ? "Creating..." : "Create Scene"}
                      </ActionButton>

                      <ActionButton onClick={() => sendTextToGenerate(sceneOutput)} disabled={!sceneOutput.trim()}>
                        Send to Generate
                      </ActionButton>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-white/10 bg-black/45 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-white/55">Reference Image Card</div>
                        <div className="text-[11px] text-white/45">One slot at a time. Clear one slot or clear all to unlock reruns.</div>
                      </div>

                      <div className="mb-4 flex flex-wrap gap-2">
                        {SCENE_REFERENCE_SLOT_OPTIONS.map((slot) => {
                          const status = sceneReferenceStatuses[slot.key];
                          const hasText = !!sceneReferenceAnalyses[slot.key].trim();
                          return (
                            <div
                              key={slot.key}
                              className={cn(
                                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
                                status === "done"
                                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                                  : status === "running"
                                    ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
                                    : "border-white/10 bg-white/5 text-white/55"
                              )}
                            >
                              <span>{slot.label}</span>
                              <span className="text-[10px] text-white/60">{status === "done" ? "Locked" : status === "running" ? "Running" : hasText ? "Ready" : "Idle"}</span>
                              {hasText ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    clearSceneReferenceAnalysis(slot.key);
                                    setStatusMessage(`${slot.label} reference cleared.`);
                                  }}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/75 transition hover:bg-white/10"
                                  aria-label={`Clear ${slot.label} reference`}
                                >
                                  <IconTrash />
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      <textarea
                        value={sceneVisionSummary}
                        readOnly
                        rows={12}
                        placeholder="Click Reference Image, then run Character 1, Character 2, Character 3, and Background one at a time. Their descriptions will collect here."
                        className="w-full rounded-[20px] border border-white/10 bg-black/55 px-4 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                      />
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-black/45 p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-white/55">Reference Card</div>
                      <textarea
                        value={sceneReferenceCard}
                        onChange={(e) => setSceneReferenceCard(e.target.value)}
                        rows={12}
                        placeholder="Build Reference Card to match your reference image card to the scene prompt, characters, background, style, and continuity rules."
                        className="w-full rounded-[20px] border border-white/10 bg-black/55 px-4 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                      />
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-black/45 p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-white/55">Generated Scene</div>
                      <textarea
                        value={sceneOutput}
                        onChange={(e) => setSceneOutput(e.target.value)}
                        rows={12}
                        placeholder="Create Scene to generate the final LTX-ready prompt for this shot."
                        className="w-full rounded-[20px] border border-white/10 bg-black/55 px-4 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            ) : null}
            {sceneTutorialOpen ? (
              <>
                <div
                  className="fixed inset-0 z-[140] bg-black/82 px-3 pt-24 pb-28 sm:px-4"
                  onClick={() => {
                    setSceneTutorialOpen(false);
                    setSceneTutorialImageOpen("");
                    setSceneTutorialImageLabel("");
                  }}
                >
                  <div
                    className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1020] shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[#0b1020]/95 px-4 py-4 backdrop-blur">
                      <div>
                        <div className="text-sm font-semibold uppercase tracking-[0.22em] text-white/70">Tutorial</div>
                        <div className="mt-1 text-white/65">Key aspects to include when crafting a stronger LTX-style scene prompt.</div>
                      </div>
                      <GhostButton
                        onClick={() => {
                          setSceneTutorialOpen(false);
                          setSceneTutorialImageOpen("");
                          setSceneTutorialImageLabel("");
                        }}
                      >
                        Close
                      </GhostButton>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
                      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                        <div className="space-y-3 rounded-[22px] border border-white/10 bg-black/35 p-4 text-sm text-white/75">
                          <div className="font-semibold text-white/85">Include enough detail to guide the scene:</div>
                          <ul className="list-disc space-y-2 pl-5">
                            <li><span className="font-semibold text-white/90">Establish the shot</span> - tell the model how the scene should be framed.</li>
                            <li><span className="font-semibold text-white/90">Set the scene</span> - location, lighting, atmosphere, color, and surface feel.</li>
                            <li><span className="font-semibold text-white/90">Describe the action</span> - what happens from start to finish.</li>
                            <li><span className="font-semibold text-white/90">Define the characters</span> - appearance, identity, emotion, and visible traits.</li>
                            <li><span className="font-semibold text-white/90">Identify camera movement</span> - pan, tilt, dolly, close-up, reverse angle, hard cut, reaction shot, and shot changes.</li>
                            <li><span className="font-semibold text-white/90">Describe audio if relevant</span> - ambient sound, speech, and music cues.</li>
                          </ul>
                          <div className="rounded-[18px] border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-amber-200">
                            Weak prompts should not be generated. Give at least a subject, action, setting, and some shot or tone guidance.

                          {(() => {
                            const tutorialPreview = evaluateTutorialPromptPreview(sceneTutorialDraft);
                            const badgeClass =
                              tutorialPreview.rating === "strong"
                                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                                : tutorialPreview.rating === "usable"
                                  ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
                                  : "border-red-400/30 bg-red-500/10 text-red-200";

                            const chipClass = (isOn: boolean) =>
                              isOn
                                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                                : "border-white/10 bg-black/35 text-white/70";

                            return (
                              <div className="rounded-[18px] border border-white/10 bg-black/30 p-4">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
                                  Example Prompt Box
                                </div>
                                <textarea
                                  value={sceneTutorialDraft}
                                  onChange={(e) => setSceneTutorialDraft(e.target.value)}
                                  rows={6}
                                  placeholder="Type a sample scene prompt here and watch the checklist respond in real time."
                                  className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                                />
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                  <div className="text-sm text-white/70">Live tutorial prompt strength</div>
                                  <div className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${badgeClass}`}>
                                    {tutorialPreview.rating}
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <div className={`rounded-[14px] border px-3 py-2 text-sm ${chipClass(tutorialPreview.checks.establishShot)}`}>
                                    {tutorialPreview.checks.establishShot ? "Check" : "Missing"} - Establish shot
                                  </div>
                                  <div className={`rounded-[14px] border px-3 py-2 text-sm ${chipClass(tutorialPreview.checks.setScene)}`}>
                                    {tutorialPreview.checks.setScene ? "Check" : "Missing"} - Set the scene
                                  </div>
                                  <div className={`rounded-[14px] border px-3 py-2 text-sm ${chipClass(tutorialPreview.checks.describeAction)}`}>
                                    {tutorialPreview.checks.describeAction ? "Check" : "Missing"} - Describe the action
                                  </div>
                                  <div className={`rounded-[14px] border px-3 py-2 text-sm ${chipClass(tutorialPreview.checks.defineCharacter)}`}>
                                    {tutorialPreview.checks.defineCharacter ? "Check" : "Missing"} - Define the character
                                  </div>
                                  <div className={`rounded-[14px] border px-3 py-2 text-sm ${chipClass(tutorialPreview.checks.cameraMovement)}`}>
                                    {tutorialPreview.checks.cameraMovement ? "Check" : "Missing"} - Identify camera movement
                                  </div>
                                  <div className={`rounded-[14px] border px-3 py-2 text-sm ${chipClass(tutorialPreview.checks.describeAudio)}`}>
                                    {tutorialPreview.checks.describeAudio ? "Check" : "Missing"} - Describe audio if relevant
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          </div>

                        </div>

                        <div className="space-y-4 pb-6">
                          {(["example1", "example2"] as const).map((key) => {
                            const example = SCENE_TUTORIAL_EXAMPLES[key];
                            const isOpen = sceneTutorialExampleKey === key;
                            return (
                              <div key={key} className="rounded-[22px] border border-white/10 bg-black/35 p-4">
                                <button
                                  type="button"
                                  className="block w-full overflow-hidden rounded-[18px] border border-white/10 bg-black/40"
                                  onClick={() => {
                                    setSceneTutorialImageOpen(example.imageSrc);
                                    setSceneTutorialImageLabel(example.title);
                                  }}
                                >
                                  <img
                                    src={example.imageSrc}
                                    alt={example.title}
                                    className="h-40 w-full object-cover"
                                  />
                                </button>

                                <GhostButton
                                  onClick={() => setSceneTutorialExampleKey((prev) => (prev === key ? "" : key))}
                                  className="mt-3"
                                >
                                  {key === "example1" ? "Example 1" : "Example 2"}
                                </GhostButton>

                                {isOpen ? (
                                  <div className="mt-4 rounded-[18px] border border-white/10 bg-black/30 p-4">
                                    <div className="text-sm font-semibold text-white/85">
                                      {example.title}
                                    </div>

                                    <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
                                      Positive Prompt
                                    </div>
                                    <textarea
                                      readOnly
                                      value={example.positivePrompt}
                                      rows={10}
                                      className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
                                    />

                                    <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
                                      Negative Prompt
                                    </div>
                                    <textarea
                                      readOnly
                                      value={example.negativePrompt}
                                      rows={7}
                                      className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
                                    />

                                    <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
                                      Example Video
                                    </div>
                                    <div className="mt-2 overflow-hidden rounded-[18px] border border-white/10 bg-black/45 p-2">
                                      <video
                                        controls
                                        playsInline
                                        preload="metadata"
                                        className="w-full rounded-[14px]"
                                        src={example.videoSrc}
                                      />
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {sceneTutorialImageOpen ? (
                  <div
                    className="fixed inset-0 z-[150] bg-black/92 px-3 pt-20 pb-24 sm:px-4"
                    onClick={() => {
                      setSceneTutorialImageOpen("");
                      setSceneTutorialImageLabel("");
                    }}
                  >
                    <div
                      className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1020] shadow-2xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[#0b1020]/95 px-4 py-4 backdrop-blur">
                        <div className="text-sm font-semibold uppercase tracking-[0.22em] text-white/70">{sceneTutorialImageLabel || "Guide Preview"}</div>
                        <GhostButton
                          onClick={() => {
                            setSceneTutorialImageOpen("");
                            setSceneTutorialImageLabel("");
                          }}
                        >
                          Back
                        </GhostButton>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto p-4">
                        <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black/40 p-2">
                          <img
                            src={sceneTutorialImageOpen}
                            alt={sceneTutorialImageLabel || "Guide Preview"}
                            className="w-full object-contain"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
            {assistanceTab === "ask" ? (
              <Card title="Ask AI">
                <p className="text-white/70">Ask a direct question, optionally attach an image, or dictate the prompt before sending.</p>
                <textarea
                  value={askInput}
                  onChange={(e) => setAskInput(e.target.value)}
                  rows={7}
                  placeholder="Ask for prompt help, workflow guidance, or a scene rewrite."
                  className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                />
                <div className="flex flex-wrap gap-3">
                  <ActionButton onClick={() => askImageInputRef.current?.click()}>Attach image</ActionButton>
                  <input
                    ref={askImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      askImageRef.current = file;
                      setAskImageName(file?.name || "");
                      updateAskPreview(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void handleMicClick("ask", (text) => setAskInput((prev) => appendPromptText(prev, text)))}
                    className={cn(
                      "inline-flex h-12 w-12 items-center justify-center rounded-full border text-white transition",
                      recordingTarget === "ask"
                        ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))]"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    )}
                    disabled={transcribingTarget === "ask"}
                  >
                    <IconMic />
                  </button>
                  <GhostButton
                    onClick={() => {
                      askImageRef.current = null;
                      setAskImageName("");
                      updateAskPreview(null);
                      if (askImageInputRef.current) {
                        askImageInputRef.current.value = "";
                      }
                    }}
                    disabled={!askImageName}
                  >
                    Clear image
                  </GhostButton>
                </div>
                {askImageName ? (
                  <div className="rounded-[22px] border border-white/10 bg-black/35 p-4 text-white/70">{askImageName}</div>
                ) : null}
                {askImagePreviewUrl ? (
                  <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black/45">
                    <img src={askImagePreviewUrl} alt={askImageName || "Ask AI preview"} className="aspect-[4/3] w-full object-contain" />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <ActionButton onClick={handleAskAi} disabled={askBusy || (!askInput.trim() && !askImageName)}>
                    {askBusy ? "Asking..." : "Ask AI"}
                  </ActionButton>
                  <GhostButton onClick={() => copyText(askAnswer)} disabled={!askAnswer.trim()}>
                    Copy Answer
                  </GhostButton>
                  <ActionButton onClick={() => sendTextToGenerate(askAnswer)} disabled={!askAnswer.trim()}>
                    Send to Prompt
                  </ActionButton>
                </div>
                <textarea
                  value={askAnswer}
                  onChange={(e) => setAskAnswer(e.target.value)}
                  rows={8}
                  placeholder="AI answer will appear here."
                  className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                />
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === "angles" ? <AnglesPanel /> : null}
        {tab === "storyboard" ? <StoryboardPanel /> : null}
        {tab === "characters" ? <CharactersPanel importedDraft={characterImportDraft} onImportedDraftConsumed={() => setCharacterImportDraft(null)} /> : null}
        {tab === "editvideo" ? <EditVideoPanel onRefreshGallery={() => void loadGallery()} /> : null}

        {tab === "support" ? <SupportPanel /> : null}

        {tab === "settings" ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/70">App controls</p>
              <h1 className="mt-2 text-4xl font-black tracking-tight text-white">Settings</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/62">Check your account, verify the active Comfy connection, and recover stuck local pipeline state without deleting Gallery, Favorites, or Production projects.</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Appearance">
                <div className="space-y-5">
                  <div className="rounded-[22px] border border-white/10 bg-black/35 p-4">
                    <p className="text-sm font-semibold text-white">Interface mode</p>
                    <p className="mt-1 text-sm leading-6 text-white/60">Use Clean for a simplified app shell, or switch back to Classic if you prefer the original layout.</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {APP_UI_MODE_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleUiModeChange(option.id)}
                          className={cn(
                            "rounded-[18px] border px-4 py-3 text-left transition",
                            appUiMode === option.id ? "border-cyan-300/45 bg-cyan-500/12 text-white" : "border-white/10 bg-black/30 text-white/72 hover:bg-white/[0.06]"
                          )}
                        >
                          <span className="block font-semibold">{option.label}</span>
                          <span className="mt-1 block text-xs text-white/50">{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Theme color</p>
                        <p className="mt-1 text-sm leading-6 text-white/60">Changes the app shell theme on this device. This is a local preference and does not affect other users.</p>
                      </div>
                      <div className="h-12 w-12 rounded-full border border-white/15" style={{ background: selectedAppTheme.accent }} aria-hidden="true" />
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {APP_THEME_OPTIONS.map((theme) => (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => handleThemeChange(theme.id)}
                          className={cn(
                            "rounded-[22px] border p-4 text-left transition",
                            appThemeId === theme.id ? "border-white/35 bg-white/[0.10]" : "border-white/10 bg-black/35 hover:bg-white/[0.06]"
                          )}
                        >
                          <span className="flex items-center gap-3">
                            <span className="h-8 w-8 rounded-full border border-white/15" style={{ background: theme.accent }} aria-hidden="true" />
                            <span className="font-semibold text-white">{theme.label}</span>
                          </span>
                          <span className="mt-2 block text-sm leading-5 text-white/58">{theme.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-black/35 p-4">
                    <p className="text-sm font-semibold text-white">Font size</p>
                    <p className="mt-1 text-sm leading-6 text-white/60">Adjusts the app UI scale on this device.</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-4">
                      {APP_FONT_SCALE_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleFontScaleChange(option.id)}
                          className={cn(
                            "rounded-[18px] border px-4 py-3 text-left transition",
                            appFontScale === option.id ? "border-white/35 bg-white/[0.10] text-white" : "border-white/10 bg-black/30 text-white/72 hover:bg-white/[0.06]"
                          )}
                        >
                          <span className="block font-semibold">{option.label}</span>
                          <span className="mt-1 block text-xs text-white/50">{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {settingsAppearanceMessage ? (
                    <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{settingsAppearanceMessage}</div>
                  ) : null}
                </div>
              </Card>

              <Card title="Account">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[22px] border border-white/10 bg-black/35 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Signed in as</p>
                    <p className="mt-2 break-words text-lg font-semibold text-white">{username || "Guest"}</p>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-black/35 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Access level</p>
                    <p className="mt-2 text-lg font-semibold text-white">{isAdmin ? "Admin" : "Standard user"}</p>
                  </div>
                </div>
                <div className="flex justify-start">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={logoutBusy}
                    className="inline-flex min-h-12 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10 px-5 py-3 text-base font-semibold text-red-100 transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {logoutBusy ? "Logging out..." : "Logout"}
                  </button>
                </div>
              </Card>

              <Card title="Change password">
                <p className="text-sm leading-6 text-white/65">Update the current account password. This keeps the current session active.</p>
                <div className="grid gap-3">
                  <input
                    type="password"
                    value={passwordCurrent}
                    onChange={(event) => setPasswordCurrent(event.target.value)}
                    placeholder="Current password"
                    autoComplete="current-password"
                    className="w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                  />
                  <input
                    type="password"
                    value={passwordNew}
                    onChange={(event) => setPasswordNew(event.target.value)}
                    placeholder="New password"
                    autoComplete="new-password"
                    className="w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                  />
                  <input
                    type="password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    className="w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <ActionButton onClick={() => void handleChangePassword()} disabled={passwordBusy}>
                    {passwordBusy ? "Changing..." : "Change Password"}
                  </ActionButton>
                </div>
                {passwordMessage ? (
                  <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{passwordMessage}</div>
                ) : null}
              </Card>

              <Card title="Comfy connection">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[22px] border border-white/10 bg-black/35 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Status</p>
                    <p className={cn("mt-2 text-lg font-semibold", connected ? "text-emerald-200" : "text-amber-200")}>
                      {connected ? "Connected" : "Not verified"}
                    </p>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-black/35 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Last checked</p>
                    <p className="mt-2 text-sm font-semibold text-white/82">{settingsComfyCheckedAt || "Not checked this session"}</p>
                  </div>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-black/35 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Resolved Comfy URL</p>
                  <p className="mt-2 break-all font-mono text-sm text-white/82">{settingsComfyBaseUrl || "Run a status check to display the resolved URL."}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <ActionButton onClick={() => void handleSettingsCheckComfy()} disabled={settingsComfyBusy}>
                    {settingsComfyBusy ? "Checking..." : "Check Comfy Status"}
                  </ActionButton>
                </div>
              </Card>

              <Card title="Pipeline recovery">
                <p className="text-sm leading-6 text-white/65">Use this only when the current generation/progress state is stuck. It unlocks the OTG pipeline state and clears the current preview pointer. It does not delete Gallery, Favorites, or Production projects.</p>
                <div className="flex flex-wrap gap-3">
                  <ActionButton onClick={() => void handleSettingsClearPipeline()} disabled={settingsPipelineBusy}>
                    {settingsPipelineBusy ? "Clearing..." : "Clear Current Pipeline"}
                  </ActionButton>
                </div>
                {settingsPipelineMessage ? (
                  <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{settingsPipelineMessage}</div>
                ) : null}
              </Card>

              <Card title="Local app state">
                <p className="text-sm leading-6 text-white/65">Clears saved browser UI state for this app on this device, including remembered tab/view preferences. Server files, Gallery, Favorites, and Production projects are not touched.</p>
                <div className="flex flex-wrap gap-3">
                  <GhostButton onClick={handleSettingsClearLocalState}>Clear Local UI State</GhostButton>
                </div>
                {settingsLocalMessage ? (
                  <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{settingsLocalMessage}</div>
                ) : null}
              </Card>

              <Card title="Delete account">
                <div className="rounded-[22px] border border-red-400/20 bg-red-500/10 p-4 text-sm leading-6 text-red-100/85">
                  This permanently deletes the signed-in account record and this user&apos;s saved OTG files where the server can remove them. This action cannot be undone from the app.
                </div>
                <div className="grid gap-3">
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(event) => setDeletePassword(event.target.value)}
                    placeholder="Password required"
                    autoComplete="current-password"
                    className="w-full rounded-[18px] border border-red-400/20 bg-black/45 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-red-300/45"
                  />
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(event) => setDeleteConfirmText(event.target.value)}
                    placeholder="Type DELETE to confirm"
                    className="w-full rounded-[18px] border border-red-400/20 bg-black/45 px-4 py-3 text-white outline-none placeholder:text-white/35 focus:border-red-300/45"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleDeleteAccount()}
                    disabled={deleteAccountBusy}
                    className="inline-flex min-h-12 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10 px-5 py-3 text-base font-semibold text-red-100 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deleteAccountBusy ? "Deleting..." : "Delete Account"}
                  </button>
                </div>
                {deleteAccountMessage ? (
                  <div className="rounded-[18px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/85">{deleteAccountMessage}</div>
                ) : null}
              </Card>
            </div>
          </div>
        ) : null}
      </div>

      <GalleryWorkspace
        activeTab={tab}
        galleryItems={galleryItems}
        galleryBusy={galleryBusy}
        galleryForcePullBusy={galleryForcePullBusy}
        galleryFilter={galleryFilter}
        onGalleryFilterChange={setGalleryFilter}
        gallerySort={gallerySort}
        onGallerySortChange={setGallerySort}
        galleryViewMode={galleryViewMode}
        onGalleryViewModeChange={setGalleryViewMode}
        galleryItemsPerPage={galleryItemsPerPage}
        onGalleryItemsPerPageChange={setGalleryItemsPerPage}
        galleryPage={galleryPage}
        onGalleryPageChange={setGalleryPage}
        gallerySearch={gallerySearch}
        onGallerySearchChange={setGallerySearch}
        galleryActionBusyName={galleryActionBusyName}
        galleryActionBusyKind={galleryActionBusyKind}
        galleryActionsLocked={galleryActionsLocked}
        visibleGalleryItems={visibleGalleryItems}
        galleryTotalPages={galleryTotalPages}
        onRefreshGallery={() => void loadGallery()}
        onForcePullGallery={() => void handleGalleryForcePull()}
        favoriteItems={filteredFavoriteItems}
        favoritesRawCount={favoriteItems.length}
        favoritesBusy={favoritesBusy}
        favoritesFilter={favoritesFilter}
        onFavoritesFilterChange={setFavoritesFilter}
        favoritesSort={favoritesSort}
        onFavoritesSortChange={setFavoritesSort}
        favoritesViewMode={favoritesViewMode}
        onFavoritesViewModeChange={setFavoritesViewMode}
        favoritesSearch={favoritesSearch}
        onFavoritesSearchChange={setFavoritesSearch}
        favoritesItemsPerPage={favoritesItemsPerPage}
        onFavoritesItemsPerPageChange={setFavoritesItemsPerPage}
        favoritesPage={favoritesPage}
        onFavoritesPageChange={setFavoritesPage}
        favoritesTotalPages={favoritesTotalPages}
        visibleFavoriteItems={visibleFavoriteItems}
        onRefreshFavorites={() => void loadFavorites()}
        onDownload={handleGalleryDownload}
        onFavorite={handleGalleryFavorite}
        onRename={handleGalleryRename}
        onRedo={handleGalleryRedo}
        onEdit={handleGalleryEdit}
        onAnimate={handleGalleryAnimate}
        onExtend={handleGalleryExtend}
        onCreateCharacter={handleGalleryCreateCharacter}
        onDelete={handleGalleryDelete}
        onOpenViewer={openViewer}
        viewerState={viewerState}
        viewerItem={viewerItem}
        viewerUrl={viewerUrl}
        viewerTitle={viewerTitle}
        viewerItems={viewerItems}
        viewerIndex={viewerIndex}
        viewerIsVideo={viewerIsVideo}
        viewerCanPrev={viewerCanPrev}
        viewerCanNext={viewerCanNext}
        onCloseViewer={() => setViewerState(null)}
        onMoveViewer={moveViewer}
        onViewerTouchStart={handleViewerTouchStart}
        onViewerTouchEnd={handleViewerTouchEnd}
        editModal={editModal}
        onCloseEditModal={() => { if (!galleryActionsLocked) setEditModal(null); }}
        onEditPositivePromptChange={(value) => setEditModal((prev) => (prev ? { ...prev, positivePrompt: value } : prev))}
        onEditNegativePromptChange={(value) => setEditModal((prev) => (prev ? { ...prev, negativePrompt: value } : prev))}
        onEnhanceEdit={() => void handleEnhanceEditModal()}
        onSubmitEdit={() => void submitGalleryEdit()}
        animateModal={animateModal}
        onCloseAnimateModal={() => { if (!galleryActionsLocked) setAnimateModal(null); }}
        onAnimatePositivePromptChange={(value) => setAnimateModal((prev) => (prev ? { ...prev, positivePrompt: value } : prev))}
        onAnimateNegativePromptChange={(value) => setAnimateModal((prev) => (prev ? { ...prev, negativePrompt: value } : prev))}
        onAnimateDurationChange={(value) =>
          setAnimateModal((prev) => (prev ? { ...prev, durationSeconds: clampDuration(value) } : prev))
        }
        onEnhanceAnimate={() => void handleEnhanceAnimateModal()}
        onSubmitAnimate={() => void submitGalleryAnimate()}
        extendModal={extendModal}
        onCloseExtendModal={() => { if (!galleryActionsLocked) setExtendModal(null); }}
        onExtendPositivePromptChange={(value) => setExtendModal((prev) => (prev ? { ...prev, positivePrompt: value } : prev))}
        onExtendNegativePromptChange={(value) => setExtendModal((prev) => (prev ? { ...prev, negativePrompt: value } : prev))}
        onExtendDurationChange={(value) =>
          setExtendModal((prev) => (prev ? { ...prev, durationSeconds: clampDuration(value) } : prev))
        }
        onClearExtendPrompts={() => setExtendModal((prev) => (prev ? { ...prev, positivePrompt: "", negativePrompt: "" } : prev))}
        onEnhanceExtend={() => void handleEnhanceExtendModal()}
        onSubmitExtend={() => void submitGalleryExtend()}
      />

      <SpinDialNav tab={tab} onTab={setTab} isAdmin={isAdmin} uiMode={appUiMode} />
    </main>
  );
}
