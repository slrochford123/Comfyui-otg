import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type ComfyWorkerInstance = { host: string; unit: string; pid: number; startTicks: string; bootId: string };
type ProbeConfig = { mode: "local" | "ssh"; script: string; target?: string; sshOptions?: string[] };
export function sameComfyWorker(a: ComfyWorkerInstance, b: ComfyWorkerInstance) {
  return a.host === b.host && a.unit === b.unit && a.pid === b.pid && a.startTicks === b.startTicks && a.bootId === b.bootId;
}
function validInstance(i: ComfyWorkerInstance | undefined): i is ComfyWorkerInstance {
  return !!i && ["shawn", "slr"].includes(i.host) && ["otg-comfyui.service", "otg-comfyui-h3.service", "otg-comfyui-3060.service", "comfyui-5060.service"].includes(i.unit)
    && Number.isSafeInteger(i.pid) && i.pid > 1 && /^\d+$/.test(i.startTicks) && /^[a-f0-9-]{36}$/.test(i.bootId);
}
/** Optional trusted read-only probe. Missing/failed proof never authorizes release. */
export async function inspectComfyWorkerInstance(baseUrl: string, previous?: ComfyWorkerInstance): Promise<{ instance: ComfyWorkerInstance; previousStopped: boolean } | null> {
  const file = process.env.OTG_COMFY_INSTANCE_PROBE_CONFIG;
  if (!file) return null;
  if (!path.isAbsolute(file)) throw Error("Invalid worker identity configuration.");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o022 || ![0, process.getuid?.()].includes(stat.uid) || stat.size > 16_000) throw Error("Untrusted worker identity configuration.");
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, ProbeConfig>;
  const cfg = config[baseUrl];
  if (!cfg) return null;
  if (!["local", "ssh"].includes(cfg.mode) || !path.isAbsolute(cfg.script) || !/^[\w./-]+$/.test(cfg.script) || cfg.script.split("/").includes("..")) throw Error("Invalid worker identity helper.");
  if (cfg.mode === "ssh" && (!cfg.target || !/^[\w.@:-]+$/.test(cfg.target) || cfg.target.startsWith("-"))) throw Error("Invalid identity probe host.");
  if (previous && !validInstance(previous)) throw Error("Invalid saved worker identity.");
  const local = cfg.mode === "local";
  const args = local ? [cfg.script] : [...(cfg.sshOptions || []), "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-o", "ClearAllForwardings=yes", "--", cfg.target!, "/usr/bin/python3 " + cfg.script];
  return new Promise((resolve, reject) => {
    const child = spawn(local ? "/usr/bin/python3" : "/usr/bin/ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", settled = false;
    const finish = (error?: Error, result?: { instance: ComfyWorkerInstance; previousStopped: boolean }) => {
      if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result!);
    };
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(Error("Worker identity probe timed out.")); }, 8000);
    child.stdout.on("data", chunk => { output += String(chunk); if (output.length > 8192) { child.kill("SIGTERM"); finish(Error("Invalid worker identity response.")); } });
    child.stderr.resume(); child.stdin.on("error", () => {});
    child.once("error", () => finish(Error("Worker identity probe unavailable.")));
    child.once("close", code => {
      try {
        const result = JSON.parse(output);
        if (code || result.ok !== true || result.schemaVersion !== 1 || !validInstance(result.instance) || typeof result.previousStopped !== "boolean") throw Error();
        finish(undefined, result);
      } catch { finish(Error("Worker identity could not be verified.")); }
    });
    child.stdin.end(JSON.stringify({ baseUrl, ...(previous ? { previous } : {}) }));
  });
}
