import { db, ensureMigrations } from "@/lib/auth/db";
import { isAdminUserId } from "@/lib/auth/admin";
import { RequestError } from "@/lib/requestError";
import { withLab, requireTestLab } from "./store";

export type NsfwAccess = { enabled: boolean; admin: boolean; status: "disabled"|"pending"|"enabled"; version: number; requestedAt: string|null; updatedAt: string|null };
type Row = { enabled:number; pending:number; version:number; requested_at:string|null; updated_at:string|null };
function account(id:string) { ensureMigrations(); if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(id)) throw new RequestError("Account not found.",404); }
function schema(store:import("better-sqlite3").Database) {
  store.exec(`CREATE TABLE IF NOT EXISTS h3_nsfw_access (
    user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 0, requested_at TEXT, updated_at TEXT, changed_by TEXT);
    CREATE TABLE IF NOT EXISTS h3_nsfw_access_events (
    id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL);`);
}
export function getNsfwAccess(id:string):NsfwAccess {
  requireTestLab();account(id);
  const admin=isAdminUserId(id);
  return withLab(store=>{schema(store);const row=store.prepare("SELECT * FROM h3_nsfw_access WHERE user_id=?").get(id) as Row|undefined;
    const enabled=admin||!!row?.enabled;
    return {enabled,admin,status:enabled?"enabled":row?.pending?"pending":"disabled",version:row?.version||0,requestedAt:row?.requested_at||null,updatedAt:row?.updated_at||null};
  });
}
export function requireNsfwAccess(id:string) {
  const access=getNsfwAccess(id);if(!access.enabled)throw new RequestError("H3 NSFW access is disabled. Request approval in Settings.",403);return access;
}
export function requestNsfwAccess(id:string,acknowledged:unknown) {
  const access=getNsfwAccess(id);if(access.enabled||access.status==="pending")return access;
  if(acknowledged!==true)throw new RequestError("Confirm adult access and permission to use your references.",400);
  withLab(store=>{schema(store);store.transaction(()=>{
    const now=new Date().toISOString();
    store.prepare("INSERT INTO h3_nsfw_access(user_id,pending,requested_at,updated_at) VALUES(?,1,?,?) ON CONFLICT(user_id) DO UPDATE SET pending=1,requested_at=excluded.requested_at,updated_at=excluded.updated_at WHERE h3_nsfw_access.enabled=0 AND h3_nsfw_access.pending=0").run(id,now,now);
    store.prepare("INSERT INTO h3_nsfw_access_events(user_id,actor_id,action,created_at) VALUES(?,?,'request',?)").run(id,id,now);
  }).immediate();});return getNsfwAccess(id);
}
export function setNsfwAccess(actor:string,id:string,enabled:unknown,version:unknown) {
  requireTestLab();account(actor);account(id);
  if(!isAdminUserId(actor))throw new RequestError("Administrator permission required.",403);
  if(isAdminUserId(id))throw new RequestError("Administrators always have H3 NSFW access.",409);
  if(typeof enabled!=="boolean"||!Number.isSafeInteger(version))throw new RequestError("Invalid permission update.",400);
  withLab(store=>{schema(store);store.transaction(()=>{
    const row=store.prepare("SELECT version FROM h3_nsfw_access WHERE user_id=?").get(id) as {version:number}|undefined;
    if((row?.version||0)!==version)throw new RequestError("Access changed in another window. Refresh users before updating.",409);
    const now=new Date().toISOString();
    store.prepare("INSERT INTO h3_nsfw_access(user_id,enabled,version,updated_at,changed_by) VALUES(?,?,1,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,pending=0,version=h3_nsfw_access.version+1,updated_at=excluded.updated_at,changed_by=excluded.changed_by").run(id,enabled?1:0,now,actor);
    store.prepare("INSERT INTO h3_nsfw_access_events(user_id,actor_id,action,created_at) VALUES(?,?,?,?)").run(id,actor,enabled?"enable":"disable",now);
  }).immediate();});return getNsfwAccess(id);
}
