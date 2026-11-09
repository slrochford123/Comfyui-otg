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
  profile?: "z-image-turbo-3060" | "flux2-klein-edit-3060" | "gpt-image-2.6-flare" | "qwen3-tts-3060" | "story-voice-auto" | "ltx25-story";
  cloudVoice?: {previews?: {id:string;file:string}[]; audition?:string; description?:string; providerVoiceId?:string; selected?:number};
  voiceNotice?:string;
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
    status TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(owner,project,source));
    CREATE TABLE IF NOT EXISTS story_voice_cloud_requests (media TEXT PRIMARY KEY, owner TEXT NOT NULL, day TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS story_voice_cloud_requests_day ON story_voice_cloud_requests(day,owner);
    CREATE TABLE IF NOT EXISTS story_voice_cloud_slots (media TEXT PRIMARY KEY, candidate INTEGER NOT NULL, voice TEXT);`);
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
export function reserveStoryVoiceRequest(record:StoryMediaRecord, design:boolean) {
  const database=db(), day=new Date().toISOString().slice(0,10);
  return database.transaction(()=>{
    const usage=database.prepare("SELECT count(*) AS total, count(CASE WHEN owner=? THEN 1 END) AS personal FROM story_voice_cloud_requests WHERE day=?")
      .get(record.ownerKey,day) as {total:number;personal:number};
    if(usage.total>=5||usage.personal>=3||(design&&storyVoiceSlotsFull(database)))return false;
    return database.prepare("INSERT OR IGNORE INTO story_voice_cloud_requests VALUES (?,?,?)").run(record.id,record.ownerKey,day).changes===1;
  }).immediate();
}
function storyVoiceSlotsFull(database:Database.Database) {
  return (database.prepare("SELECT count(*) AS total FROM story_voice_cloud_slots").get() as {total:number}).total>=3;
}
export function claimStoryVoiceSlot(record:StoryMediaRecord,candidate:number) {
  const database=db();
  return database.transaction(()=>{
    const existing=database.prepare("SELECT candidate,voice FROM story_voice_cloud_slots WHERE media=?").get(record.id) as {candidate:number;voice:string|null}|undefined;
    if(existing){
      if(existing.candidate!==candidate)throw Error("A different audition was selected for this voice.");
      if(!existing.voice)throw Error("ElevenLabs has not confirmed this approval. Contact the administrator before retrying.");
      return existing.voice;
    }
    if(storyVoiceSlotsFull(database))throw Error("All three ElevenLabs voice slots are reserved.");
    database.prepare("INSERT INTO story_voice_cloud_slots VALUES (?,?,NULL)").run(record.id,candidate);
    return null;
  }).immediate();
}
export function settleStoryVoiceSlot(record:StoryMediaRecord,candidate:number,providerId:string|null) {
  if(providerId)db().prepare("UPDATE story_voice_cloud_slots SET voice=? WHERE media=? AND candidate=? AND voice IS NULL").run(providerId,record.id,candidate);
  else db().prepare("DELETE FROM story_voice_cloud_slots WHERE media=? AND candidate=? AND voice IS NULL").run(record.id,candidate);
}
export function approvedStoryCloudVoice(ownerKey:string,voiceId:unknown) {
  if(typeof voiceId!=="string"||!voiceId)return undefined;
  const row=db().prepare("SELECT json_extract(record,'$.cloudVoice.providerVoiceId') AS voice FROM media WHERE owner=? AND status='ready' AND json_extract(record,'$.voiceId')=? LIMIT 1")
    .get(ownerKey,voiceId) as {voice:string|null}|undefined;
  return row?.voice||undefined;
}
export function publicStoryMedia(record: StoryMediaRecord) {
  const {filePath,backendJob,ownerKey,imageAccountId: _imageAccountId,cloudVoice,...rest} = record;
  const stage=rest.stage?.replace(/(?:\/home\/|\/mnt\/|\/opt\/|\/var\/|https?:\/\/)[^\s)]+/g,"[private worker]").slice(0,200);
  const error=rest.error?.replace(/(?:\/home\/|\/mnt\/|\/opt\/|\/var\/|https?:\/\/)[^\s)]+/g,"[private worker]").slice(0,600)||null;
  return {...rest,error,stage,voiceCandidates:cloudVoice?.previews?.length,voiceCandidate:cloudVoice?.selected,voiceAuditionText:cloudVoice?.audition,engine:record.profile==="story-voice-auto"?"ElevenLabs":record.profile==="ltx25-story"?"LTX 2.5 · RTX 3090":record.command.operation==="music"?"YuE2":record.command.operation==="effects"?"Sony Woosh":record.profile==="qwen3-tts-3060"?"Qwen3-TTS · RTX 3060":record.profile==="gpt-image-2.6-flare"?"GPT Image 2.6 Flare · OpenAI":record.profile==="z-image-turbo-3060"?"Z-Image Turbo · RTX 3060":record.profile==="flux2-klein-edit-3060"?"FLUX.2 Klein 4B · RTX 3060":record.command.operation==="image"?"Krea 2 Turbo":record.command.operation==="edit"?"Fibo 2.0 Turbo":record.command.operation==="video"?"FastH3":`Qwen3-TTS${backendJob?.gpu==="rtx5060ti"?" · RTX 5060 Ti":backendJob?.gpu==="rtx3090"?" · RTX 3090":""}`,
    url:record.status==="ready"&&filePath?`/api/story-creator/media/file?projectId=${encodeURIComponent(record.projectId)}&id=${encodeURIComponent(record.id)}`:null};
}
