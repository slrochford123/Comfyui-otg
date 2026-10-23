// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import H3StudioControls from "@/app/app/components/H3StudioControls";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const preview = (id = "review-1", executable = true) => ({ ok: true, review: { id, mediaFingerprint: "server-media-fingerprint" }, manifest: { executable, blockedReasons: executable ? [] : ["PHYSICAL_QUALIFICATION_REQUIRED"], steps: 20, sampler: "res_multistep" }, graph: {}, estimate: { explanation: "No generation submitted", generationCredits: 2, generationSeconds: 30 } });
const mockJob = (status = "queued") => ({ id: "job-1", status, statusMessage: `Video ${status}`, progressPercent: 25, videoUrl: status === "completed" ? "/api/h3/generation/media?jobId=job-1" : null, galleryStatus: "saved", galleryUrl: "/api/gallery/file?name=result.mp4" });
const catalog = [{ id: "civitai-1-2", name: "Reference adapter", version: "v1", categories: ["motion"], category: "motion", family: "Ref2VA", strength: { min: .5, max: 1 }, blockedReasons: [], installation: "listed-by-worker", rights: "documented" }];
let server: ReturnType<typeof vi.fn>;
let assets: Map<string, Record<string, any>>;
let assetNumber: number, reviews: number;
let currentJob: ReturnType<typeof mockJob>, directorQuestion: string;
function calls(url: string, method = "POST") { return server.mock.calls.filter(([input, init]) => String(input) === url && init?.method === method); }
function body(url = "/api/h3/studio") { return JSON.parse(calls(url).at(-1)![1].body); }
function intent(value = "A red kite moves above the sea") { fireEvent.change(screen.getByLabelText("Video description"), { target: { value } }); }
function openDirector() { (screen.getByText("Optional AI Director").closest("details") as HTMLDetailsElement).open = true; }
async function upload(kind = "image", name = "source.png", bytes = "first") {
  fireEvent.change(screen.getByLabelText(`Add ${kind} references`), { target: { files: [new File([bytes], name, { type: `${kind}/${kind === "image" ? "png" : "mp4"}`, lastModified: 123 })] } });
  await screen.findByText(/Ready · version 1/);
}
async function review() { if (screen.getByRole("button", { name: "Auto Mode" }).getAttribute("aria-pressed") === "true") fireEvent.click(screen.getByRole("button", { name: "Manual Mode" })); fireEvent.click(screen.getByRole("button", { name: /Preview Video Plan|Create Video/ })); await screen.findByLabelText("Reviewed video plan"); }
async function approveAndGenerate() {
  fireEvent.click(screen.getByLabelText(/I approve one generation/)); fireEvent.click(screen.getByRole("button", { name: "Generate reviewed video" }));
  await screen.findByRole("region", { name: "H3 Studio job" });
}
beforeEach(() => {
  localStorage.clear(); assets = new Map(); assetNumber = 0; reviews = 0; currentJob = mockJob(); directorQuestion = "";
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:local-source"), revokeObjectURL: vi.fn() }));
  server = vi.fn(async (input, init) => {
    const url = String(input);
    if (url === "/api/h3/studio/media" && init?.method === "POST") {
      const form = init.body as FormData, file = form.get("file") as File;
      const asset = { id: `asset-${++assetNumber}`, kind: file.type.split("/")[0], role: form.get("role"), name: file.name, sha256: `hash-${assetNumber}`, version: 1, metadata: { durationSeconds: 30, hasAudio: true }, url: `/api/h3/studio/media?id=asset-${assetNumber}` };
      assets.set(asset.id, asset); return json({ ok: true, asset });
    }
    if (url === "/api/h3/studio/media" && init?.method === "PATCH") {
      const patch = JSON.parse(init.body), previous = assets.get(patch.id)!;
      const asset = { ...previous, ...patch, version: previous.version + 1 }; assets.set(patch.id, asset); return json({ ok: true, asset });
    }
    if (init?.method === "DELETE") return json({ ok: true });
    if (url === "/api/h3/studio" && init?.method === "POST") {
      const request = JSON.parse(init.body);
      if (request.action === "quote") return json({ ok: true, quote: { id: "quote-1", estimatedUsd: .01234 }, qualified: true });
      if (request.action === "director") return json({ ok: true, plan: { ...request.plan, prompt: "Director prompt" }, reply: { question: directorQuestion, rationale: "Director plan ready" }, requiresClarification: !!directorQuestion });
      return json(preview(`review-${++reviews}`));
    }
    if (url === "/api/h3/studio/execute") return json({ ok: true, job: currentJob }, 202);
    if (url.startsWith("/api/h3/generation?jobId=")) return json({ ok: true, job: currentJob });
    if (url === "/api/h3/generation" && init?.method === "POST") { currentJob = mockJob("canceling"); return json({ ok: true, job: currentJob }); }
    return json({ ok: true, catalog });
  }); vi.stubGlobal("fetch", server);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Phase 3 H3 frontend", () => {
  it("creates a PROD Manual video directly, with no review or acceptance checkbox", async () => {
    const original = server.getMockImplementation()!;
    server.mockImplementation((url, init) => String(url) === "/api/h3/studio" && !init?.method
      ? Promise.resolve(json({ ok: true, catalog, experimental: false, directGeneration: true })) : original(url, init));
    render(<H3StudioControls ownerKey="qa-prod" controller="manual" />);
    await screen.findByRole("button", { name: "View Plan (optional)" });
    intent(); fireEvent.click(screen.getByRole("button", { name: "Create Video" }));
    await screen.findByRole("region", { name: "H3 Studio job" });
    expect(calls("/api/h3/studio/execute")).toHaveLength(1);
    const request = body("/api/h3/studio/execute"); expect(request.reviewId).toBeUndefined(); expect(request.generationConsent).toBeUndefined();
    expect(screen.queryByLabelText(/I approve one generation/)).not.toBeInTheDocument(); expect(calls("/api/h3/studio")).toHaveLength(0);
  });
  it("shows a director capability limitation without parsing a null plan or offering generation", async () => {
    const original = server.getMockImplementation()!;
    server.mockImplementation((url, init) => {
      if (String(url) === "/api/h3/studio" && init?.method === "POST" && JSON.parse(init.body).action === "director") return Promise.resolve(json({ ok: true, plan: null, reply: { question: "", unavailable: "No qualified capability supports this effect." }, requiresClarification: true }));
      return original(url, init);
    });
    render(<H3StudioControls ownerKey="qa" />); intent(); openDirector();
    fireEvent.click(screen.getByRole("button", { name: "Estimate AI planning cost" }));
    await screen.findByLabelText(/I approve one planner/);
    fireEvent.click(screen.getByLabelText(/I approve one planner/));
    fireEvent.click(screen.getByRole("button", { name: "Ask AI Director" }));
    await screen.findByText(/No qualified capability supports this effect\./);
    expect(screen.queryByRole("button", { name: "Generate reviewed video" })).not.toBeInTheDocument();
    expect(calls("/api/h3/studio/execute")).toHaveLength(0);
  });
  it("keeps Auto simple, supports empty drafts and preserves settings across controller switches", () => {
    render(<H3StudioControls ownerKey="qa" />);
    expect(screen.queryByLabelText("Workflow")).not.toBeInTheDocument(); expect(screen.queryByLabelText("Seed")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Generation prompt")).not.toBeInTheDocument(); expect(screen.queryByText(/Inspect sanitized/)).not.toBeInTheDocument();
    expect(server).toHaveBeenCalledTimes(1); expect(calls("/api/h3/studio/execute")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Quality"), { target: { value: "1" } }); intent();
    fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    expect(screen.getByLabelText("Quality")).toHaveValue("1"); expect(screen.getByLabelText("Camera")).toHaveValue("none"); expect(screen.getByLabelText("Motion")).toHaveValue("none");
    fireEvent.click(screen.getByRole("button", { name: "Auto Mode" })); expect(screen.getByLabelText("Video description")).toHaveValue("A red kite moves above the sea");
    intent(""); expect(screen.getByRole("button", { name: /Preview Video Plan|Create Video/ })).toBeDisabled();
  });
  it("reconciles checkpoint, independent Combat, audio, LoRAs and profile-derived sampling", async () => {
    render(<H3StudioControls ownerKey="qa" />); intent(); fireEvent.click(screen.getByRole("button", { name: "Manual Mode" }));
    (screen.getByText(/Selected LoRA catalog/).closest("details") as HTMLDetailsElement).open = true;
    await screen.findByRole("button", { name: "Add Reference adapter" });
    fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "reference-edit" } });
    fireEvent.change(screen.getByLabelText("Checkpoint"), { target: { value: "singularity" } }); fireEvent.click(screen.getByLabelText("Independent Combat V2"));
    fireEvent.change(screen.getByLabelText("Acceleration"), { target: { value: "ref2va-8step" } }); fireEvent.change(screen.getByLabelText("Audio"), { target: { value: "original" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Reference adapter" }));
    expect(screen.getByLabelText("Sampler")).toHaveValue("euler"); expect(screen.getByLabelText("Steps")).toHaveValue(8); expect(screen.getByLabelText("Independent Combat V2")).toBeChecked();
    fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "native-t2v" } });
    expect(screen.getByLabelText("Checkpoint")).toHaveValue("standard"); expect(screen.getByLabelText("Acceleration")).toHaveValue("native");
    expect(screen.getByLabelText("Sampler")).toHaveValue("res_multistep"); expect(screen.getByLabelText("Steps")).toHaveValue(20); expect(screen.getByLabelText("Scheduler")).toHaveValue("simple");
    expect(screen.getByLabelText("Independent Combat V2")).not.toBeChecked(); expect(screen.getByLabelText("Audio")).toHaveValue("generated"); expect(screen.queryByRole("button", { name: "Remove LoRA 1" })).not.toBeInTheDocument();
  });
  it("invalidates reviews, quotes and consent for same-name, same-size, same-count replacements", async () => {
    render(<H3StudioControls ownerKey="qa" />); intent(); await upload(); openDirector();
    fireEvent.click(screen.getByRole("button", { name: "Estimate AI planning cost" })); await screen.findByLabelText(/I approve one planner/); fireEvent.click(screen.getByLabelText(/I approve one planner/));
    await review(); fireEvent.click(screen.getByLabelText(/I approve one generation/));
    fireEvent.change(screen.getByLabelText("Replace source.png"), { target: { files: [new File(["other"], "source.png", { type: "image/png", lastModified: 123 })] } });
    expect(screen.queryByLabelText("Reviewed video plan")).not.toBeInTheDocument(); expect(screen.queryByLabelText(/I approve one planner/)).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: /Preview Video Plan|Create Video/ })).toBeDisabled();
    await waitFor(() => expect(calls("/api/h3/studio/media")).toHaveLength(2)); await screen.findByText(/Ready · version 1/); await review();
    expect(body().mediaIds).toEqual(["asset-2"]); expect(body()).not.toHaveProperty("media"); expect(screen.getByLabelText(/I approve one generation/)).not.toBeChecked(); expect(calls("/api/h3/studio/media?id=asset-1", "DELETE")).toHaveLength(1);
  });
  it("PATCHes description, audio and clip settings without re-uploading bytes", async () => {
    render(<H3StudioControls ownerKey="qa" />); intent(); await upload("video", "source.mp4"); await review();
    fireEvent.change(screen.getByLabelText("Description for source.mp4"), { target: { value: "Walking performance" } }); expect(screen.queryByLabelText("Reviewed video plan")).not.toBeInTheDocument(); await screen.findByText(/Ready · version 2/);
    fireEvent.click(screen.getByLabelText("Include audio from source.mp4")); await screen.findByText(/Ready · version 3/);
    fireEvent.change(screen.getByLabelText("Clip start seconds for source.mp4"), { target: { value: "6.5" } }); await screen.findByText(/Ready · version 4/);
    expect(JSON.parse(calls("/api/h3/studio/media", "PATCH").at(-1)![1].body)).toEqual({ id: "asset-1", role: "reference", description: "Walking performance", includeAudio: true, clipStartSeconds: 6.5 });
    expect(screen.getByText(/Selected window: 6.50–11.50/)).toBeInTheDocument(); expect(calls("/api/h3/studio/media")).toHaveLength(1); await review(); expect(body().mediaIds).toEqual(["asset-1"]);
  });
  it("registers frame role changes before previewing", async () => {
    render(<H3StudioControls ownerKey="qa" />); intent(); await upload(); fireEvent.change(screen.getByLabelText("Role for source.png"), { target: { value: "first" } });
    await screen.findByText(/Ready · version 2/); await review(); expect(body().plan.workflowId).toBe("native-i2v"); expect(JSON.parse(calls("/api/h3/studio/media", "PATCH")[0][1].body).role).toBe("first");
  });
  it("requires a current quote and separate paid-call and media-sharing approval", async () => {
    render(<H3StudioControls ownerKey="qa" />); intent(); await upload(); openDirector();
    fireEvent.click(screen.getByRole("button", { name: "Estimate AI planning cost" })); await screen.findByLabelText(/I approve one planner/); fireEvent.click(screen.getByLabelText(/I approve one planner/)); expect(screen.getByRole("button", { name: "Ask AI Director" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Allow the AI Director/)); expect(screen.queryByLabelText(/I approve one planner/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Estimate AI planning cost" })); await screen.findByLabelText(/I approve one planner/); expect(screen.getByRole("button", { name: "Ask AI Director" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I approve one planner/)); fireEvent.click(screen.getByRole("button", { name: "Ask AI Director" })); await screen.findByText("Director plan ready");
    expect(body()).toMatchObject({ action: "director", quoteId: "quote-1", plannerConsent: true, externalMediaConsent: true, mediaIds: ["asset-1"] }); expect(calls("/api/h3/studio/execute")).toHaveLength(0);
    await review(); expect(body().plan.prompt).toBe("Director prompt");
  });
  it("requires an answer or new plan when the Director asks for clarification", async () => {
    directorQuestion = "Which person should move?"; render(<H3StudioControls ownerKey="qa" />); intent(); openDirector();
    fireEvent.click(screen.getByRole("button", { name: "Estimate AI planning cost" })); await screen.findByLabelText(/I approve one planner/); fireEvent.click(screen.getByLabelText(/I approve one planner/)); fireEvent.click(screen.getByRole("button", { name: "Ask AI Director" }));
    await screen.findByText(/Which person should move/); expect(screen.getByRole("button", { name: /Preview Video Plan|Create Video/ })).toBeDisabled(); expect(screen.queryByLabelText("Reviewed video plan")).not.toBeInTheDocument();
    intent("The person on the left walks forward"); await review(); expect(body().plan.prompt).toBe("The person on the left walks forward");
  });
  it("requires generation approval, guards submission, and waits for confirmed cancellation", async () => {
    render(<H3StudioControls ownerKey="qa" />); intent(); await upload(); await review(); expect(screen.getByRole("button", { name: "Generate reviewed video" })).toBeDisabled(); await approveAndGenerate();
    expect(calls("/api/h3/studio/execute")).toHaveLength(1); expect(body("/api/h3/studio/execute")).toMatchObject({ reviewId: "review-1", mediaIds: ["asset-1"], generationConsent: true }); expect(body("/api/h3/studio/execute").requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByLabelText("Video description")).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "Safe Cancel" })); await screen.findByRole("button", { name: "Canceling…" }); expect(body("/api/h3/generation")).toEqual({ action: "cancel", jobId: "job-1" });
  });
  it("keeps reviewed output/Gallery/history and a fresh approval on retry in Manual", async () => {
    currentJob = mockJob("completed"); render(<H3StudioControls ownerKey="qa" />); intent(); await upload(); await review(); await approveAndGenerate();
    expect(screen.getByRole("link", { name: "Download video" })).toHaveAttribute("href", "/api/h3/generation/media?jobId=job-1&download=1");
    expect(screen.getByRole("link", { name: "Open Gallery video" })).toBeInTheDocument();
    expect(screen.getByText("Recent H3 jobs (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare retry" })); await screen.findByLabelText("Reviewed video plan");
    expect(body().action).toBe("preview"); expect(calls("/api/h3/generation")).toHaveLength(0);
    expect(screen.getByLabelText(/I approve one generation/)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Generate reviewed video" })).toBeDisabled();
  });
  it("rejects unsupported and oversized files locally", () => {
    render(<H3StudioControls ownerKey="qa" />); fireEvent.change(screen.getByLabelText("Add image references"), { target: { files: [new File(["x"], "animated.gif", { type: "image/gif" })] } }); expect(screen.getByText(/Choose a supported image/)).toBeInTheDocument();
    const large = new File(["x"], "large.png", { type: "image/png" }); Object.defineProperty(large, "size", { value: 21 * 1024 ** 2 }); fireEvent.change(screen.getByLabelText("Add image references"), { target: { files: [large] } }); expect(screen.getByText(/Choose a nonempty image/)).toBeInTheDocument(); expect(calls("/api/h3/studio/media")).toHaveLength(0);
  });
  it("ignores a stale preview response after editing the description", async () => {
    const original = server.getMockImplementation()!;
    let resolve!: (response: Response) => void;
    server.mockImplementation((url, init) => String(url) === "/api/h3/studio" && init?.method === "POST" ? new Promise<Response>(done => { resolve = done; }) : original(url, init));
    render(<H3StudioControls ownerKey="qa" />); intent(); fireEvent.click(screen.getByRole("button", { name: "Manual Mode" })); fireEvent.click(screen.getByRole("button", { name: /Preview Video Plan|Create Video/ }));
    intent("A different scene"); await act(async () => resolve(json(preview())));
    expect(screen.queryByLabelText("Reviewed video plan")).not.toBeInTheDocument(); expect(screen.getByLabelText("Video description")).toHaveValue("A different scene");
  });
  it("guards duplicate clicks and reuses the submission identity after an uncertain failure", async () => {
    const original = server.getMockImplementation()!;
    let resolve!: (response: Response) => void;
    server.mockImplementation((url, init) => String(url) === "/api/h3/studio/execute" ? new Promise<Response>(done => { resolve = done; }) : original(url, init));
    render(<H3StudioControls ownerKey="qa" />); intent(); await review(); fireEvent.click(screen.getByLabelText(/I approve one generation/));
    const button = screen.getByRole("button", { name: "Generate reviewed video" });
    fireEvent.click(button); fireEvent.click(button); expect(calls("/api/h3/studio/execute")).toHaveLength(1);
    const first = body("/api/h3/studio/execute").requestId;
    await act(async () => resolve(json({ ok: false, error: "Submission status unknown" }, 503)));
    fireEvent.click(screen.getByRole("button", { name: "Generate reviewed video" })); expect(calls("/api/h3/studio/execute")).toHaveLength(2); expect(body("/api/h3/studio/execute").requestId).toBe(first);
    await act(async () => resolve(json({ ok: true, job: mockJob("completed") })));
  });
  it("polls existing job status until output becomes available", async () => {
    render(<H3StudioControls ownerKey="qa" />); intent(); await review(); await approveAndGenerate();
    currentJob = mockJob("completed");
    await screen.findByRole("link", { name: "Download video" }, { timeout: 3000 });
    expect(server.mock.calls.some(([url]) => String(url) === "/api/h3/generation?jobId=job-1")).toBe(true);
    expect(screen.queryByRole("button", { name: "Safe Cancel" })).not.toBeInTheDocument();
  });
  it("invalidates review and generation approval when native SLA changes", async () => {
    render(<H3StudioControls ownerKey="qa" />); intent(); fireEvent.click(screen.getByRole("button", { name: "Manual Mode" })); await review(); fireEvent.click(screen.getByLabelText(/I approve one generation/));
    fireEvent.click(screen.getByLabelText("Native H3 SLA")); expect(screen.queryByLabelText("Reviewed video plan")).not.toBeInTheDocument(); await review();
    expect(body().plan.attention).toBe("dense"); expect(screen.getByLabelText(/I approve one generation/)).not.toBeChecked();
  });
  it("shows missing capability reasons and prevents paid calls when none are qualified", async () => {
    const original = server.getMockImplementation()!;
    server.mockImplementation((url, init) => String(url) === "/api/h3/studio" && init?.method === "POST" ? Promise.resolve(json({ ok: true, quote: { id: "q", estimatedUsd: .01 }, qualified: false, unavailable: ["QUALIFICATION_EVIDENCE_REQUIRED"] })) : original(url, init));
    render(<H3StudioControls ownerKey="qa" />); intent(); openDirector(); fireEvent.click(screen.getByRole("button", { name: "Estimate AI planning cost" }));
    await screen.findByText("QUALIFICATION_EVIDENCE_REQUIRED"); expect(screen.getByRole("button", { name: "Ask AI Director" })).toBeDisabled(); expect(screen.getByLabelText(/I approve one planner/)).toBeDisabled();
  });
});
