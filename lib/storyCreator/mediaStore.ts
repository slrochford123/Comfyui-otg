import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { hiddenStoryChatItems, listStoryCreatorMessages } from "./store";
import type { StoryMediaCommand } from "./mediaContract";

export type StoryMediaStatus = "needs_name" | "queued" | "submitting" | "running" | "ready" | "failed" | "canceled" | "unknown";
export type StoryMediaRecord = {
  id: string; ownerKey: string; projectId: string; sourceMessageId: string;
  command: StoryMediaCommand; status: StoryMediaStatus; createdAt: number; updatedAt: number;
  backendJob: Record<string, any> | null; filePath: string | null; error: string | null;
  characterId: string | null; voiceId: string | null;
  profile?: "z-image-turbo-3060" | "flux2-klein-edit-3060" | "gpt-image-2.6-flare" | "qwen3-tts-3060";
  imageAccountId?: string;
  cancelRequested?: boolean;
  stage?: string;
  durationSeconds?: number;
  license?: string;
};
let connection: Database.Database | undefined;
function db() {
  if (connection) return connection;
  const root = path.join(OTG_DATA_ROOT, "story-creator"); fs.mkdirSync(root, {recursive:true,mode:0o700});
  connection = new Database(path.join(root, "story-media.sqlite"));
  fs.chmodSync(path.join(root,"story-media.sqlite"),0o600);
  connection.pragma("journal_mode = WAL"); connection.pragma("busy_timeout = 10000");
  connection.exec(`CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, source TEXT NOT NULL,
    status TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(owner,project,source));`);
  return connection;
}
export function assertStoryMediaScope(ownerKey: string, projectId: string) {
  // Existing store enforces active project ownership, including archived/deleted projects.
  return listStoryCreatorMessages({ownerKey, projectId});
}
export function listStoryMedia(ownerKey: string, projectId: string) {
  assertStoryMediaScope(ownerKey, projectId);
  return (db().prepare("SELECT record FROM media WHERE owner=? AND project=? ORDER BY rowid DESC LIMIT 100").all(ownerKey,projectId) as {record:string}[]).map(r=>JSON.parse(r.record) as StoryMediaRecord);
}
export function listStoryChatMedia(ownerKey: string, projectId: string) {
  const hidden = hiddenStoryChatItems({ownerKey, projectId});
  const visible: StoryMediaRecord[] = [];
  const background: StoryMediaRecord[] = [];
  const rows = db().prepare("SELECT record FROM media WHERE owner=? AND project=? ORDER BY rowid DESC")
    .iterate(ownerKey,projectId) as Iterable<{record: string}>;
  for (const row of rows) {
    const item = JSON.parse(row.record) as StoryMediaRecord;
    if (hidden.message.has(item.sourceMessageId) || hidden.media.has(item.id)) {
      if (["submitting", "running"].includes(item.status) && background.length < 100) background.push(item);
      continue;
    }
    visible.push(item);
    if (visible.length === 100) break;
  }
  return {visible, background};
}
export function getStoryMedia(ownerKey: string, projectId: string, id: string) {
  assertStoryMediaScope(ownerKey, projectId);
  const row = db().prepare("SELECT record FROM media WHERE owner=? AND project=? AND id=?").get(ownerKey,projectId,id) as {record:string}|undefined;
  if (!row) throw Error("Media not found in this project.");
  return JSON.parse(row.record) as StoryMediaRecord;
}
export function storyMediaByRequest(ownerKey:string,projectId:string,requestKey:string) {
  assertStoryMediaScope(ownerKey,projectId);
  const row=db().prepare("SELECT record FROM media WHERE owner=? AND project=? AND source=?").get(ownerKey,projectId,requestKey) as {record:string}|undefined;
  return row?JSON.parse(row.record) as StoryMediaRecord:null;
}
export function createStoryMedia(input: Pick<StoryMediaRecord,"ownerKey"|"projectId"|"sourceMessageId"|"command"|"profile"|"imageAccountId">, requestKey=input.sourceMessageId) {
  const messages = assertStoryMediaScope(input.ownerKey, input.projectId);
  if (!messages.some(m=>m.id===input.sourceMessageId && m.role==="user")) throw Error("Saved user request required.");
  const existing = db().prepare("SELECT record FROM media WHERE owner=? AND project=? AND source=?").get(input.ownerKey,input.projectId,requestKey) as {record:string}|undefined;
  if (existing) return {record:JSON.parse(existing.record) as StoryMediaRecord,created:false};
  const record: StoryMediaRecord = {ownerKey:input.ownerKey,projectId:input.projectId,sourceMessageId:input.sourceMessageId,command:input.command,id:randomUUID(),status:input.command.subject==="character"&&!input.command.name?"needs_name":"queued",
    createdAt:Date.now(),updatedAt:Date.now(),backendJob:null,filePath:null,error:null,characterId:null,voiceId:null,...(input.profile?{profile:input.profile}:{}),...(input.imageAccountId?{imageAccountId:input.imageAccountId}:{})};
  const inserted = db().prepare("INSERT OR IGNORE INTO media VALUES (?,?,?,?,?,?)").run(record.id,record.ownerKey,record.projectId,requestKey,record.status,JSON.stringify(record));
  if (!inserted.changes) return createStoryMedia(input,requestKey);
  return {record,created:true};
}
export function updateStoryMedia(record: StoryMediaRecord, patch: Partial<StoryMediaRecord>, expected = record.status) {
  const current = getStoryMedia(record.ownerKey,record.projectId,record.id);
  if (current.status !== expected) return current;
  const next = {...current,...patch,id:current.id,ownerKey:current.ownerKey,projectId:current.projectId,updatedAt:Date.now()};
  db().prepare("UPDATE media SET status=?,record=? WHERE id=? AND owner=? AND record=?").run(next.status,JSON.stringify(next),next.id,next.ownerKey,JSON.stringify(current));
  return getStoryMedia(record.ownerKey,record.projectId,record.id);
}
export function claimStoryMedia(record: StoryMediaRecord) {
  const next = {...record,status:"submitting" as const,updatedAt:Date.now()};
  return db().prepare("UPDATE media SET status='submitting',record=? WHERE id=? AND owner=? AND status='queued'").run(JSON.stringify(next),record.id,record.ownerKey).changes === 1;
}
export function publicStoryMedia(record: StoryMediaRecord) {
  const {filePath,backendJob,ownerKey,imageAccountId: _imageAccountId,...rest} = record;
  const stage=rest.stage?.replace(/(?:\/home\/|\/mnt\/|\/opt\/|\/var\/|https?:\/\/)[^\s)]+/g,"[private worker]").slice(0,200);
  const error=rest.error?.replace(/(?:\/home\/|\/mnt\/|\/opt\/|\/var\/|https?:\/\/)[^\s)]+/g,"[private worker]").slice(0,600)||null;
  return {...rest,error,stage,engine:record.command.operation==="music"?"YuE2":record.command.operation==="effects"?"Sony Woosh":record.profile==="qwen3-tts-3060"?"Qwen3-TTS · RTX 3060":record.profile==="gpt-image-2.6-flare"?"GPT Image 2.6 Flare · OpenAI":record.profile==="z-image-turbo-3060"?"Z-Image Turbo · RTX 3060":record.profile==="flux2-klein-edit-3060"?"FLUX.2 Klein 4B · RTX 3060":record.command.operation==="image"?"Krea 2 Turbo":record.command.operation==="edit"?"Fibo 2.0 Turbo":record.command.operation==="video"?"FastH3":`Qwen3-TTS${backendJob?.gpu==="rtx5060ti"?" · RTX 5060 Ti":backendJob?.gpu==="rtx3090"?" · RTX 3090":""}`,
    url:record.status==="ready"&&filePath?`/api/story-creator/media/file?projectId=${encodeURIComponent(record.projectId)}&id=${encodeURIComponent(record.id)}`:null};
}
