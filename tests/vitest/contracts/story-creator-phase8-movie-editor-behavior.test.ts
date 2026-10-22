import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Store = typeof import("../../../lib/storyCreator/store");
type Video = typeof import("../../../lib/storyCreator/videoProduction");
type Audio = typeof import("../../../lib/storyCreator/audioProduction");
type Movie = typeof import("../../../lib/storyCreator/movieEditor");
type Executor = typeof import("../../../lib/storyCreator/movieRenderExecutor");

let store: Store, video: Video, audio: Audio, movie: Movie, executor: Executor;
let tempRoot = "", projectId = "", timelineId = "", ownerKey = "phase8-owner";
const priorDataDir = process.env.OTG_DATA_DIR, priorDataRoot = process.env.OTG_DATA_ROOT;

function fixture(file: string, color: string, tone: number) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=24:d=0.8`, "-f", "lavfi", "-i", `sine=frequency=${tone}:sample_rate=48000:duration=0.8`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
}

describe("Story Creator Phase 8 movie editor behavior", () => {
  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-story-phase8-"));
    process.env.OTG_DATA_DIR = tempRoot; process.env.OTG_DATA_ROOT = tempRoot; vi.resetModules();
    store = await import("../../../lib/storyCreator/store"); video = await import("../../../lib/storyCreator/videoProduction"); audio = await import("../../../lib/storyCreator/audioProduction"); movie = await import("../../../lib/storyCreator/movieEditor"); executor = await import("../../../lib/storyCreator/movieRenderExecutor");
    const project = store.createStoryCreatorProject({ ownerKey, title: "Fixture Film", format: "short", genre: "test" }); projectId = project.id;
    store.saveStoryProductionPlan({ ownerKey, projectId, plan: { title: "Fixture Film", format: "short", summary: "Two colors", targetDurationSeconds: 2, acts: [{ id: "act-1", order: 1, title: "Act", summary: "", scenes: [{ id: "scene-1", order: 1, sceneNumber: "1", title: "Colors", purpose: "Test", location: "Studio", timeOfDay: "day", characters: [], action: "Colors change", dialogue: [], emotionalTone: "neutral", continuityRequirements: [], durationTargetSeconds: 2, screenplaySource: "", shots: [
      { id: "shot-1", order: 1, shotNumber: "1", screenplayExcerpt: "Red", description: "Red frame", cameraFraming: "wide", cameraMovement: "locked", characterActions: "", dialogue: [], referenceAssetIds: [], generationApproach: "text-to-video", requestedDurationSeconds: 5, status: "approved", acceptedTakeId: null, takes: [] },
      { id: "shot-2", order: 2, shotNumber: "2", screenplayExcerpt: "Blue", description: "Blue frame", cameraFraming: "wide", cameraMovement: "locked", characterActions: "", dialogue: [], referenceAssetIds: [], generationApproach: "text-to-video", requestedDurationSeconds: 5, status: "approved", acceptedTakeId: null, takes: [] },
    ] }] }] } });
    const planVersion = store.approveStoryProductionPlan({ ownerKey, projectId }).version;
    const red = path.join(tempRoot, "red.mp4"), blue = path.join(tempRoot, "blue.mp4"); fixture(red, "red", 440); fixture(blue, "blue", 660);
    const first = video.prepareStoryVideoTake({ ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-1", method: "text-to-video", motion: "Red", durationSeconds: 5, idempotencyKey: "phase8-red" }).take;
    const second = video.prepareStoryVideoTake({ ownerKey, projectId, planVersion, sceneId: "scene-1", shotId: "shot-2", method: "text-to-video", motion: "Blue", durationSeconds: 5, idempotencyKey: "phase8-blue" }).take;
    const database = new Database(path.join(tempRoot, "story-creator", "story-creator.sqlite"));
    database.prepare(`UPDATE story_video_takes SET status='accepted',output_path=?,accepted_at=?,updated_at=? WHERE id=?`).run(red,Date.now(),Date.now(),first.id);
    database.prepare(`UPDATE story_video_takes SET status='accepted',output_path=?,accepted_at=?,updated_at=? WHERE id=?`).run(blue,Date.now(),Date.now(),second.id);
    database.close();
    const timeline = movie.assembleMovieTimeline({ ownerKey, projectId, idempotencyKey: "assembly" }); timelineId = timeline.id;
  }, 30_000);

  afterAll(() => {
    movie.setMovieEditorStorePathForTests(null); audio.setStoryAudioProductionStorePathForTests(null); video.setStoryVideoProductionStorePathForTests(null);
    if (priorDataDir === undefined) delete process.env.OTG_DATA_DIR; else process.env.OTG_DATA_DIR = priorDataDir;
    if (priorDataRoot === undefined) delete process.env.OTG_DATA_ROOT; else process.env.OTG_DATA_ROOT = priorDataRoot;
    fs.rmSync(tempRoot,{recursive:true,force:true});
  });

  it("assembles accepted takes in plan order and persists after reload", () => {
    const timeline = movie.getMovieTimeline({ ownerKey, projectId, timelineId });
    const clips = timeline.versions[0].snapshot.clips.filter((item) => item.kind === "video");
    expect(clips.map((item) => item.shotId)).toEqual(["shot-1", "shot-2"]);
    expect(timeline.versions[0].snapshot.incomplete).toBe(false);
    movie.setMovieEditorStorePathForTests(null);
    expect(movie.getMovieTimeline({ ownerKey, projectId, timelineId }).versions).toHaveLength(1);
  });

  it("creates immutable revisions and restores earlier versions additively", () => {
    const timeline = movie.getMovieTimeline({ ownerKey, projectId, timelineId });
    const changed = structuredClone(timeline.versions[0].snapshot);
    changed.clips[0].durationSeconds = 0.6; changed.clips[0].sourceOutSeconds = 0.6;
    const saved = movie.saveMovieTimelineVersion({ ownerKey, projectId, timelineId, snapshot: changed, label: "Trim revision" });
    expect(saved.versions).toHaveLength(2); expect(saved.versions[1].snapshot.clips[0].durationSeconds).not.toBe(0.6);
    const restored = movie.restoreMovieTimelineVersion({ ownerKey, projectId, timelineId, versionId: saved.versions[1].id });
    expect(restored.versions).toHaveLength(3);
  });

  it("prepares idempotently, renders a real atomic MP4, and verifies streams", async () => {
    const timeline = movie.getMovieTimeline({ ownerKey, projectId, timelineId });
    const latest = timeline.versions[0];
    latest.snapshot.clips.filter((item) => item.kind === "video").forEach((clip,index) => { clip.durationSeconds=0.7; clip.sourceOutSeconds=0.7; if(index===1){clip.transitionIn="crossfade";clip.transitionDurationSeconds=0.15;} });
    const saved = movie.saveMovieTimelineVersion({ ownerKey, projectId, timelineId, snapshot: latest.snapshot, label: "Fixture render" });
    const version = saved.versions[0];
    const sourcePaths = version.snapshot.clips.filter((item) => item.kind === "video").map((item) => {
      const take = video.getStoryVideoTake({ ownerKey, projectId, takeId: item.sourceId });
      return take.outputPath!;
    });
    const sourceHashes = sourcePaths.map((file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
    const prepared = movie.prepareMovieRender({ ownerKey, projectId, timelineId, versionId: version.id, idempotencyKey: "fixture-render" });
    expect(movie.prepareMovieRender({ ownerKey, projectId, timelineId, versionId: version.id, idempotencyKey: "fixture-render" }).id).toBe(prepared.id);
    movie.claimMovieRender({ ownerKey, projectId, renderId: prepared.id });
    const completed = await executor.executeMovieRender({ ownerKey, projectId, renderId: prepared.id });
    expect(completed.status).toBe("completed"); expect(completed.outputPath && fs.existsSync(completed.outputPath)).toBe(true); expect(fs.existsSync(path.join(path.dirname(completed.outputPath!),"movie.partial.mp4"))).toBe(false);
    const probe = JSON.parse(execFileSync("ffprobe",["-v","error","-print_format","json","-show_streams","-show_format",completed.outputPath!],{encoding:"utf8"}));
    expect(probe.streams.some((item:any)=>item.codec_type==="video")).toBe(true); expect(probe.streams.some((item:any)=>item.codec_type==="audio")).toBe(true); expect(Number(probe.format.duration)).toBeGreaterThan(1); expect(Number(probe.streams.find((item:any)=>item.codec_type==="video").width)).toBe(1920);
    expect(sourcePaths.map((file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"))).toEqual(sourceHashes);
  }, 120_000);

  it("marks missing shots and blocks export unless partial output is explicit", () => {
    const project = store.createStoryCreatorProject({ ownerKey, title: "Missing Fixture", format: "short", genre: "test" });
    store.saveStoryProductionPlan({ ownerKey, projectId: project.id, plan: { title: "Missing Fixture", format: "short", summary: "", targetDurationSeconds: 5, acts: [{ id: "missing-act", order: 1, title: "Act", summary: "", scenes: [{ id: "missing-scene", order: 1, sceneNumber: "1", title: "Missing", purpose: "", location: "", timeOfDay: "", characters: [], action: "", dialogue: [], emotionalTone: "", continuityRequirements: [], durationTargetSeconds: 5, screenplaySource: "", shots: [{ id: "missing-shot", order: 1, shotNumber: "1", screenplayExcerpt: "", description: "Missing shot", cameraFraming: "wide", cameraMovement: "locked", characterActions: "", dialogue: [], referenceAssetIds: [], generationApproach: "text-to-video", requestedDurationSeconds: 5, status: "approved", acceptedTakeId: null, takes: [] }] }] }] } });
    store.approveStoryProductionPlan({ ownerKey, projectId: project.id });
    const timeline = movie.assembleMovieTimeline({ ownerKey, projectId: project.id });
    expect(timeline.versions[0].snapshot.incomplete).toBe(true);
    expect(timeline.versions[0].snapshot.missingMedia[0].shotId).toBe("missing-shot");
    expect(() => movie.prepareMovieRender({ ownerKey, projectId: project.id, timelineId: timeline.id, versionId: timeline.versions[0].id, idempotencyKey: "blocked-missing" })).toThrow(/missing media/i);
  });

  it("rejects cross-owner timeline and render access", () => {
    expect(() => movie.getMovieTimeline({ ownerKey: "outsider", projectId, timelineId })).toThrow();
    expect(() => movie.listMovieRenderJobs({ ownerKey: "outsider", projectId })).toThrow();
  });
});
