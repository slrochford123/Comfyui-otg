import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { DEFAULT_LAB_SETTINGS, EXPERIMENTS, labExperiment, isRetiredExperiment, type LabSettings } from "./catalog";
import { RequestError } from "@/lib/requestError";
import { MAX_LAB_IMAGE_BYTES, MAX_LAB_REFERENCE_BYTES } from "./imageTypes";
import { productionNsfwScope } from "./availability";
import { LAB_STYLE_IDS, H3_VISUAL_STYLE_OPTIONS, H3_CAMERA_FEEL_OPTIONS, H3_SHOT_FLOW_OPTIONS } from "./creative";
import { MAX_H3_RENDER_REFERENCES } from "./referenceLimits";

export const MAX_ASSET_BYTES = 128 * 1024 * 1024;
export const MAX_ASSETS = 12;
// Saved H3 NSFW media/history has no count or fixed GB quota. These limits
// remain only for the separate quarantined Testing workspace.
export const TESTING_EXPERIMENT_IDS = EXPERIMENTS.filter(e => e.kind === "testing").map(e => e.id);
export const TESTING_SQL_IDS = TESTING_EXPERIMENT_IDS.map(() => "?").join(",");
export const uncappedH3History = (experiment: string) => labExperiment(experiment)?.kind === "h3-admin";

export function assertLabAssetCapacity(db: Database.Database, root: string, owner: string, session: {id:string;experiment:string}, reservationBytes: number, mime: string, safetyReserveBytes = 8 * 1024 ** 3) {
  if (!uncappedH3History(session.experiment)) {
    if ((db.prepare("SELECT count(*) AS n FROM assets WHERE session=? AND (ready=1 OR bytes>0)").get(session.id) as {n:number}).n >= MAX_ASSETS) throw new RequestError("At most 12 assets per experiment.",409);
    const usage = `SELECT coalesce(sum(a.bytes + CASE WHEN a.mime LIKE 'image/%' AND a.role<>'generated' THEN ? ELSE 0 END),0) AS n FROM assets a JOIN sessions s ON s.id=a.session WHERE s.experiment IN (${TESTING_SQL_IDS})`;
    const ownerBytes = (db.prepare(usage+" AND a.owner=?").get(MAX_LAB_REFERENCE_BYTES,...TESTING_EXPERIMENT_IDS,owner) as {n:number}).n;
    const totalBytes = (db.prepare(usage).get(MAX_LAB_REFERENCE_BYTES,...TESTING_EXPERIMENT_IDS) as {n:number}).n;
    const required = reservationBytes + (mime.startsWith("image/") ? MAX_LAB_REFERENCE_BYTES : 0);
    if (ownerBytes+required > 2*1024**3 || totalBytes+required > 16*1024**3) throw new RequestError("Research storage limit reached.",507);
  }
  // Count in-flight reservations as well as actual free space. Unlimited
  // retention must never allow concurrent uploads to consume the OS reserve.
  const reserved = (db.prepare("SELECT coalesce(sum(bytes + CASE WHEN mime LIKE 'image/%' AND role<>'generated' THEN ? ELSE 0 END),0) AS n FROM assets WHERE ready=0 AND bytes>0").get(MAX_LAB_REFERENCE_BYTES) as {n:number}).n;
  const disk=fs.statfsSync(root), required=reservationBytes+(mime.startsWith("image/")?MAX_LAB_REFERENCE_BYTES:0);
  if (disk.bavail*disk.bsize < safetyReserveBytes+reserved+required) throw new RequestError("Not enough free disk space. Free storage and retry; your saved files have not been removed.",507);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !uuid.test(value)) throw new RequestError("Invalid experiment identifier.", 400);
}
export function requireTestLab() {
  if (process.env.OTG_ENV !== "test") throw new RequestError("Not found.", 404);
}
export function labRoot() {
  const prod = productionNsfwScope();
  if (!prod) requireTestLab();
  const root = prod ? process.env.OTG_H3_NSFW_ROOT || "" : process.env.OTG_EXPERIMENTS_ROOT || "/home/shawn-rochford/AI/runtime/test/experiments";
  if (!path.isAbsolute(root) || root === "/" || root !== path.normalize(root)) throw new RequestError("Invalid experiment storage configuration.", 503);
  if (prod && (root === process.env.OTG_EXPERIMENTS_ROOT || root.startsWith("/home/shawn-rochford/AI/runtime/test/"))) throw new RequestError("Production H3 NSFW requires separate private storage.", 503);
  const data = path.resolve(process.env.OTG_DATA_DIR || path.join(process.cwd(), "data"));
  if (root === data || root.startsWith(data + path.sep)) throw new RequestError("Experiments must be outside application/gallery data.", 503);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || fs.realpathSync(root) !== root || !stat.isDirectory() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) {
    throw new RequestError("Experiment storage must be private, owned by this service, and not symlinked.", 503);
  }
  return root;
}
export function withLab<T>(fn: (db: Database.Database, root: string) => T): T {
  const root = labRoot(), file = path.join(root, "experiments.sqlite");
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = file + suffix;
    if (fs.existsSync(target) && (!fs.lstatSync(target).isFile() || fs.lstatSync(target).nlink !== 1)) throw new RequestError("Unsafe experiment database.", 503);
  }
  const db = new Database(file);
  fs.chmodSync(file, 0o600);
  try {
    db.pragma("busy_timeout = 5000"); db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON");
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, experiment TEXT NOT NULL, title TEXT NOT NULL,
      settings TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner, updated);
      CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, session TEXT NOT NULL REFERENCES sessions(id), owner TEXT NOT NULL,
      name TEXT NOT NULL, mime TEXT NOT NULL, role TEXT NOT NULL, bytes INTEGER NOT NULL,
      sha256 TEXT, ready INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assets_session ON assets(session);
      CREATE TABLE IF NOT EXISTS hidden_uploads (
        asset TEXT PRIMARY KEY REFERENCES assets(id), owner TEXT NOT NULL, created TEXT NOT NULL);`);
    return fn(db, root);
  } finally { db.close(); }
}
type SessionRow = { id: string; owner: string; experiment: string; title: string; settings: string; notes: string; archived: number; revision: number; created: string; updated: string };
export type LabAsset = { id: string; session: string; name: string; mime: string; role: "source" | "comparison" | "generated"; bytes: number; sha256: string; created: string; removedFromSaved?: boolean };
export type LabSession = Omit<SessionRow, "owner" | "settings" | "archived"> & { settings: LabSettings; archived: boolean; assets: LabAsset[] };
function owned(db: Database.Database, owner: string, id: string) {
  validId(id);
  const row = db.prepare("SELECT * FROM sessions WHERE id=? AND owner=?").get(id, owner) as SessionRow | undefined;
  if (!row) throw new RequestError("Experiment not found.", 404);
  return row;
}
function present(db: Database.Database, row: SessionRow): LabSession {
  const { owner: _owner, ...safe } = row;
  const assets = db.prepare("SELECT a.id,a.session,a.name,a.mime,a.role,a.bytes,a.sha256,a.created,h.asset IS NOT NULL AS removedFromSaved FROM assets a LEFT JOIN hidden_uploads h ON h.asset=a.id AND h.owner=a.owner WHERE a.session=? AND a.ready=1 ORDER BY a.created,a.id").all(row.id) as LabAsset[];
  return { ...safe, settings: JSON.parse(row.settings), archived: !!row.archived, assets };
}
export function listSessions(owner: string) { return withLab(db => (db.prepare("SELECT * FROM sessions WHERE owner=? ORDER BY updated DESC").all(owner) as SessionRow[]).map(row => present(db, row))); }
export function getSession(owner: string, id: string) { return withLab(db => present(db, owned(db, owner, id))); }
function text(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || value.length > max) throw new RequestError(`Invalid ${label}.`, 400);
  return value.trim();
}
export function validateSettings(value: unknown): LabSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("Invalid settings.", 400);
  const s = value as Record<string, unknown>;
  const options = { mode: ["text", "image", "reference", "edit", "edit-image"], resolution: ["0.2", "0.6", "1"], orientation: ["landscape", "portrait"], gpu: ["auto", "rtx3090", "rtx5060ti"], recipe: ["author", "turbo8"] };
  for (const [key, values] of Object.entries(options)) if (!values.includes(s[key] as string)) throw new RequestError(`Invalid ${key}.`, 400);
  if (s.variant !== undefined && !["pika6","base8"].includes(s.variant as string)) throw new RequestError("Invalid experiment variant.",400);
  if (s.seedLocked !== undefined && typeof s.seedLocked !== "boolean") throw new RequestError("Invalid seed lock.",400);
  if (s.stylePresetId !== undefined && (typeof s.stylePresetId!=="string"||!LAB_STYLE_IDS.has(s.stylePresetId))) throw new RequestError("Invalid H3 style.",400);
  for (const [key, values] of Object.entries({visualStyle:H3_VISUAL_STYLE_OPTIONS,cameraFeel:H3_CAMERA_FEEL_OPTIONS,shotFlow:H3_SHOT_FLOW_OPTIONS}))
    if (s[key] !== undefined && (typeof s[key]!=="string"||!(values as readonly string[]).includes(s[key] as string))) throw new RequestError("Invalid look control.",400);
  if (s.loras !== undefined && (!Array.isArray(s.loras) || s.loras.length>6 || new Set(s.loras.map(l=>l?.id)).size!==s.loras.length || s.loras.some(l=>!l||typeof l.id!=="string"||!/^[\w-]{1,140}$/.test(l.id)||!Number.isFinite(l.strength)||l.strength < -8||l.strength>8))) throw new RequestError("Invalid H3 LoRA selection.",400);
  if (s.selectedSources !== undefined) {
    if (!Array.isArray(s.selectedSources) || s.selectedSources.length > MAX_H3_RENDER_REFERENCES || new Set(s.selectedSources).size !== s.selectedSources.length) throw new RequestError("Select up to 12 references for one render. Saved uploads are not limited.",400);
    s.selectedSources.forEach(validId);
  }
  if (!Number.isInteger(s.seconds) || Number(s.seconds) < 2 || Number(s.seconds) > 15 || !Number.isSafeInteger(s.seed) || Number(s.seed) < 0) throw new RequestError("Duration must be 2–15 whole seconds and seed a nonnegative safe integer.", 400);
  const creative=Object.fromEntries(["stylePresetId","visualStyle","cameraFeel","shotFlow","loras"].filter(key=>s[key]!==undefined).map(key=>[key,s[key]]));
  if(Array.isArray(s.loras))creative.loras=s.loras.map(l=>({id:l.id,strength:l.strength}));
  return { mode: s.mode, resolution: s.resolution, orientation: s.orientation, gpu: s.gpu, recipe: s.recipe, seconds: s.seconds, seed: s.seed, prompt: text(s.prompt, 8000, "prompt"), ...creative, ...(s.seedLocked === undefined ? {} : {seedLocked:s.seedLocked}), ...(s.variant === undefined ? {} : {variant:s.variant}), ...(s.selectedSources === undefined ? {} : {selectedSources:[...s.selectedSources as string[]]}) } as LabSettings;
}
export function createSession(owner: string, experiment: string) {
  const entry = labExperiment(experiment);
  if (!entry) throw new RequestError("Unknown experiment.", 400);
  if (isRetiredExperiment(experiment)) throw new RequestError("This model has been removed. Choose another H3 model; existing media is unchanged.",409);
  if (productionNsfwScope() && entry.kind !== "h3-admin") throw new RequestError("Model not available.", 403);
  return withLab(db => db.transaction(() => {
    if (!uncappedH3History(experiment) && (db.prepare(`SELECT count(*) AS n FROM sessions WHERE owner=? AND experiment IN (${TESTING_SQL_IDS})`).get(owner,...TESTING_EXPERIMENT_IDS) as { n: number }).n >= 200) throw new RequestError("The 200-record research limit has been reached; export and review storage with the administrator.", 409);
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const settings = {...DEFAULT_LAB_SETTINGS, ...(experiment === "body-swap" ? {mode:"edit"} : experiment === "cinematic-upscale" || experiment === "director-studio" ? {mode:"text"} : {} )};
    db.prepare("INSERT INTO sessions (id,owner,experiment,title,settings,created,updated) VALUES (?,?,?,?,?,?,?)").run(id, owner, experiment, entry.title, JSON.stringify(settings), now, now);
    return present(db, owned(db, owner, id));
  })());
}
export function updateSession(owner: string, id: string, input: Record<string, unknown>) {
  const title = text(input.title, 120, "title"), notes = text(input.notes, 16000, "notes"), settings = validateSettings(input.settings);
  if (!title || typeof input.archived !== "boolean" || !Number.isInteger(input.revision)) throw new RequestError("Invalid experiment update.", 400);
  return withLab(db => db.transaction(() => {
    const row = owned(db, owner, id);
    if (row.revision !== input.revision) throw new RequestError("This experiment changed in another window. Reload it before saving.", 409);
    for (const source of settings.selectedSources || []) {
      if (!db.prepare("SELECT id FROM assets WHERE id=? AND session=? AND owner=? AND role='source' AND ready=1").get(source,id,owner)) throw new RequestError("Reference not available in this draft.",400);
    }
    if(input.experiment !== undefined && input.experiment !== row.experiment) {
      if(typeof input.experiment === "string" && isRetiredExperiment(input.experiment))throw new RequestError("This model has been removed. Choose another H3 model.",409);
      if(typeof input.experiment!=="string" || labExperiment(row.experiment)?.kind!=="h3-admin" || labExperiment(input.experiment)?.kind!=="h3-admin" || row.archived)throw new RequestError("Model change is not available for this session.",400);
      // Sources stay in the same owned session; completed jobs retain their immutable request/graph.
      db.prepare("UPDATE sessions SET experiment=? WHERE id=? AND owner=?").run(input.experiment,id,owner);
    }
    db.prepare("UPDATE sessions SET title=?,notes=?,settings=?,archived=?,revision=revision+1,updated=? WHERE id=? AND owner=?").run(title, notes, JSON.stringify(settings), input.archived ? 1 : 0, new Date().toISOString(), id, owner);
    return present(db, owned(db, owner, id));
  })());
}
export function reserveAsset(owner: string, session: string, name: string, mime: string, role: string, reservationBytes=MAX_ASSET_BYTES) {
  if(![MAX_ASSET_BYTES,MAX_LAB_IMAGE_BYTES].includes(reservationBytes))throw new RequestError("Invalid upload reservation.",400);
  return withLab((db, root) => db.transaction(() => {
    const record = owned(db, owner, session);
    if (record.archived) throw new RequestError("Restore this experiment before uploading.", 409);
    assertLabAssetCapacity(db,root,owner,record,reservationBytes,mime);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO assets (id,session,owner,name,mime,role,bytes,created) VALUES (?,?,?,?,?,?,?,?)").run(id, session, owner, name.slice(0,120).replace(/[\x00-\x1f\x7f/\\]/g, "_"), mime, role, reservationBytes, new Date().toISOString());
    return { id, file: path.join(root, id + ".media") };
  })());
}
export function finishAsset(owner: string, id: string, bytes: number, sha: string, mime?:string) { withLab(db => db.prepare("UPDATE assets SET ready=1,bytes=?,sha256=?,mime=coalesce(?,mime) WHERE id=? AND owner=? AND ready=0").run(bytes, sha, mime??null, id, owner)); }
export function abandonAsset(owner: string, id: string) { withLab(db => db.prepare("DELETE FROM assets WHERE id=? AND owner=? AND ready=0").run(id, owner)); }
export function getAsset(owner: string, id: string) {
  validId(id);
  return withLab((db, root) => {
    const asset = db.prepare("SELECT id,session,name,mime,role,bytes,sha256,created FROM assets WHERE id=? AND owner=? AND ready=1").get(id, owner) as LabAsset | undefined;
    if (!asset) throw new RequestError("Asset not found.", 404);
    return { asset, file: path.join(root, id + ".media") };
  });
}

/** Remove from the reusable list, not from immutable jobs or their media. */
export function removeSavedUpload(owner: string, id: string) {
  validId(id);
  return withLab(db => db.transaction(() => {
    const asset = db.prepare("SELECT session,role FROM assets WHERE id=? AND owner=? AND ready=1").get(id, owner) as {session:string;role:string} | undefined;
    if (!asset) throw new RequestError("Asset not found.",404);
    if (asset.role !== "source") throw new RequestError("Only saved uploads can be removed from this list.",400);
    db.prepare("INSERT OR IGNORE INTO hidden_uploads(asset,owner,created) VALUES (?,?,?)").run(id,owner,new Date().toISOString());
    return present(db,owned(db,owner,asset.session));
  })());
}
