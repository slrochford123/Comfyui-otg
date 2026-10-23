import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import { H3_STUDIO_ASSET_FIELDS } from "@/lib/h3StudioIdentity";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";
import { validH3StudioRights, type H3StudioInventory, type H3StudioEvidence, type H3StudioRightsClearance, type H3StudioQualificationRecord } from "@/lib/h3StudioRegistry";
import { inspectStudioQualificationRuntime } from "@/lib/h3StudioRuntime";

/** Explicit local prepare only: hash selected installed files once, never on API previews.
 * assetPaths maps exact worker filenames to owner-readable absolute physical paths.
 * Run against the actual 3090 model filesystem (or its authoritative local mount).
 * Do not create synthetic hashes, capacities, runtime records or inherited LoRA rights.
 */
export function prepareH3StudioQualificationInventory(input: { graph: H3PromptGraph; assetPaths: Record<string, string>;
  assetRights: Record<string, H3StudioRightsClearance>; evidence: H3StudioEvidence }) {
  const inventory: Pick<H3StudioInventory, "assets" | "assetFiles" | "assetObservedAt"> = { assets: {}, assetFiles: {}, assetObservedAt: new Date().toISOString() };
  const evidence = structuredClone(input.evidence);
  if (evidence.schemaVersion !== 2 || !validH3StudioRights(evidence.upstreamAuthorization)) throw new Error("Separate private TEST owner authorization required.");
  // Never preserve or invent runtime proof during preparation.
  evidence.qualifications ||= {};
  // Resolve every prerequisite before the first model byte is hashed.
  for (const node of Object.values(input.graph)) {
    const field = H3_STUDIO_ASSET_FIELDS[node.class_type]; if (!field) continue;
    const filename = String(node.inputs[field]), file = input.assetPaths[filename], rights = input.assetRights[filename];
    if (!file?.startsWith("/") || fs.realpathSync(file) !== file || !fs.statSync(file).isFile() || !validH3StudioRights(rights, evidence.upstreamAuthorization.ownerKey)) throw new Error(`Exact local file and separate rights clearance required: ${filename}`);
    for (const lora of Object.values(evidence.loras)) if (lora.filename === filename && !validH3StudioRights(lora.rights, evidence.upstreamAuthorization.ownerKey)) throw new Error(`Separate optional LoRA rights required: ${filename}`);
  }
  for (const node of Object.values(input.graph)) {
    const field = H3_STUDIO_ASSET_FIELDS[node.class_type]; if (!field) continue;
    const filename = String(node.inputs[field]); if (inventory.assets![filename]) continue;
    const file = input.assetPaths[filename];
    const rights = input.assetRights[filename];
    if (!file?.startsWith("/") || fs.realpathSync(file) !== file || !validH3StudioRights(rights, evidence.upstreamAuthorization.ownerKey)) throw new Error(`Exact local file and separate rights clearance required: ${filename}`);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.size < 1) throw new Error(`Installed regular asset required: ${filename}`);
      const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(4 * 1024 * 1024);
      for (;;) { const bytes = fs.readSync(fd, buffer, 0, buffer.length, null); if (!bytes) break; hash.update(buffer.subarray(0, bytes)); }
      const after = fs.fstatSync(fd);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(`Asset changed while hashing: ${filename}`);
      const asset = { filename, sha256: hash.digest("hex"), bytes: after.size };
      inventory.assets![filename] = asset;
      inventory.assetFiles![filename] = { path: file, dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs };
      evidence.assets[filename] = { ...asset, rights };
      for (const lora of Object.values(evidence.loras)) if (lora.filename === filename) {
        if (!validH3StudioRights(lora.rights, evidence.upstreamAuthorization.ownerKey)) throw new Error(`Separate optional LoRA rights required: ${filename}`);
        lora.sha256 = asset.sha256; lora.bytes = asset.bytes;
      }
    } finally { fs.closeSync(fd); }
  }
  return { inventory, evidence };
}
export type H3StudioQualificationSample = { at: string; gpuUuid: string; gpuName: string; totalVramBytes: number;
  usedVramBytes: number; totalRamBytes: number; usedRamBytes: number; usedSwapBytes: number };
/** Read-only telemetry from the fixed worker; missing UUID/RAM is a truthful gate. */
export async function readH3StudioQualificationTelemetry(requiredVramBytes: number): Promise<H3StudioQualificationSample> {
  const runtime = await inspectStudioQualificationRuntime(requiredVramBytes);
  return { at: runtime.checkedAt, gpuUuid: runtime.gpuUuid, gpuName: runtime.gpuName,
    totalVramBytes: runtime.freeVramBytes + runtime.telemetry.usedVramBytes, usedVramBytes: runtime.telemetry.usedVramBytes,
    totalRamBytes: os.totalmem(), usedRamBytes: runtime.telemetry.usedRamBytes, usedSwapBytes: runtime.telemetry.usedSwapBytes };
}
export function summarizeH3StudioQualificationTelemetry(samples: H3StudioQualificationSample[]): H3StudioQualificationRecord["telemetry"] {
  const first = samples[0];
  if (!first || samples.length < 2 || samples.some(s => s.gpuUuid !== first.gpuUuid || s.gpuName !== first.gpuName || s.totalVramBytes !== first.totalVramBytes || s.totalRamBytes !== first.totalRamBytes)) throw new Error("Consistent actual worker telemetry required.");
  return { gpuUuid: first.gpuUuid, gpuName: first.gpuName, totalVramBytes: first.totalVramBytes, totalRamBytes: first.totalRamBytes,
    peakVramBytes: Math.max(...samples.map(s => s.usedVramBytes)), peakRamBytes: Math.max(...samples.map(s => s.usedRamBytes)), peakSwapBytes: Math.max(...samples.map(s => s.usedSwapBytes)),
    samples: samples.map(s => ({ at: s.at, usedVramBytes: s.usedVramBytes, usedRamBytes: s.usedRamBytes, usedSwapBytes: s.usedSwapBytes })) };
}
