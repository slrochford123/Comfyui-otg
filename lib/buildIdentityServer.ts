import fs from "node:fs";
import path from "node:path";
import { version as softwareVersion } from "@/package.json";
import { BUILD_VERSION, BUILD_HISTORY, type BuildIdentity } from "@/lib/buildHistory";

/** Only public release identity is returned. Never serialize the full provenance record. */
export function readBuildIdentity(root = process.cwd()): BuildIdentity {
  const identity: BuildIdentity = { buildVersion: BUILD_VERSION, softwareVersion, commit: null, releaseName: null, builtAt: null, history: BUILD_HISTORY };
  let fd: number | undefined;
  try {
    fd = fs.openSync(path.join(root, "RELEASE_PROVENANCE.json"), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 2_000_000) return identity;
    const record = JSON.parse(fs.readFileSync(fd, "utf8"));
    // An old release's provenance must not identify the current build.
    if (record.buildVersion !== BUILD_VERSION) return identity;
    if (typeof record.commit === "string" && /^[a-f0-9]{40}$/.test(record.commit)) identity.commit = record.commit;
    if (typeof record.name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(record.name)) identity.releaseName = record.name;
    if (typeof record.builtAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(record.builtAt) && Number.isFinite(Date.parse(record.builtAt))) identity.builtAt = record.builtAt;
  } catch { /* A source checkout still has its immutable owner-facing build label. */ }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  return identity;
}
