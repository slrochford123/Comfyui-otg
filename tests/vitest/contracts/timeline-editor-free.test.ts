import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/sessionUser", async () => {
  return {
    requireSessionUser: async (request: NextRequest) => {
      const owner = request.headers.get("x-fixture-owner");
      if (!owner) {
        const { SessionInvalidError } = await import("@/lib/ownerKey");
        throw new SessionInvalidError();
      }
      return { ownerKey: owner, username: owner };
    },
  };
});
vi.mock("@/lib/gallery", async (original) => ({
  ...(await original<object>()),
  getGallerySourcesForRequest: async (request: NextRequest) => {
    const ownerKey = request.headers.get("x-fixture-owner")!;
    return {
      owner: {
        ownerKey,
        username: ownerKey,
        deviceId: "fixture",
        scope: "user",
      },
      sources: [
        {
          scope: "user",
          dir: path.join(
            process.env.OTG_DATA_ROOT!,
            "user_galleries",
            ownerKey,
          ),
          ownerKey,
          username: ownerKey,
          deviceId: "fixture",
        },
      ],
    };
  },
}));
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "free-editor-"));
  vi.resetModules();
  vi.stubEnv("OTG_DATA_ROOT", root);
  vi.stubEnv("OTG_DATA_DIR", root);
  vi.stubEnv("OTG_ENV", "test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function request(route: string, owner = "alice", body?: unknown) {
  return new NextRequest("http://localhost" + route, {
    method: body ? "POST" : "GET",
    headers: {
      host: "localhost",
      ...(owner ? { "x-fixture-owner": owner } : {}),
      ...(body
        ? { "content-type": "application/json", origin: "http://localhost" }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
it("isolates accounts and keeps creation and save retries idempotent", async () => {
  const store = await import("@/lib/timelineEditor/store");
  const id = randomUUID(),
    project = store.createEditorProject("alice", "First cut", id);
  expect(store.createEditorProject("alice", "Ignored retry title", id).id).toBe(
    project.id,
  );
  expect(() => store.editorProject("bob", project.id)).toThrow(/not found/);
  expect(store.listEditorProjects("bob")).toEqual([]);
  const state = {
    project: { name: "Renamed edit", assets: [], clips: [] },
    media: {},
  };
  const saved = store.saveEditorProject("alice", project.id, 0, state);
  expect(saved).toMatchObject({ revision: 1, name: "Renamed edit", state });
  expect(store.saveEditorProject("alice", project.id, 0, state).revision).toBe(
    1,
  );
  expect(() =>
    store.saveEditorProject("alice", project.id, 0, {
      ...state,
      project: { ...state.project, name: "Another" },
    }),
  ).toThrow(/another window/);
  expect(() => store.createEditorProject("bob", "Foreign", id)).toThrow(
    /not found/,
  );
});
it.each(["test", "prod"])("keeps authentication and origin checks in %s", async (environment) => {
  vi.stubEnv("OTG_ENV", environment);
  const route = await import("@/app/api/timeline-editor/route");
  expect((await route.GET(request("/api/timeline-editor", ""))).status).toBe(
    401,
  );
  const hostile = request("/api/timeline-editor", "alice", {
    action: "create",
  });
  hostile.headers.set("origin", "https://foreign.invalid");
  expect((await route.POST(hostile)).status).toBe(403);
  const created = await route.POST(request("/api/timeline-editor", "alice", { action: "create", name: "Approved edit" }));
  expect(created.status).toBe(200);
  const { project } = await created.json();
  expect((await route.GET(request("/api/timeline-editor?id=" + project.id, "bob"))).status).toBe(404);
  expect((await route.GET(request("/api/timeline-editor?id=" + project.id, "alice"))).status).toBe(200);
  vi.stubEnv("OTG_ENV", "unconfigured");
  expect((await route.GET(request("/api/timeline-editor"))).status).toBe(404);
});
it.each(["test", "prod"])("streams and preserves media, reopens it and publishes exports in %s", async (environment) => {
  vi.stubEnv("OTG_ENV", environment);
  const store = await import("@/lib/timelineEditor/store"),
    route = await import("@/app/api/timeline-editor/media/route");
  const project = store.createEditorProject("alice", "Clip review");
  const input = path.join(root, "source.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    input,
  ]);
  const bytes = fs.readFileSync(input),
    hash = createHash("sha256").update(bytes).digest("hex");
  const form = new FormData();
  form.set("session", project.id);
  form.set("file", new Blob([bytes], { type: "video/mp4" }), "phone.mp4");
  const response = await route.POST(
    new NextRequest("http://localhost/api/timeline-editor/media?export=1", {
      method: "POST",
      headers: {
        host: "localhost",
        "x-fixture-owner": "alice",
        origin: "http://localhost",
      },
      body: form,
    }),
  );
  expect(response.status).toBe(200);
  const { media } = await response.json();
  expect(media).toMatchObject({
    kind: "video",
    width: 320,
    height: 180,
    exported: true,
    projectId: project.id,
  });
  const ranged = request(media.url);
  ranged.headers.set("range", "bytes=0-31");
  expect((await route.GET(ranged)).status).toBe(206);
  expect((await route.GET(request(media.url, "bob"))).status).toBe(404);
  const full = await route.GET(request(media.url));
  expect(
    createHash("sha256")
      .update(Buffer.from(await full.arrayBuffer()))
      .digest("hex"),
  ).toBe(hash);
  const state = {
    project: {
      assets: [{ id: "clip" }],
      clips: [{ volume: 0.5, in: 0, duration: 1 }],
    },
    media: { clip: media.id },
  };
  expect(store.saveEditorProject("alice", project.id, 0, state).state).toEqual(
    state,
  );
  const other = store.createEditorProject("alice", "Other");
  expect(() => store.saveEditorProject("alice", other.id, 0, state)).toThrow(
    /another project/,
  );
  const publish = () =>
    route.POST(
      request("/api/timeline-editor/media", "alice", {
        action: "save-gallery",
        id: media.id,
        title: "Phone edit",
      }),
    );
  const first = await (await publish()).json(),
    again = await (await publish()).json();
  expect(first.ok).toBe(true);
  expect(first.fileName).toBe(again.fileName);
  expect(
    createHash("sha256").update(fs.readFileSync(input)).digest("hex"),
  ).toBe(hash);
});
it("rejects undecodable media without retaining the staged upload", async () => {
  const store = await import("@/lib/timelineEditor/store"),
    route = await import("@/app/api/timeline-editor/media/route");
  const project = store.createEditorProject("alice", "Bad input");
  const form = new FormData();
  form.set("session", project.id);
  form.set("file", new Blob(["invalid media"]), "bad.mp4");
  const response = await route.POST(
    new NextRequest("http://localhost/api/timeline-editor/media", {
      method: "POST",
      headers: { host: "localhost", "x-fixture-owner": "alice" },
      body: form,
    }),
  );
  expect(response.status).toBe(400);
  expect(
    fs.readdirSync(path.join(store.editorRoot("alice"), "uploads")),
  ).toEqual([]);
});
