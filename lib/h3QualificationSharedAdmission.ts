import fs from "node:fs";
import path from "node:path";
import type { H3QualificationBridgeRoute } from "@/lib/h3QualificationBridgeRoute";

type QualificationSharedAuthority = { authorityId: string; ledgerPath: string; configPath: string };
const authorityPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const admissionKey = "OTG_MEDIA_ADMISSION_CONFIG";

function protectedRegularFile(file: string) {
  if (!path.isAbsolute(file) || fs.realpathSync(file) !== file) throw Error();
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0) throw Error();
  return stat;
}

/** Local-only check based on a fresh, separately verified installed bridge route. */
export function assertH3QualificationSharedAdmission(route: H3QualificationBridgeRoute): QualificationSharedAuthority {
  try {
    if (process.env.OTG_ENV !== "test" || route.environment !== "TEST" || route.port !== 3001 ||
        !Number.isSafeInteger(route.pid) || route.pid <= 1) throw Error();
    const candidateConfig = process.env[admissionKey];
    if (!candidateConfig || !path.isAbsolute(candidateConfig)) throw Error();

    const records = fs.readFileSync(`/proc/${route.pid}/environ`, "utf8").split("\0");
    const canonicalValues = records.filter(value => value.startsWith(`${admissionKey}=`));
    if (canonicalValues.length !== 1 || !records.includes("OTG_ENV=test") || !records.includes("PORT=3001")) throw Error();
    const canonicalConfig = canonicalValues[0].slice(admissionKey.length + 1);
    if (!path.isAbsolute(canonicalConfig) || fs.realpathSync(canonicalConfig) !== candidateConfig) throw Error();

    const configStat = protectedRegularFile(candidateConfig);
    if (configStat.size < 2 || configStat.size > 16_000) throw Error();
    const descriptor = fs.openSync(candidateConfig, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let config: { mode?: unknown; script?: unknown; authorityId?: unknown };
    try {
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== configStat.dev || opened.ino !== configStat.ino || opened.size !== configStat.size ||
          opened.uid !== configStat.uid || opened.mode !== configStat.mode) throw Error();
      config = JSON.parse(fs.readFileSync(descriptor, "utf8"));
      const finished = fs.fstatSync(descriptor);
      if (finished.size !== opened.size || finished.mtimeMs !== opened.mtimeMs || finished.ctimeMs !== opened.ctimeMs) throw Error();
    } finally { fs.closeSync(descriptor); }

    if (config?.mode !== "local" || typeof config.authorityId !== "string" || !authorityPattern.test(config.authorityId) ||
        typeof config.script !== "string" || !/^\/[A-Za-z0-9_./-]+$/.test(config.script)) throw Error();
    const script = protectedRegularFile(config.script);
    if (!script.size) throw Error();
    const ledgerPath = path.join(path.dirname(config.script), "admission.sqlite");
    if (!protectedRegularFile(ledgerPath).size || !fs.statSync(`/proc/${route.pid}`).isDirectory()) throw Error();
    return { authorityId: config.authorityId, ledgerPath, configPath: candidateConfig };
  } catch {
    throw Error("The isolated candidate has not verified the canonical TEST shared RTX 3090 admission authority. No render was submitted.");
  }
}
