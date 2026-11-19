import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {OTG_DATA_ROOT, safeSegment} from "@/lib/paths";

type Phase = "awaiting-upscale" | "upscaling" | "finalizing" | "completed" | "failed";
type Receipt = {width: number; height: number; fps: string; frames: number; videoSeconds: number; audioStreams: number; bytes: number; sha256?: string; crop?: "center" | "subject"};
type Delivery = {state: Phase; message: string; updatedAt: number; receipt?: Receipt};
type Source = {owner: string; job: string; source: string | Buffer};

const runtimeConfig = () => process.env.OTG_ENV === "prod"
  ? process.env.OTG_PROD_RELAY_CONFIG
  : process.env.OTG_TEST_RELAY_CONFIG || path.join(process.cwd(),"config/video-finishing-test.json");

export function testRelayFinishing() {
  const config = runtimeConfig();
  return (process.env.OTG_ENV === "test" || process.env.OTG_ENV === "prod") &&
    !!config && path.isAbsolute(config) && fs.existsSync(config);
}

function directory(owner: string, job: string) {
  const key = crypto.createHash("sha256").update(job).digest("hex");
  return path.join(OTG_DATA_ROOT, "video-finishing", safeSegment(owner), key);
}
function delivery(dir: string): Delivery | null {
  try {return JSON.parse(fs.readFileSync(path.join(dir, "delivery.json"), "utf8"));}
  catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;return null;}
}
function writeDelivery(dir: string, state: Phase, message: string) {
  const tmp = path.join(dir, `delivery-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({state, message, updatedAt: Date.now() / 1000}), {mode: 0o600});
  fs.renameSync(tmp, path.join(dir, "delivery.json"));
}
function claimDelivery(dir: string) {
  const candidate = path.join(dir, `delivery-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(candidate, JSON.stringify({
    state: "awaiting-upscale", message: "Generated · awaiting upscale", updatedAt: Date.now() / 1000,
  }), {mode: 0o600, flag: "wx"});
  try {
    fs.linkSync(candidate, path.join(dir, "delivery.json"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  } finally {
    fs.rmSync(candidate, {force: true});
  }
}
function launch(dir: string) {
  const config = runtimeConfig();
  if (!config || !testRelayFinishing()) throw Error("RelayVSR is unavailable on this deployment.");
  const runner = path.join(process.cwd(), "scripts/video-finishing/finish_video.py");
  // The child owns an OS lock. Parallel callers and an application restart can
  // reconnect to the same finishing job without starting a second inference.
  const log = fs.openSync(path.join(dir, "runner.log"), "a", 0o600);
  try {
    const child = spawn("/usr/bin/python3", [runner, "--job", dir, "--config", config], {
      detached: true, env: {...process.env, PYTHONDONTWRITEBYTECODE:"1"}, stdio: ["ignore", log, log],
    });
    child.on("error", () => writeDelivery(dir, "failed", "The RelayVSR runner could not start."));
    child.unref();
  } finally {fs.closeSync(log);}
}

export function inspectRelay(owner: string, job: string): (Delivery & {file?: string}) | null {
  if (!testRelayFinishing()) return null;
  const dir = directory(owner, job);
  const current = delivery(dir);
  if (!current) return null;
  const file = path.join(dir, "final.mp4");
  if (current.state === "completed" && (!current.receipt || !fs.existsSync(file) || fs.statSync(file).size !== current.receipt.bytes)) {
    return {...current, state: "failed" as const, message: "The validated 1080p file is missing or changed."};
  }
  return {...current, file: current.state === "completed" ? file : undefined};
}

export function startRelay(input: Source) {
  if (!testRelayFinishing()) throw Error("RelayVSR is unavailable on this deployment.");
  const dir = directory(input.owner, input.job);
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const target = path.join(dir, "source.mp4");
  if (!fs.existsSync(target)) {
    const temp = path.join(dir, `source-${crypto.randomUUID()}.tmp`);
    try {
      if (Buffer.isBuffer(input.source)) fs.writeFileSync(temp, input.source, {mode: 0o600});
      else fs.copyFileSync(input.source, temp);
      try {fs.linkSync(temp, target);} catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
    } finally {fs.rmSync(temp, {force: true});}
  }
  const current = inspectRelay(input.owner, input.job);
  if (!current) {
    if (claimDelivery(dir)) launch(dir);
  } else if (!["completed","failed"].includes(current.state) && Date.now()/1000-current.updatedAt > 30) {
    launch(dir);
  }
  return inspectRelay(input.owner, input.job);
}

export async function finishH3WithRelay(input: Source, update: (message: string) => Promise<boolean>) {
  let message = "Generated · awaiting upscale";
  while (await update(message)) {
    const finish = startRelay(input);
    if (finish?.state === "completed" && finish.file) return finish.file;
    if (finish?.state === "failed") throw Object.assign(new Error(finish.message), { name: "RelayFinishingError" });
    if (finish) message = finish.message;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  cancelRelay(input.owner, input.job);
  return null;
}

export function retryRelay(owner: string, job: string) {
  const current = inspectRelay(owner, job);
  if (!current || current.state !== "failed") return false;
  const dir = directory(owner, job);
  fs.rmSync(path.join(dir, "cancel"), {force:true});
  writeDelivery(dir, "awaiting-upscale", "Generated · awaiting upscale retry");
  launch(dir);
  return true;
}

export function cancelRelay(owner: string, job: string) {
  const dir = directory(owner, job);
  if (testRelayFinishing() && fs.existsSync(dir)) fs.writeFileSync(path.join(dir, "cancel"), "", {mode:0o600});
}
