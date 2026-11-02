// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExperimentLabPanel from "@/app/app/components/ExperimentLabPanel";
import { DEFAULT_LAB_SETTINGS, EXPERIMENTS } from "@/lib/experiments/catalog";

const session = { id: "fixture-session", experiment: "prism-pika", title: "HTTP regression", revision: 1,
  archived: false, notes: "", created: 1, updated: 1, assets: [],
  settings: { ...DEFAULT_LAB_SETTINGS, mode: "text", prompt: "A paper boat on a pond." } };
let server: ReturnType<typeof vi.fn>;
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const submissions = () => server.mock.calls.filter(([, options]) => options?.body && JSON.parse(options.body).action === "generate");
beforeEach(() => {
  vi.stubGlobal("React", React); // Vitest uses classic JSX; Next uses automatic JSX.
  let counter = 0;
  // LAN HTTP keeps getRandomValues but does not expose randomUUID.
  vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => { bytes.fill(++counter); return bytes; } });
  server = vi.fn(async (url, options) => {
    if (String(url).includes("?jobs=")) return response({ jobs: [], session });
    const body = options?.body ? JSON.parse(options.body) : null;
    if (body?.action === "generate") return response({ job: { id: body.requestId, state: "queued", model: session.experiment, stage: "Private job accepted", created: 1 } });
    if (body?.action === "create") return response({ session });
    return response({ catalog: EXPERIMENTS, sessions: [], capabilities: [{ model: "prism-pika", gpu: "rtx3090", modes: ["text"] }] });
  });
  vi.stubGlobal("fetch", server);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function setup() {
  render(<ExperimentLabPanel kind="h3-admin" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "New test plan" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "New test plan" }));
  const button = await screen.findByRole("button", { name: "Generate private H3 video" });
  await waitFor(() => expect(button).not.toBeDisabled());
  return button;
}
describe("H3 Admin HTTP generation identifiers", () => {
  it("submits valid UUIDs on LAN HTTP and uses a new identity after an accepted run", async () => {
    const button = await setup();
    fireEvent.click(button);
    await screen.findByText("Private H3 job queued. You can leave this tab and return to its saved session.");
    const first = JSON.parse(submissions()[0][1].body).requestId;
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(submissions()).toHaveLength(2));
    expect(JSON.parse(submissions()[1][1].body).requestId).not.toBe(first);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("retains the same safe request identity when retrying a lost response", async () => {
    const original = server.getMockImplementation()!;
    let attempts = 0;
    server.mockImplementation(async (url, options) => {
      if (options?.body && JSON.parse(options.body).action === "generate" && attempts++ === 0) throw new TypeError("Failed to fetch");
      return original(url, options);
    });
    const button = await setup(); fireEvent.click(button);
    await screen.findByText("Failed to fetch");
    const first = JSON.parse(submissions()[0][1].body).requestId;
    fireEvent.click(button);
    await screen.findByText("Private H3 job queued. You can leave this tab and return to its saved session.");
    expect(JSON.parse(submissions()[1][1].body).requestId).toBe(first);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("does not submit if the browser has no cryptographically secure randomness", async () => {
    vi.stubGlobal("crypto", {});
    const button = await setup(); fireEvent.click(button);
    await screen.findByText(/cannot create a safe request identity/);
    expect(submissions()).toHaveLength(0);
  });
});
