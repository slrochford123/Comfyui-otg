// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import H3NsfwStudio from "@/app/app/components/H3NsfwStudio";
import { DEFAULT_LAB_SETTINGS, EXPERIMENTS } from "@/lib/experiments/catalog";
import { DEFAULT_NSFW_UI, nsfwEditorKey, writeNsfwDraft } from "@/lib/client/h3NsfwDraft";
let session: any, server: ReturnType<typeof vi.fn>;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const calls = (action: string) => server.mock.calls.filter(([, o]) => o?.body && JSON.parse(o.body).action === action);
beforeEach(() => {
  vi.stubGlobal("React", React);
  let count = 0;
  vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => { bytes.fill(++count); return bytes; } });
  session = { id: "draft-id", experiment: "prism-pika", title: "Saved draft", revision: 1, archived: false, notes: "", created: "2026-11-02", updated: "2026-11-02", assets: [], settings: { ...DEFAULT_LAB_SETTINGS, mode: "text", prompt: "A paper boat.", selectedSources: [] } };
  server = vi.fn(async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    if (String(url).includes("?jobs=")) return response({ jobs: [], session });
    if (body?.action === "update") { session = { ...body, revision: session.revision + 1 }; return response({ session }); }
    if (body?.action === "create") return response({ session });
    if (body?.action === "generate") return response({ job: { id: body.requestId, state: "completed", cleanedUp: true, model: session.experiment, stage: "Unit fixture complete", created: 1 } });
    if (url === "/api/enhance-prompt") return response({ enhancedPrompt: "A red paper boat floats on a calm pond." });
    return response({ catalog: EXPERIMENTS.filter(e => e.kind === "h3-admin"), sessions: [session], capabilities: EXPERIMENTS.filter(e => e.kind === "h3-admin").map(e => ({ model: e.id, modes: ["text", "image", "reference", "edit", "edit-image"], gpu: "rtx3090", recipe: { steps: 8 } })) });
  });
  vi.stubGlobal("fetch", server);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
async function setup() { render(<H3NsfwStudio />); await screen.findByRole("textbox", { name: "Your scene" }); }
it.each(["dasiwa-v4","pinkcherry-v18"])("keeps retired %s readable, disables generation, and preserves text when choosing a replacement", async model => {
  session.experiment = model;
  await setup();
  expect(screen.queryByRole("button", { name: "DaSiWa · Hybrid v4" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "PinkCherry · v1.8 Hybrid" })).not.toBeInTheDocument();
  expect(screen.getByText(/was removed\. Choose another model/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create video" })).toBeDisabled();
  expect(screen.getByLabelText("Your scene")).toHaveValue("A paper boat.");
  fireEvent.click(screen.getByRole("button", { name: "H3 Eros Max · beta 7" }));
  expect(screen.getByLabelText("Your scene")).toHaveValue("A paper boat.");
  expect(screen.getByRole("button", { name: "Create video" })).toBeEnabled();
});
it.each(["dasiwa-v4","pinkcherry-v18"])("recovers unsaved local text for retired %s instead of silently discarding it", async model => {
  session.experiment = model;
  const saved = { experiment: session.experiment, settings: session.settings };
  writeNsfwDraft("retirement-fixture", { version: 1, sessionId: session.id, savedKey: nsfwEditorKey(saved), editor: { ...saved, settings: { ...saved.settings, prompt: "Unsaved Android draft." } }, ui: { ...DEFAULT_NSFW_UI }, pending: null, updatedAt: Date.now() });
  render(<H3NsfwStudio ownerKey="retirement-fixture" />);
  await waitFor(() => expect(screen.getByLabelText("Your scene")).toHaveValue("Unsaved Android draft."));
  expect(screen.getByRole("button", { name: "Create video" })).toBeDisabled();
});
it("clears, undoes and enhances with the existing endpoint without a plan-creation step", async () => {
  await setup(); const prompt = screen.getByRole("textbox", { name: "Your scene" });
  fireEvent.click(screen.getByRole("button", { name: "Clear text" })); expect(prompt).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Undo text" })); expect(prompt).toHaveValue("A paper boat.");
  fireEvent.click(screen.getByRole("button", { name: "Enhance", exact: true }));
  await waitFor(() => expect(prompt).toHaveValue("A red paper boat floats on a calm pond."));
  fireEvent.click(screen.getByRole("button", { name: "Undo text" })); expect(prompt).toHaveValue("A paper boat.");
  expect(screen.queryByRole("button", { name: "New generation session" })).not.toBeInTheDocument();
});
it("keeps original text on enhancement errors", async () => {
  const original = server.getMockImplementation()!;
  server.mockImplementation((url, o) => url === "/api/enhance-prompt" ? Promise.resolve(response({ error: "Provider unavailable" }, 503)) : original(url, o));
  await setup(); fireEvent.click(screen.getByRole("button", { name: "Enhance", exact: true }));
  await screen.findByText("Provider unavailable"); expect(screen.getByLabelText("Your scene")).toHaveValue("A paper boat.");
});
it("serializes autosave without replacing newer text and preserves edits when switching models", async () => {
  const original = server.getMockImplementation()!;
  let release: (() => void) | undefined;
  server.mockImplementation(async (url, o) => {
    if (o?.body && JSON.parse(o.body).action === "update" && !release) await new Promise<void>(resolve => { release = resolve; });
    return original(url, o);
  });
  await setup(); const prompt = screen.getByLabelText("Your scene");
  fireEvent.change(prompt, { target: { value: "First edit" } });
  await waitFor(() => expect(release).toBeDefined());
  fireEvent.change(prompt, { target: { value: "Newer edit" } }); release!();
  await waitFor(() => expect(session.settings.prompt).toBe("Newer edit"), { timeout: 2500 });
  expect(prompt).toHaveValue("Newer edit");
  fireEvent.click(screen.getByRole("button", { name: "H3 Eros Max · beta 7" })); expect(prompt).toHaveValue("Newer edit");
  expect(screen.getByRole("button", { name: "Native", exact: true })).toBeDisabled();
});
it("persists detached references, supports undo and never deletes source media", async () => {
  session.settings.mode = "reference"; session.settings.selectedSources = ["one", "two"];
  session.assets = ["one", "two"].map(id => ({ id, name: id + ".png", mime: "image/png", role: "source" }));
  await setup(); fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }));
  expect(screen.queryByRole("article", { name: "Reference one.png" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo removal" })); expect(screen.getByRole("article", { name: "Reference one.png" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear inputs" }));
  await waitFor(() => expect(session.settings.selectedSources).toEqual([])); expect(session.assets).toHaveLength(2);
  expect(calls("delete")).toHaveLength(0);
});
it("prevents duplicate clicks and retries lost generation responses with the same HTTP-safe UUID", async () => {
  const original = server.getMockImplementation()!; let attempts = 0; const seeds: number[] = [];
  server.mockImplementation(async (url, o) => { if (o?.body && JSON.parse(o.body).action === "generate") { seeds.push(session.settings.seed); if (attempts++ === 0) throw new TypeError("Connection lost"); } return original(url, o); });
  await setup(); const create = screen.getByRole("button", { name: "Create video" });
  fireEvent.click(create); fireEvent.click(create); await screen.findByText("Connection lost"); expect(calls("generate")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Create video" }));
  await waitFor(() => expect(calls("generate")).toHaveLength(2));
  const ids = calls("generate").map(([, o]) => JSON.parse(o.body).requestId);
  expect(ids[0]).toBe(ids[1]); expect(ids[0]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(seeds[0]).toBe(seeds[1]); expect(seeds[0]).not.toBe(424242);
});
async function create() {
  const before = calls("generate").length;
  const button = screen.getByRole("button", { name: "Create video" });
  fireEvent.click(button);
  await waitFor(() => expect(calls("generate")).toHaveLength(before + 1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Create video" })).toBeEnabled());
  return session.settings.seed;
}
it("defaults old drafts to random, changes each accepted job seed, and supports locking and unlocking", async () => {
  await setup(); const lock = screen.getByRole("checkbox", { name: "Lock seed" });
  expect(lock).not.toBeChecked();
  fireEvent.click(screen.getByText("Advanced settings & help"));
  const seed = screen.getByLabelText("Seed", { exact: true }); expect(seed).toBeDisabled();
  const first = await create(), second = await create(); expect(first).not.toBe(second);
  fireEvent.click(lock); expect(seed).toBeEnabled();
  fireEvent.change(seed, { target: { value: "0" } });
  expect(await create()).toBe(0); expect(await create()).toBe(0);
  expect(session.settings.seedLocked).toBe(true);
  fireEvent.click(lock); expect(seed).toBeDisabled();
  expect(await create()).not.toBe(0); expect(session.settings.seedLocked).toBe(false);
});
it("reloads a saved lock and seed without randomizing them", async () => {
  session.settings.seedLocked = true; session.settings.seed = 123456;
  await setup(); expect(screen.getByRole("checkbox", { name: "Lock seed" })).toBeChecked();
  expect(await create()).toBe(123456);
});
it("starts a new intent after editing an uncertain request, rather than silently reusing it", async () => {
  const original = server.getMockImplementation()!; let firstSeed = 0;
  server.mockImplementation(async (url, o) => {
    if (o?.body && JSON.parse(o.body).action === "generate" && !firstSeed) { firstSeed = session.settings.seed; throw new TypeError("Lost reply"); }
    return original(url, o);
  });
  await setup(); fireEvent.click(screen.getByRole("button", { name: "Create video" })); await screen.findByText("Lost reply");
  fireEvent.change(screen.getByLabelText("Your scene"), { target: { value: "Another paper boat." } });
  expect(await create()).not.toBe(firstSeed);
  const ids = calls("generate").map(([, o]) => JSON.parse(o.body).requestId); expect(ids[0]).not.toBe(ids[1]);
});
