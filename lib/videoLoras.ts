import fs from "node:fs";
import path from "node:path";
import { VIDEO_GENERATE_WORKFLOWS, type VideoGenerateOperation } from "@/lib/videoGenerateWorkflows";

export type VideoLoraFamily = "wan" | "ltx";
export type VideoLoraCatalogStatus = "active" | "metadata_pending" | "disabled";

export type VideoLoraCatalogEntry = {
  id: string;
  displayName: string;
  filename: string;
  aliases: string[];
  family: VideoLoraFamily;
  baseModelVariant: string;
  supportedWorkflowIds: string[];
  supportedModes: Array<VideoGenerateOperation | "video_to_video">;
  description: string;
  triggerWords: string[];
  recommendedStrength: number | null;
  minimumStrength: number;
  maximumStrength: number;
  defaultHighNoiseStrength: number | null;
  defaultLowNoiseStrength: number | null;
  promptExample: string;
  dependencies: string[];
  limitations: string[];
  license: string;
  commercialUse: string;
  sourceUrl?: string;
  catalogStatus: VideoLoraCatalogStatus;
  sortOrder: number;
};

export type VideoLoraCatalog = {
  schemaVersion: string;
  updatedAt: string;
  entries: VideoLoraCatalogEntry[];
};

export type VideoLoraSelection = {
  id: string;
  strength: number;
  highNoiseStrength?: number;
  lowNoiseStrength?: number;
};

export type ValidatedVideoLora = VideoLoraSelection & {
  entry: VideoLoraCatalogEntry;
};

export class VideoLoraCompatibilityError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 409 = 400,
    public readonly code = "video_lora_invalid"
  ) {
    super(message);
    this.name = "VideoLoraCompatibilityError";
  }
}

function catalogPath() {
  const configured = String(process.env.OTG_VIDEO_LORA_CATALOG_FILE || "").trim();
  return configured
    ? path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
    : path.resolve(process.cwd(), "config", "video-loras.json");
}

function nonEmpty(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid video LoRA catalog field: ${field}.`);
}

export function validateVideoLoraCatalog(catalog: VideoLoraCatalog) {
  nonEmpty(catalog?.schemaVersion, "schemaVersion");
  if (!Array.isArray(catalog?.entries)) throw new Error("Video LoRA catalog entries must be an array.");
  const ids = new Set<string>();
  for (const entry of catalog.entries) {
    nonEmpty(entry.id, "entry.id");
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(entry.id)) throw new Error(`Invalid video LoRA catalog id: ${entry.id}.`);
    if (ids.has(entry.id)) throw new Error(`Duplicate video LoRA catalog id: ${entry.id}.`);
    ids.add(entry.id);
    nonEmpty(entry.displayName, `${entry.id}.displayName`);
    nonEmpty(entry.filename, `${entry.id}.filename`);
    if (!(["wan", "ltx"] as string[]).includes(entry.family)) throw new Error(`Invalid family for ${entry.id}.`);
    if (!(["active", "metadata_pending", "disabled"] as string[]).includes(entry.catalogStatus)) {
      throw new Error(`Invalid catalogStatus for ${entry.id}.`);
    }
    if (!Array.isArray(entry.supportedWorkflowIds) || !Array.isArray(entry.supportedModes)) {
      throw new Error(`Missing compatibility arrays for ${entry.id}.`);
    }
    if (!Number.isFinite(entry.minimumStrength) || !Number.isFinite(entry.maximumStrength) || entry.minimumStrength < 0 || entry.maximumStrength > 2 || entry.minimumStrength > entry.maximumStrength) {
      throw new Error(`Invalid strength range for ${entry.id}.`);
    }
    if (entry.recommendedStrength !== null && (!Number.isFinite(entry.recommendedStrength) || entry.recommendedStrength < entry.minimumStrength || entry.recommendedStrength > entry.maximumStrength)) {
      throw new Error(`Invalid recommendedStrength for ${entry.id}.`);
    }
    if (entry.catalogStatus === "active") {
      for (const field of ["description", "promptExample", "license", "commercialUse", "baseModelVariant"] as const) {
        nonEmpty(entry[field], `${entry.id}.${field}`);
      }
      if (!Number.isFinite(entry.recommendedStrength)) throw new Error(`Active catalog entry ${entry.id} requires a recommended strength.`);
      if (!entry.supportedWorkflowIds.length || !entry.supportedModes.length) throw new Error(`Active catalog entry ${entry.id} requires compatibility metadata.`);
      if (!Array.isArray(entry.dependencies) || !entry.dependencies.length) throw new Error(`Active catalog entry ${entry.id} requires dependencies.`);
      if (!Array.isArray(entry.limitations) || !entry.limitations.length) throw new Error(`Active catalog entry ${entry.id} requires limitations.`);
      if (!Array.isArray(entry.triggerWords)) throw new Error(`Active catalog entry ${entry.id} requires a trigger-word statement.`);
    }
  }
  return catalog;
}

export function loadVideoLoraCatalog() {
  return validateVideoLoraCatalog(JSON.parse(fs.readFileSync(catalogPath(), "utf8")) as VideoLoraCatalog);
}

export function normalizeVideoLoraFilename(value: unknown) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

export function videoWorkflowDefinition(workflowId: unknown) {
  const normalized = String(workflowId || "").trim().replace(/\.json$/i, "").toLowerCase();
  return VIDEO_GENERATE_WORKFLOWS.find((workflow) => workflow.workflowId.toLowerCase() === normalized) || null;
}

export function detectVideoWorkflowFamily(workflowId: unknown): VideoLoraFamily | null {
  const workflow = videoWorkflowDefinition(workflowId);
  return workflow?.modelId === "wan22" ? "wan" : workflow?.modelId === "ltx23" ? "ltx" : null;
}

export function videoWorkflowMode(workflowId: unknown): VideoGenerateOperation | null {
  return videoWorkflowDefinition(workflowId)?.operation || null;
}

function strength(value: unknown, entry: VideoLoraCatalogEntry, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new VideoLoraCompatibilityError(`${entry.displayName} has an invalid ${field}.`);
  if (parsed < entry.minimumStrength || parsed > entry.maximumStrength) {
    throw new VideoLoraCompatibilityError(`${entry.displayName} ${field} must be between ${entry.minimumStrength} and ${entry.maximumStrength}.`);
  }
  return parsed;
}

export function resolveVideoLoraSelections(
  raw: unknown,
  workflowId: string,
  catalog = loadVideoLoraCatalog()
): ValidatedVideoLora[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new VideoLoraCompatibilityError("videoLoras must be an array.");
  if (raw.length > 2) throw new VideoLoraCompatibilityError("Select no more than two Video LoRAs.");
  const family = detectVideoWorkflowFamily(workflowId);
  const mode = videoWorkflowMode(workflowId);
  if (!family || !mode) {
    if (!raw.length) return [];
    throw new VideoLoraCompatibilityError("Video LoRAs are supported only for exposed Wan and LTX Generate Video workflows.");
  }
  const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  return raw.map((item: any) => {
    const id = String(item?.id || "").trim();
    if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
      throw new VideoLoraCompatibilityError("Video LoRA IDs may not contain path separators or traversal segments.");
    }
    if (seen.has(id)) throw new VideoLoraCompatibilityError(`Duplicate Video LoRA ID: ${id}.`);
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) throw new VideoLoraCompatibilityError(`Unknown Video LoRA ID: ${id}.`);
    if (entry.catalogStatus !== "active") throw new VideoLoraCompatibilityError(`${entry.displayName} is not selectable because its catalog metadata is incomplete or disabled.`, 409, "video_lora_not_selectable");
    if (entry.family !== family) throw new VideoLoraCompatibilityError(`${entry.displayName} is for ${entry.family.toUpperCase()}, not ${family.toUpperCase()}.`, 409, "video_lora_family_mismatch");
    if (!entry.supportedWorkflowIds.includes(workflowId) || !entry.supportedModes.includes(mode)) {
      throw new VideoLoraCompatibilityError(`${entry.displayName} is not compatible with ${workflowId} (${mode}).`, 409, "video_lora_workflow_mismatch");
    }
    const unified = strength(item?.strength, entry, "strength");
    return {
      id,
      strength: unified,
      ...(item?.highNoiseStrength === undefined ? {} : { highNoiseStrength: strength(item.highNoiseStrength, entry, "high-noise strength") }),
      ...(item?.lowNoiseStrength === undefined ? {} : { lowNoiseStrength: strength(item.lowNoiseStrength, entry, "low-noise strength") }),
      entry,
    };
  });
}

export function assertVideoLorasInstalled(
  selections: ValidatedVideoLora[],
  installedFilenames: Iterable<string>,
  backendLabel: string
) {
  const installed = new Set([...installedFilenames].map(normalizeVideoLoraFilename));
  const missing = selections.filter((selection) => !installed.has(normalizeVideoLoraFilename(selection.entry.filename)));
  if (missing.length) {
    throw new VideoLoraCompatibilityError(
      `${backendLabel} cannot run this request because LoRA ${missing.map((item) => item.entry.displayName).join(", ")} is not installed.`,
      409,
      "video_lora_missing_backend"
    );
  }
  return true;
}

type PatchBranch = {
  name: "high" | "low" | "all";
  sourceNodeId: string;
  sourceClassTypes: string[];
  targetNodeId: string;
  targetClassTypes: string[];
  targetInput: string;
};

export type VideoLoraPatchDefinition = {
  family: VideoLoraFamily;
  mode: VideoGenerateOperation;
  branches: PatchBranch[];
  requiredInternalLoras: Array<{ nodeId: string; filename: string; powerSlot?: string }>;
};

const ltxPatch = (mode: VideoGenerateOperation): VideoLoraPatchDefinition => ({
  family: "ltx",
  mode,
  branches: [{ name: "all", sourceNodeId: "287", sourceClassTypes: ["Power Lora Loader (rgthree)"], targetNodeId: "358", targetClassTypes: ["Any Switch (rgthree)"], targetInput: "any_02" }],
  requiredInternalLoras: [
    { nodeId: "287", powerSlot: "lora_1", filename: "Ltx2.3-Licon-VBVR-I2V-96000-R32.safetensors" },
    { nodeId: "287", powerSlot: "lora_2", filename: "LTX2.3-IC-LORA-Dual-Character.safetensors" },
    { nodeId: "453", filename: "ltx-2.3-22b-distilled-lora-384-1.1.safetensors" },
  ],
});

export const VIDEO_LORA_PATCH_POINTS: Record<string, VideoLoraPatchDefinition> = {
  "presets/Create a Video": ltxPatch("text_to_video"),
  "presets/Create a Video from Images": ltxPatch("image_to_video"),
  "presets/Create First Image to Last Image Video": ltxPatch("first_last_frame"),
  "presets/WAN 2.2 T2V GGUF": { family: "wan", mode: "text_to_video", branches: [
    { name: "high", sourceNodeId: "113", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "122", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
    { name: "low", sourceNodeId: "108", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "101", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
  ], requiredInternalLoras: [
    { nodeId: "113", filename: "Wan-2.x/Acceleration/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors" },
    { nodeId: "108", filename: "Wan-2.x/Acceleration/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors" },
  ] },
  "presets/WAN 2.2 T2V SafeTensor": { family: "wan", mode: "text_to_video", branches: [
    { name: "high", sourceNodeId: "113", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "122", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
    { name: "low", sourceNodeId: "108", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "101", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
  ], requiredInternalLoras: [
    { nodeId: "113", filename: "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors" },
    { nodeId: "108", filename: "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors" },
  ] },
  "presets/WAN 2.2 I2V GGUF": { family: "wan", mode: "image_to_video", branches: [
    { name: "high", sourceNodeId: "75", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "71", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
    { name: "low", sourceNodeId: "70", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "73", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
  ], requiredInternalLoras: [
    { nodeId: "75", filename: "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors" },
    { nodeId: "70", filename: "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors" },
  ] },
  "presets/WAN 2.2 I2V SafeTensor": { family: "wan", mode: "image_to_video", branches: [
    { name: "high", sourceNodeId: "75", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "71", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
    { name: "low", sourceNodeId: "70", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "73", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
  ], requiredInternalLoras: [
    { nodeId: "75", filename: "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors" },
    { nodeId: "70", filename: "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors" },
  ] },
  "presets/WAN 2.2 FLF GGUF": { family: "wan", mode: "first_last_frame", branches: [
    { name: "high", sourceNodeId: "156", sourceClassTypes: ["UnetLoaderGGUF"], targetNodeId: "168", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
    { name: "low", sourceNodeId: "157", sourceClassTypes: ["UnetLoaderGGUF"], targetNodeId: "169", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
  ], requiredInternalLoras: [
    { nodeId: "151", filename: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors" },
    { nodeId: "155", filename: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors" },
  ] },
  "presets/WAN 2.2 FLF SafeTensor": { family: "wan", mode: "first_last_frame", branches: [
    { name: "high", sourceNodeId: "151", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "168", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
    { name: "low", sourceNodeId: "155", sourceClassTypes: ["LoraLoaderModelOnly"], targetNodeId: "169", targetClassTypes: ["PathchSageAttentionKJ"], targetInput: "model" },
  ], requiredInternalLoras: [
    { nodeId: "151", filename: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors" },
    { nodeId: "155", filename: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors" },
  ] },
};

function cloneGraph<T>(graph: T): T {
  return JSON.parse(JSON.stringify(graph));
}

function sameRef(value: unknown, nodeId: string) {
  return Array.isArray(value) && String(value[0]) === nodeId && Number(value[1]) === 0;
}

function validatePatchGraph(graph: Record<string, any>, workflowId: string, definition: VideoLoraPatchDefinition) {
  for (const internal of definition.requiredInternalLoras) {
    const node = graph[internal.nodeId];
    if (!node?.inputs) throw new VideoLoraCompatibilityError(`Video LoRA patch failed closed: required internal node ${internal.nodeId} is missing.`, 409, "video_lora_patch_mismatch");
    const actual = internal.powerSlot ? node.inputs[internal.powerSlot]?.lora : node.inputs.lora_name;
    if (actual !== internal.filename) throw new VideoLoraCompatibilityError(`Video LoRA patch failed closed: required internal LoRA node ${internal.nodeId} changed.`, 409, "video_lora_patch_mismatch");
  }
  for (const branch of definition.branches) {
    const source = graph[branch.sourceNodeId];
    const target = graph[branch.targetNodeId];
    if (!source || !branch.sourceClassTypes.includes(String(source.class_type))) {
      throw new VideoLoraCompatibilityError(`Video LoRA patch failed closed: ${workflowId} source node ${branch.sourceNodeId} changed.`, 409, "video_lora_patch_mismatch");
    }
    if (!target?.inputs || !branch.targetClassTypes.includes(String(target.class_type)) || !sameRef(target.inputs[branch.targetInput], branch.sourceNodeId)) {
      throw new VideoLoraCompatibilityError(`Video LoRA patch failed closed: ${workflowId} target ${branch.targetNodeId}.${branch.targetInput} changed.`, 409, "video_lora_patch_mismatch");
    }
  }
}

function nextNumericNodeId(graph: Record<string, any>) {
  const numeric = Object.keys(graph).map(Number).filter(Number.isFinite);
  let next = (numeric.length ? Math.max(...numeric) : 0) + 1;
  return () => String(next++);
}

export function applyVideoLoras(
  originalGraph: Record<string, any>,
  workflowId: string,
  selections: ValidatedVideoLora[]
) {
  const graph = cloneGraph(originalGraph);
  if (!selections.length) return { graph, applied: [] as Array<Record<string, unknown>> };
  const definition = VIDEO_LORA_PATCH_POINTS[workflowId];
  if (!definition) throw new VideoLoraCompatibilityError(`No Video LoRA patch contract exists for ${workflowId}.`, 409, "video_lora_patch_missing");
  validatePatchGraph(graph, workflowId, definition);
  const allocate = nextNumericNodeId(graph);
  const applied: Array<Record<string, unknown>> = [];
  for (const branch of definition.branches) {
    let previous: [string, number] = [branch.sourceNodeId, 0];
    for (const selection of selections) {
      const nodeId = allocate();
      const selectedStrength = branch.name === "high"
        ? selection.highNoiseStrength ?? selection.strength
        : branch.name === "low"
          ? selection.lowNoiseStrength ?? selection.strength
          : selection.strength;
      graph[nodeId] = {
        inputs: { model: previous, lora_name: selection.entry.filename, strength_model: selectedStrength },
        class_type: "LoraLoaderModelOnly",
        _meta: { title: `OTG Video LoRA: ${selection.entry.displayName} (${branch.name})` },
      };
      previous = [nodeId, 0];
      applied.push({ id: selection.id, strength: selectedStrength, branch: branch.name, nodeId });
    }
    graph[branch.targetNodeId].inputs[branch.targetInput] = previous;
  }
  return { graph, applied };
}

export function publicVideoLoraSelectionMetadata(selections: ValidatedVideoLora[]) {
  return selections.map(({ id, strength, highNoiseStrength, lowNoiseStrength }) => ({
    id,
    strength,
    ...(highNoiseStrength === undefined ? {} : { highNoiseStrength }),
    ...(lowNoiseStrength === undefined ? {} : { lowNoiseStrength }),
  }));
}
