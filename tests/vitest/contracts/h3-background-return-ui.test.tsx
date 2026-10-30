// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import H3Panel from "@/app/app/components/H3Panel";
import {H3_RECOVERY_RESUME_EVENT} from "@/lib/client/h3Recovery";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status});
beforeEach(() => {
  localStorage.clear();
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, {createObjectURL: vi.fn(() => "blob:reference"), revokeObjectURL: vi.fn()}));
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});

describe("H3 background, completion, return and Create Video", () => {
  it.each([false, true])("reuses verified references and submits a fresh second job (lost response: %s)", async lostResponse => {
    const uploads = new Map<string, Record<string, unknown>>();
    const receipts = new Map<string, unknown>();
    let currentJob: Record<string, unknown> | null = null;
    let completed = false;
    const server = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === "/api/auth/me") return json({ok: true, user: {username: "qa"}});
      if (url.startsWith("/api/h3/submissions?")) {
        const key = new URL(url, "http://test").searchParams.get("requestId")!;
        return receipts.has(key) ? json(receipts.get(key), 202) : json({missing: true}, 404);
      }
      if (url === "/api/h3/generation/upload" && init?.method === "POST") {
        const body = init.body as FormData;
        const upload = {id: body.get("uploadId"), name: body.get("name"), kind: body.get("kind"), type: body.get("type"), size: Number(body.get("size")), complete: true};
        uploads.set(String(upload.id), upload); return json({ok: true, upload});
      }
      if (url.startsWith("/api/h3/generation/upload?id=")) return json({ok: true, upload: uploads.get(new URL(url, "http://test").searchParams.get("id")!)});
      if (url === "/api/h3/generation" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const key = new Headers(init.headers).get("x-h3-request-id")!;
        currentJob = {id: "video-" + receipts.size, status: "running", statusMessage: "Rendering café video", mode: "h3-reference-to-video", backendLabel: "RTX 3090", ...body.config};
        const result = {ok: true, job: currentJob}; receipts.set(key, result);
        if (lostResponse && receipts.size === 1) throw new TypeError("Failed to fetch");
        return json(result, 202);
      }
      if (url.startsWith("/api/h3/generation")) return json({ok: true, job: currentJob ? {...currentJob, status: completed ? "completed" : "running", statusMessage: completed ? "Café video complete" : "Rendering café video"} : null});
      return json({ok: true, entries: [], catalog: [], maxSelections: 3});
    });
    vi.stubGlobal("fetch", server);
    render(<H3Panel authenticatedOwnerKey="qa" />);
    fireEvent.click(screen.getByRole("button", {name: "Manual Mode"}));
    const legacy = within(document.querySelector('[data-otg="h3-legacy-manual-tools"]') as HTMLElement);
    fireEvent.click(legacy.getByRole("tab", {name: /Reference/}));
    fireEvent.change(legacy.getByPlaceholderText("Describe the scene, action, camera, dialogue, and sound."), {target: {value: "Two friends meet at a café."}});
    fireEvent.change(legacy.getByLabelText("+ Image"), {target: {files: [new File(["reference"], "woman.png", {type: "image/png"})]}});
    await waitFor(() => expect(legacy.getByRole("button", {name: "Generate Video"})).toBeEnabled());
    const create = legacy.getByRole("button", {name: "Generate Video"});
    fireEvent.click(create); fireEvent.click(create);
    await screen.findAllByText("Rendering café video");
    const postCalls = () => server.mock.calls.filter(([url, init]) => url === "/api/h3/generation" && init?.method === "POST");
    expect(postCalls()).toHaveLength(1);
    completed = true;
    await act(async () => {window.dispatchEvent(new Event(H3_RECOVERY_RESUME_EVENT)); await new Promise(done => setTimeout(done, 150));});
    await screen.findAllByText("Café video complete");
    expect(legacy.getByRole("button", {name: "Generate Video"})).toBeEnabled();
    fireEvent.click(legacy.getByRole("button", {name: "Generate Video"}));
    await waitFor(() => expect(postCalls()).toHaveLength(2));
    expect(server.mock.calls.filter(([url, init]) => url === "/api/h3/generation/upload" && init?.method === "POST")).toHaveLength(1);
    expect(server.mock.calls.some(([url]) => String(url).startsWith("/api/h3/generation/upload?id="))).toBe(true);
    const [first, second] = postCalls();
    expect(new Headers(first[1]?.headers).get("x-h3-request-id")).not.toBe(new Headers(second[1]?.headers).get("x-h3-request-id"));
    const original = JSON.parse(String(first[1]?.body));
    const next = JSON.parse(String(second[1]?.body));
    expect(next.staged).toEqual(original.staged);
    expect(next.config.prompt).toBe(original.config.prompt);
    expect(screen.queryByText(/files are too large/)).not.toBeInTheDocument();
  });
});
