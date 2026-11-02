// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import OpenAIConnectionPanel from "@/app/app/components/OpenAIConnectionPanel";

let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  // Next uses the automatic JSX runtime; this Vitest project uses classic JSX.
  vi.stubGlobal("React", React);
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<OpenAIConnectionPanel />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("checks on explicit click, displays real authentication wording and never pretends to show balance", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, connection: {
    configured: true, enabled: true, officialBillingConfigured: false, creditsNotice: "Balance must be checked in the official portal.",
    probe: { checkedAt: "2026-11-01T20:00:00Z", authentication: "verified", modelAccess: { "configured-model": true }, message: "API authentication verified; credits not verified." },
    routes: [{ feature: "Story Creator", provider: "OpenAI", model: "configured-model" }],
  } }) });
  vi.stubGlobal("fetch", fetcher); expect(fetcher).not.toHaveBeenCalled();
  await act(async () => { host.querySelector("button")!.click(); });
  expect(fetcher).toHaveBeenCalledWith("/api/openai-ai/status", expect.objectContaining({ method: "POST", credentials: "include" }));
  expect(host.textContent).toContain("API authentication verified; credits not verified.");
  expect(host.textContent).toContain("configured-model: model access verified");
  expect(host.textContent).toContain("does not prevent AI assistance");
  expect(host.textContent).not.toContain("$100");
});

it("reports expired authentication and permits an explicit retry without losing controls", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: "Sign in to check OpenAI." }) }));
  await act(async () => { host.querySelector("button")!.click(); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Sign in");
  expect(host.querySelector("button")!.disabled).toBe(false);
});
