import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { DEFAULT_LAB_SETTINGS, labExperiment, type LabSettings } from "./catalog";
import { RequestError } from "@/lib/requestError";

export const MAX_ASSET_BYTES = 128 * 1024 * 1024;
export const MAX_ASSETS = 12;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !uuid.test(value)) throw new RequestError("Invalid experiment identifier.", 400);
}
export function requireTestLab() {
  if (process.env.OTG_ENV !== "test") throw new RequestError("Not found.", 404);
}
export function labRoot() {
  requireTestLab();
  const root = process.env.OTG_EXPERIMENTS_ROOT || "/home/shawn-rochford/AI/runtime/test/experiments";
  if (!path.isAbsolute(root) || root === "/" || root !== path.normalize(root)) throw new RequestError("Invalid experiment storage configuration.", 503);
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
      CREATE INDEX IF NOT EXISTS assets_session ON assets(session);`);
    return fn(db, root);
  } finally { db.close(); }
}
type SessionRow = { id: string; owner: string; experiment: string; title: string; settings: string; notes: string; archived: number; revision: number; created: string; updated: string };
export type LabAsset = { id: string; session: string; name: string; mime: string; role: "source" | "comparison" | "generated"; bytes: number; sha256: string; created: string };
export type LabSession = Omit<SessionRow, "owner" | "settings" | "archived"> & { settings: LabSettings; archived: boolean; assets: LabAsset[] };
function owned(db: Database.Database, owner: string, id: string) {
  validId(id);
  const row = db.prepare("SELECT * FROM sessions WHERE id=? AND owner=?").get(id, owner) as SessionRow | undefined;
  if (!row) throw new RequestError("Experiment not found.", 404);
  return row;
}
function present(db: Database.Database, row: SessionRow): LabSession {
  const { owner: _owner, ...safe } = row;
  const assets = db.prepare("SELECT id,session,name,mime,role,bytes,sha256,created FROM assets WHERE session=? AND ready=1 ORDER BY created,id").all(row.id) as LabAsset[];
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
  if (s.selectedSources !== undefined) {
    if (!Array.isArray(s.selectedSources) || s.selectedSources.length > MAX_ASSETS || new Set(s.selectedSources).size !== s.selectedSources.length) throw new RequestError("Invalid reference selection.",400);
    s.selectedSources.forEach(validId);
  }
  if (!Number.isInteger(s.seconds) || Number(s.seconds) < 2 || Number(s.seconds) > 15 || !Number.isSafeInteger(s.seed) || Number(s.seed) < 0) throw new RequestError("Duration must be 2–15 whole seconds and seed a nonnegative safe integer.", 400);
  return { mode: s.mode, resolution: s.resolution, orientation: s.orientation, gpu: s.gpu, recipe: s.recipe, seconds: s.seconds, seed: s.seed, prompt: text(s.prompt, 8000, "prompt"), ...(s.seedLocked === undefined ? {} : {seedLocked:s.seedLocked}), ...(s.variant === undefined ? {} : {variant:s.variant}), ...(s.selectedSources === undefined ? {} : {selectedSources:[...s.selectedSources as string[]]}) } as LabSettings;
}
export function createSession(owner: string, experiment: string) {
  const entry = labExperiment(experiment);
  if (!entry) throw new RequestError("Unknown experiment.", 400);
  return withLab(db => db.transaction(() => {
    if ((db.prepare("SELECT count(*) AS n FROM sessions WHERE owner=?").get(owner) as { n: number }).n >= 200) throw new RequestError("The 200-record research limit has been reached; export and review storage with the administrator.", 409);
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
      if(typeof input.experiment!=="string" || labExperiment(row.experiment)?.kind!=="h3-admin" || labExperiment(input.experiment)?.kind!=="h3-admin" || row.archived)throw new RequestError("Model change is not available for this session.",400);
      // Sources stay in the same owned session; completed jobs retain their immutable request/graph.
      db.prepare("UPDATE sessions SET experiment=? WHERE id=? AND owner=?").run(input.experiment,id,owner);
    }
    db.prepare("UPDATE sessions SET title=?,notes=?,settings=?,archived=?,revision=revision+1,updated=? WHERE id=? AND owner=?").run(title, notes, JSON.stringify(settings), input.archived ? 1 : 0, new Date().toISOString(), id, owner);
    return present(db, owned(db, owner, id));
  })());
}
export function reserveAsset(owner: string, session: string, name: string, mime: string, role: string) {
  return withLab((db, root) => db.transaction(() => {
    const record = owned(db, owner, session);
    if (record.archived) throw new RequestError("Restore this experiment before uploading.", 409);
    if ((db.prepare("SELECT count(*) AS n FROM assets WHERE session=? AND (ready=1 OR bytes>0)").get(session) as { n: number }).n >= MAX_ASSETS) throw new RequestError("At most 12 assets per experiment.", 409);
    const ownerBytes = (db.prepare("SELECT coalesce(sum(bytes),0) AS n FROM assets WHERE owner=?").get(owner) as { n: number }).n;
    const totalBytes = (db.prepare("SELECT coalesce(sum(bytes),0) AS n FROM assets").get() as { n: number }).n;
    const disk = fs.statfsSync(root);
    if (ownerBytes + MAX_ASSET_BYTES > 2 * 1024 ** 3 || totalBytes + MAX_ASSET_BYTES > 16 * 1024 ** 3 || disk.bavail * disk.bsize < 8 * 1024 ** 3 + MAX_ASSET_BYTES) throw new RequestError("Research storage limit reached or less than 8 GB safety reserve available.", 507);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO assets (id,session,owner,name,mime,role,bytes,created) VALUES (?,?,?,?,?,?,?,?)").run(id, session, owner, name.slice(0,120).replace(/[\x00-\x1f\x7f/\\]/g, "_"), mime, role, MAX_ASSET_BYTES, new Date().toISOString());
    return { id, file: path.join(root, id + ".media") };
  })());
}
export function finishAsset(owner: string, id: string, bytes: number, sha: string) { withLab(db => db.prepare("UPDATE assets SET ready=1,bytes=?,sha256=? WHERE id=? AND owner=? AND ready=0").run(bytes, sha, id, owner)); }
export function abandonAsset(owner: string, id: string) { withLab(db => db.prepare("DELETE FROM assets WHERE id=? AND owner=? AND ready=0").run(id, owner)); }
export function getAsset(owner: string, id: string) {
  validId(id);
  return withLab((db, root) => {
    const asset = db.prepare("SELECT id,session,name,mime,role,bytes,sha256,created FROM assets WHERE id=? AND owner=? AND ready=1").get(id, owner) as LabAsset | undefined;
    if (!asset) throw new RequestError("Asset not found.", 404);
    return { asset, file: path.join(root, id + ".media") };
  });
}
