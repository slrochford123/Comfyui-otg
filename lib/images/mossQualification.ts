import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildMossWorkflow, type MossTarget } from "./mossImage";
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export function mossWorkflowFingerprint(target: MossTarget) {
  return createHash("sha256").update(JSON.stringify(canonical(buildMossWorkflow({ target, prompt: "", width: 1024, height: 1024, seed: 0 })))).digest("hex");
}
export function mossPhysicallyQualified(target: MossTarget) {
  const root = process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT || path.join(process.cwd(), "data");
  try {
    const record = JSON.parse(fs.readFileSync(path.join(root, "..", "config", "moss-image-qualified.json"), "utf8"));
    const proof = record.targets?.[target];
    return proof?.fingerprint === mossWorkflowFingerprint(target) && proof?.androidPreview === true && typeof proof?.promptId === "string";
  } catch { return false; }
}
