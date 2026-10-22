import fs from "node:fs";
import { createHash } from "node:crypto";
import { buildMossWorkflow, type MossTarget } from "./mossImage";
import { configurationPath, qualificationEnvironment } from "@/lib/runtime/configPaths";
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export function mossWorkflowFingerprint(target: MossTarget) {
  return createHash("sha256").update(JSON.stringify(canonical(buildMossWorkflow({ target, prompt: "", width: 1024, height: 1024, seed: 0 })))).digest("hex");
}
export function mossPhysicallyQualified(target: MossTarget) {
  try {
    const record = JSON.parse(fs.readFileSync(process.env.OTG_MOSS_QUALIFICATION_FILE || configurationPath("moss-image-qualified.json"), "utf8"));
    const environment = qualificationEnvironment();
    if (!environment || (environment === "prod" && record.environment !== "prod")) return false;
    if (record.environment && record.environment !== environment) return false;
    const proof = record.targets?.[target];
    return proof?.fingerprint === mossWorkflowFingerprint(target) && proof?.androidPreview === true && typeof proof?.promptId === "string";
  } catch { return false; }
}
