import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import { H3_STUDIO_WORKFLOWS, parseH3StudioPlan, type H3StudioPlan } from "@/lib/h3StudioPlan";
import { DEFAULT_H3_ADVANCED_SETTINGS, normalizeH3AdvancedSettings } from "@/lib/production/h3Settings";
import type { H3DirectJobInput, H3DirectReference } from "@/lib/h3DirectJobs";

// Bump whenever compiler behavior or normalization changes.
export const H3_STUDIO_COMPILER_VERSION = "h3-studio-compiler-v2.6-singularity2";
export type H3StudioDependency = { filename: string; sha256: string; bytes: number };
export function stableH3StudioJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableH3StudioJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableH3StudioJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new Error("Identity requires finite JSON values; no undefined inputs may be omitted.");
}
export function h3StudioDigest(value: unknown) { return crypto.createHash("sha256").update(stableH3StudioJson(value)).digest("hex"); }
/** Exact one-shot request identity. Reusable qualification deliberately excludes these variables. */
export function h3StudioQualificationRequestBinding(plan: H3StudioPlan, input: H3DirectJobInput) {
  const media = (reference: H3DirectReference | null) => {
    if (!reference) return null;
    if (!path.isAbsolute(reference.path) || fs.realpathSync(reference.path) !== reference.path) throw new Error("Exact regular local reference required.");
    const fd = fs.openSync(reference.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(fd), hash = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
      if (!before.isFile() || before.size < 1) throw new Error("Readable reference bytes required.");
      for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break; hash.update(buffer.subarray(0,n)); }
      const after = fs.fstatSync(fd);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Reference changed while binding request.");
      return { path: reference.path, name: reference.name, description: reference.description, includeAudio: reference.includeAudio === true,
        sha256: hash.digest("hex"), bytes: after.size };
    } finally { fs.closeSync(fd); }
  };
  if (input.videoEdit || input.studioSource || input.rifeInterpolation60Fps) throw new Error("Qualification must use the exact prepared Studio request without extra edit/finalization modes.");
  return { schemaVersion: 2, plan: parseH3StudioPlan(plan), mode: input.mode, quality: input.quality, orientation: input.orientation,
    durationSeconds: input.durationSeconds, prompt: input.prompt, seed: input.seed,
    h3Settings: normalizeH3AdvancedSettings(input.h3Settings || DEFAULT_H3_ADVANCED_SETTINGS, input.images.length),
    optionalLoras: input.optionalLoras.map(l => ({ id: l.id, strength: l.strength })),
    firstImage: media(input.firstImage), lastImage: media(input.lastImage), images: input.images.map(media), videos: input.videos.map(media), audios: input.audios.map(media) };
}
export function h3StudioQualificationRequestDigest(plan: H3StudioPlan, input: H3DirectJobInput) { return h3StudioDigest(h3StudioQualificationRequestBinding(plan, input)); }
export const isH3StudioSha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validH3StudioDependency(value: unknown): value is H3StudioDependency {
  const d = value as H3StudioDependency | null;
  return !!d && typeof d.filename === "string" && !!d.filename.trim() && isH3StudioSha256(d.sha256) && Number.isSafeInteger(d.bytes) && d.bytes > 0;
}
export const H3_STUDIO_ASSET_FIELDS: Record<string, string> = {
  UNETLoader: "unet_name", CLIPLoader: "clip_name", VAELoader: "vae_name", LoraLoaderModelOnly: "lora_name",
  ModelPreviewOverrideKJ: "tiny_vae",
  SelfLiftH3Sampler: "upscaler_model",
};
/** Exact graph, including all inputs, media names, prompt, seed, prefix and metadata. */
export function h3StudioBoundGraphDigest(graph: H3PromptGraph) { return h3StudioDigest(graph); }
/** Narrow class/field allowlist: never omit arbitrary prompt/seed/file inputs. Links remain links. */
export function normalizeH3StudioQualificationGraph(graph: H3PromptGraph): H3PromptGraph {
  const normalized = structuredClone(graph);
  const variables: Record<string, readonly string[]> = {
    MiniMaxH3ImageToVideo: ["prompt"], MiniMaxH3ReferenceToVideo: ["prompt"],
    RandomNoise: ["noise_seed"], SelfLiftH3Sampler: ["seed"], LoadImage: ["image"], LoadAudio: ["audio"], LoadVideo: ["file"], SaveVideo: ["filename_prefix"],
  };
  for (const node of Object.values(normalized)) {
    for (const field of variables[node.class_type] || []) {
      const value = node.inputs[field];
      if (typeof value === "string" || typeof value === "number") node.inputs[field] = `[job:${node.class_type}.${field}]`;
    }
  }
  return normalized;
}
export function h3StudioQualificationFingerprint(input: { plan: H3StudioPlan; graph: H3PromptGraph; templateSha256: string;
  dependencies: readonly H3StudioDependency[]; compilerVersion?: string }) {
  // Missing dependencies may produce a preview identity, but readiness must fail closed.
  const { prompt: _prompt, originalPrompt: _originalPrompt, seed: _seed, ...configuration } = input.plan;
  return h3StudioDigest({ schemaVersion: 2, compilerVersion: input.compilerVersion || H3_STUDIO_COMPILER_VERSION,
    family: H3_STUDIO_WORKFLOWS.find(w => w.id === input.plan.workflowId)?.family || "invalid",
    automaticRealism: input.plan.checkpoint === "singularity", configuration,
    templateSha256: input.templateSha256, graph: normalizeH3StudioQualificationGraph(input.graph),
    dependencies: [...input.dependencies].sort((a, b) => a.filename.localeCompare(b.filename)) });
}
/** Revision includes dirty source bytes, not just HEAD. Paths are relative and fixed by this harness. */
export function h3StudioSourceRevision(files: ReadonlyArray<{ path: string; sha256: string }>) {
  if (!files.length || files.some(file => !isH3StudioSha256(file.sha256))) throw new Error("Exact source hashes required.");
  return h3StudioDigest([...files].sort((a, b) => a.path.localeCompare(b.path)));
}
export function computeH3StudioSourceRevision(root = process.cwd()) {
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 8_000_000 }).split("\0");
  const selected = [...new Set(names)].filter(name => /^(?:lib\/|scripts\/h3-studio\/|comfy_workflows\/|package(?:-lock)?\.json$|tsconfig\.json$)/.test(name)).sort();
  return h3StudioSourceRevision(selected.map(name => {
    const file = path.join(root, name);
    if (!fs.lstatSync(file).isFile()) throw new Error("Qualification source must be regular files.");
    return { path: name, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
  }));
}
