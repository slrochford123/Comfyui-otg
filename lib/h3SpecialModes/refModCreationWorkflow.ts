import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import type { H3RefModAudioCategory, H3RefModCreateKind } from "@/lib/h3SpecialModes/refModCreation";

export type H3RefModVisualPackWorkflowInput = {
  folder: string;
  name: string;
  subfolder: string;
  kind: Extract<H3RefModCreateKind, "character" | "motion">;
  description?: string;
  sourceCount: number;
};

export type H3RefModAudioPackWorkflowInput = {
  audioFilename: string;
  name: string;
  subfolder: string;
  audioCategory: H3RefModAudioCategory;
  description?: string;
};

export type H3RefModCreationBuiltWorkflow = {
  workflowId: "h3-refmod-visual-pack" | "h3-refmod-audio-pack";
  workflowFile: string;
  graph: H3PromptGraph;
  outputNodeId: string;
  libraryName: string;
};

const VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors";
const AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function safeName(value: string) {
  const name = clean(value);
  if (!name || name.includes("/") || name.includes("\\") || name.endsWith(".safetensors")) {
    throw new Error("RefMod workflow name must be a file-safe base name.");
  }
  return name;
}

function safeSubfolder(value: string) {
  const subfolder = clean(value).replaceAll("\\", "/");
  if (!subfolder || subfolder.startsWith("/") || subfolder.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("RefMod workflow subfolder must stay inside the RefMod library.");
  }
  return subfolder;
}

function conceptForVisualKind(kind: H3RefModVisualPackWorkflowInput["kind"]) {
  return kind === "character" ? "identity" : "pose_motion";
}

function visualSettings(kind: H3RefModVisualPackWorkflowInput["kind"], sourceCount: number) {
  if (kind === "motion") {
    return {
      maxItems: 1,
      maxFrames: 49,
      refResolution: 768,
      latentFrames: 49,
      maxTokens: 32768,
    };
  }
  return {
    maxItems: Math.min(Math.max(Math.round(sourceCount), 1), 8),
    maxFrames: 49,
    refResolution: 768,
    latentFrames: 16,
    maxTokens: 32768,
  };
}

export function buildH3RefModVisualPackWorkflow(
  input: H3RefModVisualPackWorkflowInput,
): H3RefModCreationBuiltWorkflow {
  const name = safeName(input.name);
  const subfolder = safeSubfolder(input.subfolder);
  const folder = clean(input.folder);
  if (!folder) throw new Error("RefMod visual source folder is required.");
  const settings = visualSettings(input.kind, input.sourceCount);
  const graph: H3PromptGraph = {
    "1": {
      class_type: "VAELoader",
      inputs: { vae_name: VIDEO_VAE },
      _meta: { title: "H3 Video VAE" },
    },
    "2": {
      class_type: "MiniMaxH3RefModFolderLoader",
      inputs: {
        folder,
        max_items: settings.maxItems,
        max_frames: settings.maxFrames,
        max_edge: 1024,
      },
      _meta: { title: "RefMod source folder" },
    },
    "3": {
      class_type: "MiniMaxH3RefModExtract",
      inputs: {
        refs_bundle: ["2", 0],
        vae: ["1", 0],
        name,
        mode: "Full Reference",
        concept_type: conceptForVisualKind(input.kind),
        background_retention: 0,
        ref_resolution: settings.refResolution,
        pool_h: 16,
        pool_w: 16,
        latent_frames: settings.latentFrames,
        identity: 0,
        merge: false,
        motion_only: false,
        multiplier: 1,
        max_tokens: settings.maxTokens,
        description: clean(input.description),
        save: false,
        extraction_preset: "manual",
        subfolder: "",
        budget_policy: "error",
      },
      _meta: { title: "Create RefMod in memory" },
    },
    "4": {
      class_type: "MiniMaxH3RefModSave",
      inputs: {
        mods: ["3", 0],
        filename_prefix: "",
        subfolder,
      },
      _meta: { title: "Save RefMod" },
    },
  };
  return {
    workflowId: "h3-refmod-visual-pack",
    workflowFile: "comfy_workflows/internal/h3-refmods/generated/visual-pack.api.json",
    graph,
    outputNodeId: "4",
    libraryName: `${subfolder}/${name}`,
  };
}

function audioConcept(category: H3RefModAudioCategory) {
  if (category === "music") return "music_style";
  if (category === "sound_fx") return "sound_fx";
  return "ambience";
}

export function buildH3RefModAudioPackWorkflow(
  input: H3RefModAudioPackWorkflowInput,
): H3RefModCreationBuiltWorkflow {
  const name = safeName(input.name);
  const subfolder = safeSubfolder(input.subfolder);
  const audio = clean(input.audioFilename);
  if (!audio) throw new Error("RefMod audio upload is required.");
  const graph: H3PromptGraph = {
    "1": {
      class_type: "LoadAudio",
      inputs: { audio, audioUI: null },
      _meta: { title: "Audio file" },
    },
    "2": {
      class_type: "VAELoader",
      inputs: { vae_name: AUDIO_VAE },
      _meta: { title: "H3 Audio VAE" },
    },
    "3": {
      class_type: "MiniMaxH3RefModAudioExtract",
      inputs: {
        audio: ["1", 0],
        audio_vae: ["2", 0],
        name,
        max_seconds: 30,
        max_tokens: 5120,
        budget_policy: "error",
        concept_type: audioConcept(input.audioCategory),
        description: clean(input.description),
        subfolder: "",
        save: false,
      },
      _meta: { title: "Create Audio RefMod in memory" },
    },
    "4": {
      class_type: "MiniMaxH3RefModSave",
      inputs: {
        mods: ["3", 0],
        filename_prefix: "",
        subfolder,
      },
      _meta: { title: "Save Audio RefMod" },
    },
  };
  return {
    workflowId: "h3-refmod-audio-pack",
    workflowFile: "comfy_workflows/internal/h3-refmods/generated/audio-pack.api.json",
    graph,
    outputNodeId: "4",
    libraryName: `${subfolder}/${name}`,
  };
}
