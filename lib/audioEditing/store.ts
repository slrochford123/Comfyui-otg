import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { defaultTracks, normalizeEdit, type AudioSession, type AudioAsset } from "./contracts";

export const audioRoot = () => path.join(OTG_DATA_ROOT, "audio-editing");
export function assertId(value: unknown): string {
  const id = String(value || "");
  if (!/^[a-f0-9-]{20,40}$/i.test(id)) throw Error("Invalid audio session or asset identifier.");
  return id;
}
export function ownerRoot(owner: string) {
  if (!owner) throw Error("An authenticated owner is required.");
  return path.join(audioRoot(), crypto.createHash("sha256").update(owner).digest("hex"));
}
export function sessionRoot(owner: string, id: string) { return path.join(ownerRoot(owner), assertId(id)); }
function processStartToken(pid:number) {
  try { const stat=fs.readFileSync(`/proc/${pid}/stat`,"utf8");return stat.slice(stat.lastIndexOf(")")+2).split(" ")[19]; }
  catch {return null;}
}
export function reserveSessionStart(owner:string,id:string) {
  readSession(owner,id);
  const file=path.join(sessionRoot(owner,id),"admission.lock");
  const token=crypto.randomUUID();
  let fd:number;
  try {fd=fs.openSync(file,"wx",0o600);}
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
    let stale=false;
    try {
      const stat=fs.statSync(file),previous=JSON.parse(fs.readFileSync(file,"utf8"));
      stale=Number.isInteger(previous.pid)&&previous.startToken&&processStartToken(previous.pid)!==previous.startToken;
      if(stale&&fs.statSync(file).ino===stat.ino)fs.unlinkSync(file);
    }catch { /* incomplete or unverifiable reservations are never stolen */ }
    if(!stale)throw Error("This session is starting an operation. Wait briefly and try again.");
    fd=fs.openSync(file,"wx",0o600);
  }
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startToken:processStartToken(process.pid),token}));
  fs.closeSync(fd);
  return ()=>{try {if(JSON.parse(fs.readFileSync(file,"utf8")).token===token)fs.unlinkSync(file);}catch{/* already released */}};
}
export function atomicJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function createSession(owner: string): AudioSession {
  const now = new Date().toISOString();
  const session: AudioSession = { version: 1, id: crypto.randomUUID(), title: "Audio edit", createdAt: now,
    updatedAt: now, revision: 0, assets: [], stems: {}, tracks: defaultTracks(), clips: [], ducking: false, completedJobs: [] };
  saveSession(owner, session);
  return session;
}
export function readSession(owner: string, id: string): AudioSession {
  const root = sessionRoot(owner, id);
  const file = path.join(root, "session.json");
  if (!fs.existsSync(file)) throw Error("Audio session not found for this account.");
  const session = JSON.parse(fs.readFileSync(file, "utf8")) as AudioSession;
  if (session.id !== id || session.version !== 1) throw Error("Invalid audio session.");
  return session;
}
export function saveSession(owner: string, session: AudioSession) {
  session.updatedAt = new Date().toISOString();
  session.revision += 1;
  atomicJson(path.join(sessionRoot(owner, session.id), "session.json"), session);
}
export function updateSession(owner: string, id: string, patch: Record<string, unknown>, revision: number) {
  const current = readSession(owner, id);
  if (current.revision !== revision) throw Error("This session changed in another tab. Reload it before saving.");
  Object.assign(current, normalizeEdit(patch, current));
  saveSession(owner, current);
  return current;
}
export function containedFile(root: string, file: string) {
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  if (!realFile.startsWith(realRoot + path.sep) || !fs.statSync(realFile).isFile()) throw Error("Audio asset is outside its session.");
  return realFile;
}
export function assetFile(owner: string, session: AudioSession, id: string) {
  const asset = session.assets.find(a => a.id === assertId(id));
  if (!asset) throw Error("Audio asset not found for this session.");
  return containedFile(sessionRoot(owner, session.id), asset.file);
}
export function publicSession(session: AudioSession) {
  return { ...session, assets: session.assets.map(asset => ({ ...asset, file: "",
    url: `/api/edit-video/audio?session=${session.id}&asset=${asset.id}` })) };
}
export function listSessions(owner: string) {
  const root = ownerRoot(owner);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(id => /^[a-f0-9-]{36}$/.test(id)).flatMap(id => {
    try { const s = readSession(owner, id); return [{ id: s.id, title: s.title, updatedAt: s.updatedAt }]; } catch { return []; }
  }).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
}
export function appendAssets(owner: string, sessionId: string, assets: AudioAsset[]) {
  const session = readSession(owner, sessionId);
  for (const asset of assets) {
    containedFile(sessionRoot(owner, sessionId), asset.file);
    if (!session.assets.some(a => a.id === asset.id)) session.assets.push(asset);
  }
  saveSession(owner, session);
  return session;
}
