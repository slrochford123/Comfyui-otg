import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const source = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Story Creator Phase 8 movie editor contracts", () => {
  it("uses authenticated owner-scoped APIs and protected range media", () => {
    const route = source("app/api/story-creator/movie-editor/route.ts");
    const media = source("app/api/story-creator/movie-editor/media/route.ts");
    expect(route).toContain("requireSessionUser");
    expect(route).toContain("Explicit render authorization is required");
    expect(media).toContain("requireSessionUser");
    expect(media).toContain("path.relative");
    expect(media).toContain("mediaFileResponse");
    expect(route + media).not.toContain("OPENAI_API_KEY");
  });

  it("stores additive immutable timeline versions and render snapshots", () => {
    const store = source("lib/storyCreator/movieEditor.ts");
    expect(store).toContain("CREATE TABLE IF NOT EXISTS story_movie_timelines");
    expect(store).toContain("CREATE TABLE IF NOT EXISTS story_movie_timeline_versions");
    expect(store).toContain("CREATE TABLE IF NOT EXISTS story_movie_render_jobs");
    expect(store).toContain("snapshot_json");
    expect(store).toContain("source_hash");
    expect(store).toContain("UNIQUE(owner_key, idempotency_key)");
    expect(store).toContain("Render interrupted by application restart");
  });

  it("keeps prepare and render separate and invokes FFmpeg without a shell", () => {
    const route = source("app/api/story-creator/movie-editor/route.ts");
    const executor = source("lib/storyCreator/movieRenderExecutor.ts");
    expect(route).toContain('action === "prepare-export"');
    expect(route).toContain('action === "render-movie"');
    expect(executor).toContain("runCmd(resolveFfmpegPath(), args");
    expect(executor).toContain("movie.partial.mp4");
    expect(executor).toContain("fs.renameSync(partial, final)");
    expect(executor).toContain("statfsSync");
    expect(executor).toContain("MAX_CONCURRENT_MOVIE_RENDERS = 1");
    expect(executor).toContain('status === "canceled"');
    expect(executor).not.toContain("exec(");
  });

  it("integrates Movie inside Production Studio with mobile-friendly tracks", () => {
    const shell = source("app/app/components/storyCreatorV2/StoryStudioShell.tsx");
    const panel = source("app/app/components/StoryCreatorPanel.tsx");
    const ui = source("app/app/components/storyCreatorV2/StoryMovieEditor.tsx");
    expect(shell).toContain('{ id: "movie", label: "Movie" }');
    expect(panel).toContain("StoryMovieEditor");
    expect(ui).toContain("Automatic Assembly");
    expect(ui).toContain("Prepare Export");
    expect(ui).toContain("Render Movie");
    expect(ui).toContain("max-md:flex-col");
  });
});
