import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { getStoryProductionPlan } from "@/lib/storyCreator/store";
import { listStoryAudioAssets } from "@/lib/storyCreator/audioProduction";
import { listStoryVideoTakes } from "@/lib/storyCreator/videoProduction";
import type {
  MovieRenderJob,
  MovieTimeline,
  MovieTimelineClip,
  MovieTimelineSnapshot,
  MovieTimelineVersion,
} from "@/lib/storyCreator/movieEditorTypes";

let connection: Database.Database | null = null;
let connectionPath = "";
let storePathOverrideForTests: string | null = null;

function databasePath() {
  if (storePathOverrideForTests) return storePathOverrideForTests;
  const configured = String(process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT || "").trim();
  const root = configured ? path.join(configured, "story-creator") : path.join(os.homedir(), "AI", "runtime", "story-creator");
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, "story-creator.sqlite");
}

export function setMovieEditorStorePathForTests(value: string | null) {
  try { connection?.close(); } catch {}
  connection = null;
  connectionPath = "";
  storePathOverrideForTests = value;
}

function db() {
  const filePath = databasePath();
  if (connection && connectionPath === filePath) return connection;
  try { connection?.close(); } catch {}
  const next = new Database(filePath);
  next.pragma("journal_mode = WAL");
  next.pragma("foreign_keys = ON");
  next.pragma("busy_timeout = 10000");
  next.exec(`
    CREATE TABLE IF NOT EXISTS story_movie_timelines (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      name TEXT NOT NULL,
      plan_version INTEGER NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 1,
      approved_version INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES story_projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_story_movie_timelines_project
      ON story_movie_timelines(project_id, owner_key, updated_at DESC);
    CREATE TABLE IF NOT EXISTS story_movie_timeline_versions (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'approved')),
      label TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (timeline_id) REFERENCES story_movie_timelines(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES story_projects(id) ON DELETE CASCADE,
      UNIQUE(timeline_id, version)
    );
    CREATE TABLE IF NOT EXISTS story_movie_render_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      timeline_id TEXT NOT NULL,
      timeline_version_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('prepared', 'queued', 'running', 'completed', 'failed', 'canceled')),
      preset TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      stage TEXT NOT NULL DEFAULT 'prepared',
      manifest_json TEXT NOT NULL,
      output_path TEXT,
      error TEXT,
      idempotency_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES story_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (timeline_id) REFERENCES story_movie_timelines(id) ON DELETE CASCADE,
      FOREIGN KEY (timeline_version_id) REFERENCES story_movie_timeline_versions(id) ON DELETE RESTRICT,
      UNIQUE(owner_key, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_story_movie_render_jobs_project
      ON story_movie_render_jobs(project_id, owner_key, created_at DESC);
  `);
  next.prepare(`UPDATE story_movie_render_jobs SET status='failed', stage='interrupted', error='Render interrupted by application restart.', updated_at=? WHERE status='running'`).run(Date.now());
  connection = next;
  connectionPath = filePath;
  return next;
}

function clean(value: unknown, max = 20_000) { return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); }
function required(value: unknown, label: string, max = 240) { const result = clean(value, max); if (!result) throw new Error(`${label} is required.`); return result; }
function parseJson<T>(value: unknown, fallback: T): T { try { return JSON.parse(String(value || "")) as T; } catch { return fallback; } }
function hash(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function assertProject(ownerKey: string, projectId: string) {
  const row = db().prepare(`SELECT id FROM story_projects WHERE id=? AND owner_key=? AND status='active'`).get(projectId, ownerKey);
  if (!row) { const error = new Error("Story project was not found.") as Error & { status?: number }; error.status = 404; throw error; }
}

function normalizeClip(value: Partial<MovieTimelineClip>, index: number): MovieTimelineClip {
  const kind = value.kind === "audio" || value.kind === "title" ? value.kind : "video";
  const duration = Math.max(0.1, Math.min(86_400, Number(value.durationSeconds || 5)));
  return {
    id: clean(value.id, 160) || randomUUID(), kind,
    trackId: clean(value.trackId, 80) || (kind === "video" ? "video-main" : kind === "audio" ? "audio-main" : "titles"),
    order: index, sceneId: clean(value.sceneId, 160) || null, shotId: clean(value.shotId, 160) || null,
    sourceType: value.sourceType === "story-audio-asset" || value.sourceType === "generated-title" ? value.sourceType : "story-video-take",
    sourceId: clean(value.sourceId, 160) || null, label: clean(value.label, 500) || `Clip ${index + 1}`,
    timelineStartSeconds: Math.max(0, Number(value.timelineStartSeconds || 0)), sourceInSeconds: Math.max(0, Number(value.sourceInSeconds || 0)),
    sourceOutSeconds: Number.isFinite(Number(value.sourceOutSeconds)) && Number(value.sourceOutSeconds) > 0 ? Number(value.sourceOutSeconds) : null,
    durationSeconds: duration,
    transitionIn: ["fade", "crossfade", "fade-black"].includes(String(value.transitionIn)) ? value.transitionIn! : "cut",
    transitionOut: ["fade", "crossfade", "fade-black"].includes(String(value.transitionOut)) ? value.transitionOut! : "cut",
    transitionDurationSeconds: Math.max(0, Math.min(duration / 2, Number(value.transitionDurationSeconds || 0.5))),
    gainDb: Math.max(-60, Math.min(12, Number(value.gainDb || 0))), muted: Boolean(value.muted),
    audioRole: value.audioRole || (kind === "audio" ? "sound-effect" : null),
    fadeInSeconds: Math.max(0, Math.min(duration / 2, Number(value.fadeInSeconds || 0))), fadeOutSeconds: Math.max(0, Math.min(duration / 2, Number(value.fadeOutSeconds || 0))),
    keepOriginalAudio: value.keepOriginalAudio !== false, fit: value.fit === "cover" ? "cover" : "contain", titleText: clean(value.titleText, 1_000),
  };
}

export function normalizeMovieSnapshot(value: Partial<MovieTimelineSnapshot>, projectId: string): MovieTimelineSnapshot {
  const clips = Array.isArray(value.clips) ? value.clips.slice(0, 2_000).map(normalizeClip) : [];
  const aspect = value.settings?.aspectRatio === "9:16" ? "9:16" : "16:9";
  const quality = value.settings?.quality === "draft-720p" ? "draft-720p" : "standard-1080p";
  const dimensions = quality === "draft-720p" ? (aspect === "9:16" ? [720, 1280] : [1280, 720]) : (aspect === "9:16" ? [1080, 1920] : [1920, 1080]);
  return {
    schemaVersion: 1, projectId, planVersion: Math.max(1, Number(value.planVersion || 1)), name: clean(value.name, 240) || "Movie Timeline",
    mode: value.mode === "advanced" ? "advanced" : "simple", clips,
    settings: { width: dimensions[0], height: dimensions[1], fps: value.settings?.fps === 30 ? 30 : 24, aspectRatio: aspect, quality, musicDucking: value.settings?.musicDucking !== false, loudnessTargetLufs: Math.max(-24, Math.min(-10, Number(value.settings?.loudnessTargetLufs || -16))) },
    incomplete: Boolean(value.incomplete), missingMedia: Array.isArray(value.missingMedia) ? value.missingMedia.slice(0, 1_000).map((item) => ({ sceneId: clean(item.sceneId, 160), shotId: clean(item.shotId, 160), label: clean(item.label, 500), reason: clean(item.reason, 1_000) })) : [],
  };
}

function rowToVersion(row: any): MovieTimelineVersion { return { id: String(row.id), timelineId: String(row.timeline_id), projectId: String(row.project_id), version: Number(row.version), status: row.status === "approved" ? "approved" : "draft", label: String(row.label), snapshot: parseJson(row.snapshot_json, {} as MovieTimelineSnapshot), createdAt: Number(row.created_at) }; }
function loadVersions(ownerKey: string, timelineId: string) { return (db().prepare(`SELECT * FROM story_movie_timeline_versions WHERE timeline_id=? AND owner_key=? ORDER BY version DESC`).all(timelineId, ownerKey) as any[]).map(rowToVersion); }
function rowToTimeline(row: any, ownerKey: string): MovieTimeline { return { id: String(row.id), projectId: String(row.project_id), name: String(row.name), planVersion: Number(row.plan_version), currentVersion: Number(row.current_version), approvedVersion: row.approved_version == null ? null : Number(row.approved_version), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), versions: loadVersions(ownerKey, String(row.id)) }; }

export function listMovieTimelines(input: { ownerKey: unknown; projectId: unknown }) {
  const ownerKey = required(input.ownerKey, "Story owner"), projectId = required(input.projectId, "Story project id"); assertProject(ownerKey, projectId);
  return (db().prepare(`SELECT * FROM story_movie_timelines WHERE project_id=? AND owner_key=? ORDER BY updated_at DESC`).all(projectId, ownerKey) as any[]).map((row) => rowToTimeline(row, ownerKey));
}

export function getMovieTimeline(input: { ownerKey: unknown; projectId: unknown; timelineId: unknown }) {
  const ownerKey = required(input.ownerKey, "Story owner"), projectId = required(input.projectId, "Story project id"), timelineId = required(input.timelineId, "Timeline id"); assertProject(ownerKey, projectId);
  const row = db().prepare(`SELECT * FROM story_movie_timelines WHERE id=? AND project_id=? AND owner_key=?`).get(timelineId, projectId, ownerKey) as any;
  if (!row) { const error = new Error("Movie timeline was not found.") as Error & { status?: number }; error.status = 404; throw error; }
  return rowToTimeline(row, ownerKey);
}

export function assembleMovieTimeline(input: { ownerKey: unknown; projectId: unknown; name?: unknown; sceneIds?: unknown; shotIds?: unknown; idempotencyKey?: unknown }) {
  const ownerKey = required(input.ownerKey, "Story owner"), projectId = required(input.projectId, "Story project id"); assertProject(ownerKey, projectId);
  const record = getStoryProductionPlan({ ownerKey, projectId });
  if (!record || record.status !== "approved") throw new Error("Approve a production plan before assembling a movie timeline.");
  const selected = new Set(Array.isArray(input.sceneIds) ? input.sceneIds.map((value) => clean(value, 160)) : []);
  const selectedShots = new Set(Array.isArray(input.shotIds) ? input.shotIds.map((value) => clean(value, 160)) : []);
  const scenes = record.plan.acts.flatMap((act) => act.scenes).filter((scene) => !selected.size || selected.has(scene.id));
  const takes = listStoryVideoTakes({ ownerKey, projectId, planVersion: record.version }).filter((take) => take.status === "accepted" && take.outputPath);
  const audio = listStoryAudioAssets({ ownerKey, projectId, planVersion: record.version }).filter((asset) => asset.status === "accepted" && asset.outputPath);
  const clips: MovieTimelineClip[] = [];
  const missing: MovieTimelineSnapshot["missingMedia"] = [];
  let cursor = 0;
  for (const scene of scenes) for (const shot of [...scene.shots].sort((a, b) => a.order - b.order).filter((item) => !selectedShots.size || selectedShots.has(item.id))) {
    const take = takes.find((item) => item.sceneId === scene.id && item.shotId === shot.id);
    const duration = take?.settings.durationSeconds || shot.requestedDurationSeconds || 5;
    if (take) clips.push(normalizeClip({ kind: "video", trackId: "video-main", sceneId: scene.id, shotId: shot.id, sourceType: "story-video-take", sourceId: take.id, label: `Scene ${scene.sceneNumber} · Shot ${shot.shotNumber}`, timelineStartSeconds: cursor, durationSeconds: duration, sourceOutSeconds: duration, keepOriginalAudio: true }, clips.length));
    else missing.push({ sceneId: scene.id, shotId: shot.id, label: `Scene ${scene.sceneNumber} · Shot ${shot.shotNumber}`, reason: "No accepted video take is available for this approved-plan shot." });
    for (const asset of audio.filter((item) => item.sceneId === scene.id && item.shotId === shot.id)) {
      clips.push(normalizeClip({ kind: "audio", trackId: `audio-${asset.kind}`, sceneId: scene.id, shotId: shot.id, sourceType: "story-audio-asset", sourceId: asset.id, label: `${asset.kind}: ${asset.speakerName || asset.prompt || shot.description}`, timelineStartSeconds: cursor + asset.startSeconds, durationSeconds: asset.durationSeconds || duration, sourceOutSeconds: asset.durationSeconds || duration, audioRole: asset.kind === "sound-effect" ? "sound-effect" : asset.kind === "ambience" ? "ambience" : asset.kind === "music" ? "music" : asset.kind === "narration" ? "narration" : "dialogue", fadeInSeconds: asset.kind === "music" || asset.kind === "ambience" ? 0.5 : 0, fadeOutSeconds: asset.kind === "music" || asset.kind === "ambience" ? 0.5 : 0 }, clips.length));
    }
    cursor += duration;
  }
  const snapshot = normalizeMovieSnapshot({ projectId, planVersion: record.version, name: clean(input.name, 240) || `${record.plan.title} — Assembly`, clips, incomplete: missing.length > 0, missingMedia: missing }, projectId);
  const now = Date.now(), timelineId = randomUUID(), versionId = randomUUID();
  db().transaction(() => {
    db().prepare(`INSERT INTO story_movie_timelines (id,project_id,owner_key,name,plan_version,current_version,approved_version,created_at,updated_at) VALUES (?,?,?,?,?,1,NULL,?,?)`).run(timelineId, projectId, ownerKey, snapshot.name, record.version, now, now);
    db().prepare(`INSERT INTO story_movie_timeline_versions (id,timeline_id,project_id,owner_key,version,status,label,snapshot_json,source_hash,created_at) VALUES (?,?,?,?,1,'draft','Automatic assembly',?,?,?)`).run(versionId, timelineId, projectId, ownerKey, JSON.stringify(snapshot), hash(snapshot), now);
  })();
  return getMovieTimeline({ ownerKey, projectId, timelineId });
}

export function saveMovieTimelineVersion(input: { ownerKey: unknown; projectId: unknown; timelineId: unknown; snapshot: unknown; label?: unknown }) {
  const ownerKey = required(input.ownerKey, "Story owner"), projectId = required(input.projectId, "Story project id"), timelineId = required(input.timelineId, "Timeline id");
  const timeline = getMovieTimeline({ ownerKey, projectId, timelineId });
  const snapshot = normalizeMovieSnapshot(input.snapshot as Partial<MovieTimelineSnapshot>, projectId);
  if (snapshot.planVersion !== timeline.planVersion) throw new Error("Timeline edits cannot change the production-plan version.");
  const version = timeline.currentVersion + 1, now = Date.now();
  db().transaction(() => {
    db().prepare(`INSERT INTO story_movie_timeline_versions (id,timeline_id,project_id,owner_key,version,status,label,snapshot_json,source_hash,created_at) VALUES (?,?,?,?,?,'draft',?,?,?,?)`).run(randomUUID(), timelineId, projectId, ownerKey, version, clean(input.label, 240) || `Draft ${version}`, JSON.stringify(snapshot), hash(snapshot), now);
    db().prepare(`UPDATE story_movie_timelines SET name=?,current_version=?,updated_at=? WHERE id=? AND project_id=? AND owner_key=?`).run(snapshot.name, version, now, timelineId, projectId, ownerKey);
  })();
  return getMovieTimeline({ ownerKey, projectId, timelineId });
}

export function restoreMovieTimelineVersion(input: { ownerKey: unknown; projectId: unknown; timelineId: unknown; versionId: unknown }) {
  const timeline = getMovieTimeline(input);
  const versionId = required(input.versionId, "Timeline version id");
  const source = timeline.versions.find((item) => item.id === versionId);
  if (!source) throw new Error("Timeline version was not found.");
  return saveMovieTimelineVersion({ ...input, snapshot: source.snapshot, label: `Restored from v${source.version}` });
}

export function approveMovieTimelineVersion(input: { ownerKey: unknown; projectId: unknown; timelineId: unknown; versionId: unknown }) {
  const ownerKey = required(input.ownerKey, "Story owner"), projectId = required(input.projectId, "Story project id"), timelineId = required(input.timelineId, "Timeline id"), versionId = required(input.versionId, "Timeline version id");
  const timeline = getMovieTimeline({ ownerKey, projectId, timelineId }); const version = timeline.versions.find((item) => item.id === versionId); if (!version) throw new Error("Timeline version was not found.");
  const now = Date.now(); db().transaction(() => { db().prepare(`UPDATE story_movie_timeline_versions SET status='draft' WHERE timeline_id=? AND owner_key=? AND status='approved'`).run(timelineId, ownerKey); db().prepare(`UPDATE story_movie_timeline_versions SET status='approved' WHERE id=? AND timeline_id=? AND owner_key=?`).run(versionId, timelineId, ownerKey); db().prepare(`UPDATE story_movie_timelines SET approved_version=?,updated_at=? WHERE id=? AND project_id=? AND owner_key=?`).run(version.version, now, timelineId, projectId, ownerKey); })();
  return getMovieTimeline({ ownerKey, projectId, timelineId });
}

export function applyMovieDirectorInstruction(input: { ownerKey: unknown; projectId: unknown; timelineId: unknown; instruction: unknown }) {
  const ownerKey=required(input.ownerKey,"Story owner"),projectId=required(input.projectId,"Story project id"),timelineId=required(input.timelineId,"Timeline id"),instruction=required(input.instruction,"Editing instruction",2_000);
  const timeline=getMovieTimeline({ownerKey,projectId,timelineId}), current=timeline.versions.find((item)=>item.version===timeline.currentVersion)||timeline.versions[0];
  if(!current) throw new Error("Timeline version was not found.");
  const snapshot=structuredClone(current.snapshot), lower=instruction.toLowerCase();
  const plan=getStoryProductionPlan({ownerKey,projectId});
  const scenes=plan?.plan.acts.flatMap((act)=>act.scenes)||[];
  let summary="";
  const shotNumber=lower.match(/shot\s+(\d+)/)?.[1];
  const shot=shotNumber?scenes.flatMap((scene)=>scene.shots).find((item)=>item.shotNumber===shotNumber):null;
  const seconds=Number(lower.match(/(?:first|by)\s+(\d+(?:\.\d+)?)\s+second/)?.[1]||0);
  if(shot&&seconds>0&&/(remove|trim)/.test(lower)){
    const clip=snapshot.clips.find((item)=>item.kind==="video"&&item.shotId===shot.id);if(!clip)throw new Error(`Shot ${shotNumber} is not on this timeline.`);
    if(clip.durationSeconds-seconds<0.1)throw new Error("That trim would remove the entire clip.");clip.sourceInSeconds+=seconds;clip.durationSeconds-=seconds;clip.sourceOutSeconds=clip.sourceInSeconds+clip.durationSeconds;summary=`Trimmed ${seconds} seconds from Shot ${shotNumber}.`;
  } else if(/remove.*music|music.*remove/.test(lower)){
    snapshot.clips.filter((item)=>item.audioRole==="music").forEach((item)=>{item.muted=true;});summary="Muted the music tracks without changing their source files.";
  } else if(/reduce.*music|duck.*music|music.*quieter/.test(lower)){
    snapshot.clips.filter((item)=>item.audioRole==="music").forEach((item)=>{item.gainDb=Math.max(-60,item.gainDb-6);});snapshot.settings.musicDucking=true;summary="Reduced music by 6 dB and enabled dialogue ducking.";
  } else if(/fade to black/.test(lower)){
    const videos=snapshot.clips.filter((item)=>item.kind==="video"||item.kind==="title").sort((a,b)=>a.order-b.order);if(!videos.length)throw new Error("The timeline has no visual clips.");videos[videos.length-1].transitionOut="fade-black";videos[videos.length-1].transitionDurationSeconds=Math.max(1,videos[videos.length-1].transitionDurationSeconds);summary="Added a fade to black at the end of the sequence.";
  } else if(/transition.*slower|slower.*transition/.test(lower)){
    snapshot.clips.filter((item)=>item.kind!=="audio"&&item.transitionIn!=="cut").forEach((item)=>{item.transitionDurationSeconds=Math.min(item.durationSeconds/2,item.transitionDurationSeconds+0.5);});summary="Lengthened the active transitions by half a second where clip duration permits.";
  } else if(/opening (title|credits)/.test(lower)||/add opening/.test(lower)||/ending credits/.test(lower)){
    const ending=/ending/.test(lower),duration=4,title=ending?"Ending Credits":plan?.plan.title||"Opening Title";
    const clip=normalizeClip({kind:"title",trackId:"titles",sourceType:"generated-title",label:title,titleText:title,durationSeconds:duration,sourceOutSeconds:duration,transitionIn:"fade",transitionOut:"fade",transitionDurationSeconds:0.75},0);
    snapshot.clips=ending?[...snapshot.clips,clip]:[clip,...snapshot.clips];
    const visuals=snapshot.clips.filter((item)=>item.kind==="video"||item.kind==="title");let cursor=0;visuals.forEach((item,index)=>{item.order=index;item.timelineStartSeconds=cursor;cursor+=item.durationSeconds;});summary=`Added ${ending?"ending credits":"an opening title"}.`;
  } else if(shot&&/use take\s+(\d+)/.test(lower)){
    const takeNumber=Number(lower.match(/use take\s+(\d+)/)?.[1]);const take=listStoryVideoTakes({ownerKey,projectId,planVersion:snapshot.planVersion}).find((item)=>item.shotId===shot.id&&item.takeNumber===takeNumber&&item.status==="accepted"&&item.outputPath);if(!take)throw new Error(`Accepted Take ${takeNumber} was not found for Shot ${shotNumber}.`);const clip=snapshot.clips.find((item)=>item.kind==="video"&&item.shotId===shot.id);if(!clip)throw new Error(`Shot ${shotNumber} is not on this timeline.`);clip.sourceId=take.id;clip.durationSeconds=take.settings.durationSeconds;clip.sourceInSeconds=0;clip.sourceOutSeconds=take.settings.durationSeconds;summary=`Selected accepted Take ${takeNumber} for Shot ${shotNumber}.`;
  } else {
    throw new Error("That editing command is not supported yet. Try trimming a numbered shot, reducing or removing music, adding opening or ending credits, changing an accepted take, slowing transitions, or fading to black.");
  }
  return {timeline:saveMovieTimelineVersion({ownerKey,projectId,timelineId,snapshot,label:`Story Director: ${instruction.slice(0,80)}`}),summary};
}

function rowToRender(row: any): MovieRenderJob { const projectId=String(row.project_id), id=String(row.id), status=String(row.status) as MovieRenderJob["status"]; return { id, projectId, timelineId:String(row.timeline_id), timelineVersionId:String(row.timeline_version_id), status, preset:String(row.preset), progress:Number(row.progress), stage:String(row.stage), outputPath:row.output_path?String(row.output_path):null, downloadUrl:status==="completed"?`/api/story-creator/movie-editor/media?projectId=${encodeURIComponent(projectId)}&renderId=${encodeURIComponent(id)}`:null, error:row.error?String(row.error):null, manifest:parseJson(row.manifest_json,{}), idempotencyKey:String(row.idempotency_key), createdAt:Number(row.created_at), updatedAt:Number(row.updated_at), completedAt:row.completed_at==null?null:Number(row.completed_at) }; }
export function listMovieRenderJobs(input:{ownerKey:unknown;projectId:unknown}) { const ownerKey=required(input.ownerKey,"Story owner"),projectId=required(input.projectId,"Story project id");assertProject(ownerKey,projectId);return (db().prepare(`SELECT * FROM story_movie_render_jobs WHERE project_id=? AND owner_key=? ORDER BY created_at DESC LIMIT 50`).all(projectId,ownerKey) as any[]).map(rowToRender); }
export function getMovieRenderJob(input:{ownerKey:unknown;projectId:unknown;renderId:unknown}) { const ownerKey=required(input.ownerKey,"Story owner"),projectId=required(input.projectId,"Story project id"),renderId=required(input.renderId,"Render id"); const row=db().prepare(`SELECT * FROM story_movie_render_jobs WHERE id=? AND project_id=? AND owner_key=?`).get(renderId,projectId,ownerKey) as any; if(!row){const error=new Error("Movie render was not found.") as Error&{status?:number};error.status=404;throw error;} return rowToRender(row); }

export function resolveMovieSources(ownerKey:string, projectId:string, snapshot:MovieTimelineSnapshot) {
  const takes=new Map(listStoryVideoTakes({ownerKey,projectId,planVersion:snapshot.planVersion}).map((item)=>[item.id,item]));
  const audio=new Map(listStoryAudioAssets({ownerKey,projectId,planVersion:snapshot.planVersion}).map((item)=>[item.id,item]));
  return snapshot.clips.map((clip)=>{
    if(clip.sourceType==="generated-title") return {...clip,sourcePath:null};
    const source=clip.sourceType==="story-video-take"?takes.get(clip.sourceId||""):audio.get(clip.sourceId||"");
    const allowed=clip.sourceType==="story-video-take"?["accepted"]:["accepted"];
    if(!source||!allowed.includes(source.status)||!source.outputPath) throw new Error(`${clip.label} no longer has an accepted, readable source.`);
    const resolved=path.resolve(source.outputPath),root=path.resolve(OTG_DATA_ROOT),relative=path.relative(root,resolved);
    if(!relative||relative.startsWith("..")||path.isAbsolute(relative)||!fs.existsSync(resolved)||!fs.statSync(resolved).isFile()) throw new Error(`${clip.label} source is missing or outside protected media storage.`);
    return {...clip,sourcePath:resolved};
  });
}

export function prepareMovieRender(input:{ownerKey:unknown;projectId:unknown;timelineId:unknown;versionId:unknown;preset?:unknown;idempotencyKey:unknown;allowIncomplete?:unknown}) {
  const ownerKey=required(input.ownerKey,"Story owner"),projectId=required(input.projectId,"Story project id"),timelineId=required(input.timelineId,"Timeline id"),versionId=required(input.versionId,"Timeline version id"),idempotencyKey=required(input.idempotencyKey,"Render idempotency key",240);
  const existing=db().prepare(`SELECT * FROM story_movie_render_jobs WHERE owner_key=? AND idempotency_key=?`).get(ownerKey,idempotencyKey) as any;if(existing)return rowToRender(existing);
  const timeline=getMovieTimeline({ownerKey,projectId,timelineId}), version=timeline.versions.find((item)=>item.id===versionId); if(!version) throw new Error("Timeline version was not found.");
  if(version.snapshot.incomplete&&input.allowIncomplete!==true) throw new Error("This timeline has missing media. Enable partial export explicitly or complete the missing shots.");
  const sources=resolveMovieSources(ownerKey,projectId,version.snapshot); if(!sources.some((clip)=>clip.kind==="video"||clip.kind==="title")) throw new Error("The timeline has no renderable video or title clips.");
  const manifest={schemaVersion:1,projectId,timelineId,timelineVersionId:version.id,timelineVersion:version.version,planVersion:version.snapshot.planVersion,createdAt:Date.now(),incomplete:version.snapshot.incomplete,settings:version.snapshot.settings,clips:sources};
  const now=Date.now(),id=randomUUID(),preset=clean(input.preset,80)||version.snapshot.settings.quality;
  db().prepare(`INSERT INTO story_movie_render_jobs (id,project_id,owner_key,timeline_id,timeline_version_id,status,preset,progress,stage,manifest_json,output_path,error,idempotency_key,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,'prepared',?,0,'validated',?,NULL,NULL,?,?,?,NULL)`).run(id,projectId,ownerKey,timelineId,version.id,preset,JSON.stringify(manifest),idempotencyKey,now,now);
  return getMovieRenderJob({ownerKey,projectId,renderId:id});
}

export function claimMovieRender(input:{ownerKey:string;projectId:string;renderId:string}) { const job=getMovieRenderJob(input); if(!["prepared","failed"].includes(job.status)) throw new Error("Only a prepared or failed render can be started."); db().prepare(`UPDATE story_movie_render_jobs SET status='queued',progress=1,stage='queued',error=NULL,updated_at=? WHERE id=? AND project_id=? AND owner_key=?`).run(Date.now(),job.id,input.projectId,input.ownerKey); return getMovieRenderJob(input); }
export function updateMovieRender(input:{ownerKey:string;projectId:string;renderId:string;status:MovieRenderJob["status"];progress:number;stage:string;outputPath?:string|null;error?:string|null}) { const now=Date.now();db().prepare(`UPDATE story_movie_render_jobs SET status=?,progress=?,stage=?,output_path=COALESCE(?,output_path),error=?,updated_at=?,completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END WHERE id=? AND project_id=? AND owner_key=?`).run(input.status,Math.max(0,Math.min(100,input.progress)),clean(input.stage,120),input.outputPath||null,input.error||null,now,input.status,now,input.renderId,input.projectId,input.ownerKey);return getMovieRenderJob(input); }
export function movieRenderRoot(ownerKey:string,projectId:string,renderId:string){const root=safeJoin(OTG_DATA_ROOT,"story-movies",safeSegment(ownerKey),safeSegment(projectId),safeSegment(renderId));fs.mkdirSync(root,{recursive:true});return root;}

export function movieEditorSnapshot(input:{ownerKey:unknown;projectId:unknown}) { return {timelines:listMovieTimelines(input),renders:listMovieRenderJobs(input),capabilities:{persistentTimeline:true,immutableVersions:true,serverFfmpeg:true,formats:["MP4 (H.264/AAC)"],presets:["draft-720p","standard-1080p"],transitions:["cut","fade","crossfade","fade-black"],previewAccuracy:"browser approximation; final timing is determined by FFmpeg"}}; }
