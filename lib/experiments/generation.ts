import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { RequestError } from "@/lib/requestError";
import { EXPERIMENTS } from "./catalog";
import { getAsset, getSession, labRoot, MAX_ASSET_BYTES, validId, withLab } from "./store";
import { requireNsfwAccess } from "./nsfwAccess";

type Recipe = {steps:number;sampler:string;scheduler:string;attention:string;note:string};
type ModelRuntime = { path: string; sha256: string; bytes: number; mtimeNs: number; qualifiedModes?: string[]; variants?: Record<string,string[]>; minSeconds?:number; reason?:string; recipe?: Recipe; variantRecipes?:Record<string,Recipe> };
type RuntimeConfig = { environment: string; gpu: string; models: Record<string, ModelRuntime>; runner: string; runnerSha256: string; files: {path:string;sha256:string}[] };
export type LabCapability = { model: string; gpu: string; modes: string[]; reason: string; variants?:Record<string,string[]>; minSeconds?:number; recipe?:Recipe; variantRecipes?:Record<string,Recipe> };
export type LabJob = {
  id: string; session: string; model: string; state: string; stage: string; created: number;
  started?: number; completed?: number; totalSeconds?: number; elapsedSeconds?: number;
  output?: string; cleanedUp?: boolean; actual?: Record<string, unknown>; peakGpuMiB?: number;
  director?: {title:string;continuity:string;shots:{title:string;seconds:number;prompt:string;sound:string}[]};
};
type Row = { id: string; owner: string; session: string; model: string; asset: string; status: string; created: number };
function runtime(kind: "testing" | "h3-admin" = "h3-admin"): { file: string; config: RuntimeConfig } | null {
  const file = path.join(labRoot(), kind === "testing" ? "testing-runtime.json" : "runtime.json");
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new RequestError("Private runtime configuration is unsafe.", 503);
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as RuntimeConfig;
  if (config.environment !== "test" || config.gpu !== "rtx3090" || !path.isAbsolute(config.runner || "")) throw new RequestError("Private H3 runtime is not configured.", 503);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(config.runner)).digest("hex");
  if (hash !== config.runnerSha256) throw new RequestError("Private runner changed; requalification is required.", 503);
  if (!Array.isArray(config.files) || config.files.length < 3 || config.files.some(file => !path.isAbsolute(file.path) || crypto.createHash("sha256").update(fs.readFileSync(file.path)).digest("hex") !== file.sha256)) throw new RequestError("Private graph implementation changed; requalification is required.", 503);
  return { file, config };
}
export function labCapabilities(): LabCapability[] {
  const unavailable = new Set<string>();
  function isolatedRuntime(kind:"testing"|"h3-admin") {
    try { return runtime(kind); }
    catch { unavailable.add(kind);return null; }
  }
  const runtimes = {"h3-admin":isolatedRuntime("h3-admin"),testing:isolatedRuntime("testing")};
  return EXPERIMENTS.map(entry => {
    const configured = runtimes[entry.kind];
    const installed = configured?.config.models[entry.id];
    const modes = installed && (entry.kind === "testing" || installed.sha256.toLowerCase() === entry.sha256?.toLowerCase()) ? installed.qualifiedModes || [] : [];
    return { model: entry.id, gpu: "rtx3090", modes, variants:installed?.variants, minSeconds:installed?.minSeconds, recipe:installed?.recipe, variantRecipes:installed?.variantRecipes, reason: unavailable.has(entry.kind) ? "This workspace's private runtime failed integrity validation. Generation is disabled; the other workspace is unaffected." : installed?.reason || (modes.length
      ? "Private 3090 workflow qualified at the recorded small test size. Larger/longer renders remain experimental. 5060 Ti not yet qualified."
      : entry.kind === "testing" ? entry.blockers.join(" ") : "Exact checkpoint/mode has not completed isolated generation qualification yet. No job will be substituted.") };
  });
}
function jobs<T>(fn: (db: import("better-sqlite3").Database, root: string) => T) {
  return withLab((db, root) => {
    db.exec(`CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, session TEXT NOT NULL REFERENCES sessions(id),
      model TEXT NOT NULL, asset TEXT NOT NULL REFERENCES assets(id), status TEXT NOT NULL, created REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS generation_owner ON generation_jobs(owner,session);`);
    return fn(db, root);
  });
}
function readStatus(root: string, row: Row): LabJob {
  const file = path.join(root, "jobs", row.id, "status.json");
  const status = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as LabJob : JSON.parse(row.status) as LabJob;
  const heartbeat = (status as LabJob & {heartbeat?:number}).heartbeat;
  if ((!["completed","failed","canceled"].includes(status.state) || !status.cleanedUp) && Date.now()/1000-(heartbeat || status.created)>120) {
    status.state="needs_attention";status.stage="Private worker heartbeat is stale. No automatic resubmission or GPU reservation release was attempted. Administrator recovery is required.";
  }
  return { ...status, id: row.id, session: row.session, model: row.model };
}
export function listLabJobs(owner: string, session: string): LabJob[] {
  getSession(owner, session);
  return jobs((db, root) => {
    const rows = db.prepare("SELECT * FROM generation_jobs WHERE owner=? AND session=? ORDER BY created DESC").all(owner, session) as Row[];
    return rows.map(row => {
      const status = readStatus(root, row);
      if (status.state === "completed" && status.cleanedUp) {
        const asset = db.prepare("SELECT ready,mime FROM assets WHERE id=? AND owner=?").get(row.asset, owner) as { ready: number; mime:string };
        if (!asset.ready) {
          const source = path.join(root, "jobs", row.id, asset.mime === "image/png" ? "result.png" : asset.mime === "application/json" ? "result.json" : "result.mp4"), target = path.join(root, row.asset + ".media");
          const stat = fs.lstatSync(source);
          if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_ASSET_BYTES) throw new RequestError("Generated file failed integrity or size validation; original remains in private job storage.", 409);
          const bytes = fs.readFileSync(source), sha = crypto.createHash("sha256").update(bytes).digest("hex");
          const receipt = JSON.parse(fs.readFileSync(path.join(root, "jobs", row.id, "status.json"), "utf8"));
          if (sha !== receipt.outputSha256 || stat.size !== receipt.outputBytes) throw new RequestError("Generated file checksum does not match its receipt.", 409);
          // DB transaction makes concurrent polls publish this immutable result only once.
          db.transaction(() => {
            if ((db.prepare("SELECT ready FROM assets WHERE id=?").get(row.asset) as { ready: number }).ready) return;
            if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
            else if (!fs.lstatSync(target).isFile() || crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") !== sha) throw new RequestError("Generated asset destination conflict.", 409);
            db.prepare("UPDATE assets SET ready=1,bytes=?,sha256=? WHERE id=? AND owner=?").run(stat.size, sha, row.asset, owner);
          })();
        }
        status.output = row.asset;
      }
      if (["failed", "canceled"].includes(status.state) && status.cleanedUp) {
        db.prepare("UPDATE assets SET bytes=0 WHERE id=? AND ready=0").run(row.asset);
      }
      db.prepare("UPDATE generation_jobs SET status=? WHERE id=?").run(JSON.stringify(status), row.id);
      return status;
    });
  });
}
export async function submitLabJob(owner: string, data: Record<string, unknown>, restricted = false) {
  const permission = restricted ? requireNsfwAccess(owner) : null;
  validId(data.id);
  const session = getSession(owner, data.id);
  const kind = EXPERIMENTS.find(e=>e.id===session.experiment)!.kind;
  if (restricted && kind !== "h3-admin") throw new RequestError("Model not available.",403);
  if (!runtime(kind)) throw new RequestError("Private H3 generation has not been qualified/configured. No job was submitted.",409);
  validId(data.requestId);
  const existing = jobs(db => db.prepare("SELECT * FROM generation_jobs WHERE id=?").get(data.requestId) as Row | undefined);
  if (existing) {
    if (existing.owner !== owner || existing.session !== session.id) throw new RequestError("Request identifier conflict.", 409);
    return jobs((_db, root) => readStatus(root, existing));
  }
  if (session.archived || session.revision !== data.revision) throw new RequestError("Save/reload the active session before generating.", 409);
  const cfg = runtime(kind), capability = labCapabilities().find(c => c.model === session.experiment);
  if (restricted && (cfg?.config as RuntimeConfig & {permissionGuardVersion?:number})?.permissionGuardVersion !== 1) throw new RequestError("Permission-aware H3 worker is not installed. No job was submitted.",503);
  if (!cfg || !capability?.modes.includes(session.settings.mode)) throw new RequestError("This exact model and mode have not passed isolated qualification. No job was submitted.", 409);
  if (session.settings.gpu === "rtx5060ti") throw new RequestError("5060 Ti is not qualified for these private checkpoints yet; choose 3090.", 409);
  if (session.settings.recipe !== "author" || !session.settings.prompt.trim()) throw new RequestError("Choose the checkpoint recipe and enter a scene prompt.", 400);
  if (kind === "testing" && (!capability.variants?.[session.settings.variant || "pika6"]?.includes(session.settings.mode) || session.settings.seconds < (capability.minSeconds || 5))) throw new RequestError("This variant/mode or duration is not qualified. No substitute job was submitted.",409);
  if (!Array.isArray(data.sources) || data.sources.length > 12 || new Set(data.sources).size !== data.sources.length) throw new RequestError("Select valid source references.", 400);
  if (session.settings.selectedSources !== undefined && JSON.stringify(data.sources) !== JSON.stringify(session.settings.mode === "text" ? [] : session.settings.selectedSources)) throw new RequestError("References changed. Save the draft before generating.",409);
  const sources = data.sources.map(id => {
    validId(id); const item = getAsset(owner, id);
    if (item.asset.session !== session.id || item.asset.role !== "source") throw new RequestError("Only this session's source references may be used.", 400);
    return item;
  });
  const images = sources.filter(s => s.asset.mime.startsWith("image/")), videos = sources.filter(s => s.asset.mime.startsWith("video/")), audios = sources.filter(s => s.asset.mime.startsWith("audio/"));
  const mode = session.settings.mode;
  if (session.experiment === "director-studio" && (mode !== "text" || sources.length)) throw new RequestError("Director planning is text-only; media analysis is not enabled.",400);
  if (session.experiment === "sol-denomix" && (mode !== "reference" || !images.length || images.length !== sources.length)) throw new RequestError("DenoMix currently supports image references only.",400);
  if (kind === "testing" && mode === "reference" && !images.length && !videos.length) throw new RequestError("This reference workflow needs an image or video; audio alone is unsupported.",400);
  if (session.experiment === "body-swap" && (mode !== "edit" || images.length !== 1 || videos.length !== 1 || sources.length !== 2)) throw new RequestError("Character swap requires one video and one replacement character image.",400);
  if ((mode === "text" && sources.length) || (["image","edit-image"].includes(mode) && (images.length !== 1 || sources.length !== 1)) ||
      (mode === "reference" && !sources.length) || (mode === "edit" && (videos.length !== 1 || audios.length)) || images.length > 9 || videos.length > 3 || audios.length > 3) {
    throw new RequestError("Text: no references. Image: one first frame. Edit image: one source image. Reference: up to 9 images/3 videos/3 audio. Edit video: one video, optional images.", 400);
  }
  const id = data.requestId;
  const result = jobs((db, root) => db.transaction(() => {
    const pending = (db.prepare("SELECT * FROM generation_jobs WHERE owner=?").all(owner) as Row[]).map(row=>{
      const status=readStatus(root,row);
      if (["failed","canceled"].includes(status.state)&&status.cleanedUp) db.prepare("UPDATE assets SET bytes=0 WHERE id=? AND ready=0").run(row.asset);
      return status;
    });
    if (pending.length >= 48) throw new RequestError("The 48-run private research retention limit was reached. Review/export evidence before adding more jobs.",409);
    if (pending.filter(row => !["completed", "failed", "canceled"].includes(row.state)||!row.cleanedUp).length >= 4) throw new RequestError("At most four pending private jobs per administrator.", 409);
    if ((db.prepare("SELECT count(*) AS n FROM assets WHERE session=? AND (ready=1 OR bytes>0)").get(session.id) as {n:number}).n>=12) throw new RequestError("At most 12 source/result assets per session. Create another private session.",409);
    const used = db.prepare("SELECT coalesce(sum(bytes),0) AS n FROM assets WHERE owner=?").get(owner) as { n: number };
    const total = db.prepare("SELECT coalesce(sum(bytes),0) AS n FROM assets").get() as { n: number };
    const disk = fs.statfsSync(root);
    if (used.n + MAX_ASSET_BYTES > 2 * 1024 ** 3 || total.n + MAX_ASSET_BYTES > 16 * 1024 ** 3 || disk.bavail * disk.bsize < 12 * 1024 ** 3) throw new RequestError("Private media quota or disk safety reserve reached.", 507);
    const asset = crypto.randomUUID(), created = Date.now() / 1000;
    const status: LabJob = { id, session: session.id, model: session.experiment, state: "queued", stage: "Preparing isolated job", created };
    const image=mode==="edit-image", director=session.experiment==="director-studio";
    db.prepare("INSERT INTO assets(id,session,owner,name,mime,role,bytes,created) VALUES(?,?,?,?,?,?,?,?)").run(asset,session.id,owner,`${session.experiment}-${id}.${director?"json":image?"png":"mp4"}`,director?"application/json":image?"image/png":"video/mp4","generated",MAX_ASSET_BYTES,new Date().toISOString());
    db.prepare("INSERT INTO generation_jobs(id,owner,session,model,asset,status,created) VALUES(?,?,?,?,?,?,?)").run(id,owner,session.id,session.experiment,asset,JSON.stringify(status),created);
    return { root, status };
  })());
  const dir = path.join(result.root, "jobs", id);
  let launched = false;
  try {
    fs.mkdirSync(path.join(dir, "sources"), { recursive: true, mode: 0o700 });
    const references = sources.map((source, index) => {
      const name = `${index}.media`, fd = fs.openSync(source.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const bytes = fs.readFileSync(fd);
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== source.asset.sha256) throw new Error("Reference changed since upload");
        fs.writeFileSync(path.join(dir,"sources",name),bytes,{flag:"wx",mode:0o600});
      } finally { fs.closeSync(fd); }
      return { name, sha256: source.asset.sha256, kind: source.asset.mime.split("/")[0], assetId: source.asset.id };
    });
    const previousDirector = session.experiment === "director-studio" ? listLabJobs(owner,session.id).find(j=>j.state==="completed"&&j.cleanedUp&&j.director) : undefined;
    fs.writeFileSync(path.join(dir,"request.json"),JSON.stringify({ id, model:session.experiment,settings:session.settings,sources:references, ...(permission && !permission.admin ? {authorization:{userId:owner,version:permission.version}} : {}), ...(previousDirector ? {directorContext:previousDirector.director,parentJob:previousDirector.id}: {}) }),{flag:"wx",mode:0o600});
    fs.writeFileSync(path.join(dir,"status.json"),JSON.stringify(result.status),{flag:"wx",mode:0o600});
    const log = fs.openSync(path.join(dir,"runner.log"),"wx",0o600);
    const child = spawn("/usr/bin/python3", [cfg.config.runner,"--job",dir,"--config",cfg.file], {
      detached:true,stdio:["ignore",log,log],env:{NODE_ENV:"production",PATH:"/usr/local/bin:/usr/bin:/bin",HOME:process.env.HOME,LANG:"C.UTF-8",OTG_ENV:"test"},
    });
    fs.closeSync(log);
    await new Promise<void>((resolve,reject) => { child.once("spawn",resolve);child.once("error",reject); });
    launched = true;
    child.unref();
    fs.writeFileSync(path.join(dir,"runner-process.json"),JSON.stringify({pid:child.pid,created:Date.now()}),{mode:0o600});
    return result.status;
  } catch {
    if (launched) return result.status; // Durable runner owns status; never misreport a launched job as unsubmitted.
    const status = {...result.status,state:"failed",stage:"Private job could not start; no generation was submitted.",cleanedUp:true};
    fs.mkdirSync(dir,{recursive:true,mode:0o700}); fs.writeFileSync(path.join(dir,"status.json"),JSON.stringify(status),{mode:0o600});
    throw new RequestError(status.stage,503);
  }
}
export function cancelLabJob(owner: string, id: unknown) {
  validId(id);
  return jobs((db, root) => {
    const row = db.prepare("SELECT * FROM generation_jobs WHERE id=? AND owner=?").get(id,owner) as Row | undefined;
    if (!row) throw new RequestError("Generation not found.",404);
    const status = readStatus(root,row);
    if (!["completed","failed","canceled"].includes(status.state)) fs.writeFileSync(path.join(root,"jobs",id,"cancel"),"cancel requested\n",{mode:0o600});
    return { id, requested: true };
  });
}
export function exportLabJob(owner: string, id: unknown) {
  validId(id);
  return jobs((db,root)=>{
    const row=db.prepare("SELECT * FROM generation_jobs WHERE id=? AND owner=?").get(id,owner) as Row|undefined;
    if (!row) throw new RequestError("Generation not found.",404);
    const dir=path.join(root,"jobs",id), request=JSON.parse(fs.readFileSync(path.join(dir,"request.json"),"utf8"));
    return {schemaVersion:1,testOnly:true,status:readStatus(root,row),request,
      graph:fs.existsSync(path.join(dir,"graph.json"))?JSON.parse(fs.readFileSync(path.join(dir,"graph.json"),"utf8")):null,
      warning:"Private graph uses LabMemory nodes, pinned checkpoints and normalized source filenames. It is evidence, not production integration approval."};
  });
}
