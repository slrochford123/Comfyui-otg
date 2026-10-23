// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import H3StudioControls from "@/app/app/components/H3StudioControls";
let server: ReturnType<typeof vi.fn>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const job = { id: "auto-job", status: "queued", statusMessage: "Generating video" };
const calls = () => server.mock.calls.filter(([url]) => url === "/api/h3/studio/auto");
beforeEach(() => {
  localStorage.clear();
  server = vi.fn(async (url, init) => {
    if (url === "/api/h3/studio/auto") {
      const body = JSON.parse(init.body);
      return json({ job, plan: body.plan, settings: { manifest: { steps: 8 }, estimate: { explanation: "Owner experimental" } } }, 202);
    }
    return json({ ok: true, catalog: [] });
  }); vi.stubGlobal("fetch", server);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup() { render(<H3StudioControls ownerKey="qa" />); fireEvent.change(screen.getByLabelText("Video description"), { target: { value: "A red kite" } }); }
describe("Auto creates from one explicit click, without a review checkpoint", () => {
  it("labels retry as a real new generation and gives it a new identity", async () => {
    server.mockImplementation(async (url, init) => url === "/api/h3/studio/auto" ? json({ job: { ...job, status: "completed", statusMessage: "Video complete" }, plan: JSON.parse(init.body).plan }) : json({ catalog: [] }));
    setup(); fireEvent.click(screen.getByRole("button", { name: "Create Video" })); await screen.findByText("Video complete");
    const first = JSON.parse(calls()[0][1].body).requestId;
    fireEvent.click(screen.getByRole("button", { name: "Retry Video" }));
    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(JSON.parse(calls()[1][1].body).requestId).not.toBe(first);
    expect(screen.queryByLabelText(/I approve one generation/)).not.toBeInTheDocument();
  });
  it("sends exactly one fixed-standard request and immediately shows generation", async () => {
    setup(); fireEvent.click(screen.getByRole("button", { name: "Create Video" }));
    await screen.findByText("Generating video"); expect(calls()).toHaveLength(1);
    expect(JSON.parse(calls()[0][1].body).plan).toMatchObject({ attention: "project-sla", profile: "fl2va-8step", steps: 8 });
    expect(screen.queryByLabelText(/I approve one generation/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate reviewed video" })).not.toBeInTheDocument();
    expect(server.mock.calls.some(([url, init]) => url === "/api/h3/studio" && init?.method === "POST")).toBe(false);
    expect(screen.getByRole("button", { name: "Safe Cancel" })).toBeVisible();
    expect(screen.getByText("Video settings")).toBeVisible();
  });
  it("protects double clicks and reuses the same identity after an uncertain response", async () => {
    let resolve!: (value: Response) => void;
    const original = server.getMockImplementation()!;
    server.mockImplementation((url, init) => url === "/api/h3/studio/auto" ? new Promise<Response>(done => { resolve = done; }) : original(url, init));
    setup(); const button = screen.getByRole("button", { name: "Create Video" }); fireEvent.click(button); fireEvent.click(button);
    expect(calls()).toHaveLength(1); const first = JSON.parse(calls()[0][1].body).requestId;
    await act(async () => resolve(json({ error: "Submission status unknown" }, 503)));
    fireEvent.click(screen.getByRole("button", { name: "Create Video" }));
    expect(calls()).toHaveLength(2); expect(JSON.parse(calls()[1][1].body).requestId).toBe(first);
    await act(async () => resolve(json({ job })));
  });
  it("does not silently submit on load, switching modes, or paid planner access", async () => {
    setup(); fireEvent.click(screen.getByRole("button", { name: "Manual Mode" })); fireEvent.click(screen.getByRole("button", { name: "Auto Mode" }));
    await waitFor(() => expect(server).toHaveBeenCalled()); expect(calls()).toHaveLength(0);
    expect(screen.queryByLabelText(/I approve one generation/)).not.toBeInTheDocument();
  });
  it("shows a blocked preparation without inventing a job or offering review/acceptance", async () => {
    server.mockImplementation(async url => url === "/api/h3/studio/auto" ? json({ error: "Installed adapter missing" }, 400) : json({ catalog: [] }));
    setup(); fireEvent.click(screen.getByRole("button", { name: "Create Video" })); await screen.findByText("Installed adapter missing");
    expect(screen.queryByRole("region", { name: "H3 Studio job" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Reviewed video plan")).not.toBeInTheDocument();
  });
});
