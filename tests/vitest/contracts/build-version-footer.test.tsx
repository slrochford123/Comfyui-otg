// @vitest-environment jsdom
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import BuildVersionFooter from "@/app/app/components/BuildVersionFooter";
import { BUILD_VERSION } from "@/lib/buildHistory";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Settings footer build label", () => {
  it("shows the current Build 2.01 even when release details cannot be fetched", async () => {
    const fetcher = vi.fn().mockRejectedValue(Error("offline")); vi.stubGlobal("fetch", fetcher);
    render(<BuildVersionFooter />); expect(screen.getByText(`SLR Studios · Build ${BUILD_VERSION}`)).toBeTruthy();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
  it("renders a matching release's rollback identity as wrapping text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildVersion: BUILD_VERSION, commit: "a".repeat(40), releaseName: "prod-build-2.01-aaaa", builtAt: null }) }));
    render(<BuildVersionFooter />); expect(await screen.findByText("Revision: " + "a".repeat(40))).toBeTruthy();
    expect(screen.getByText("Release: prod-build-2.01-aaaa").className).toContain("break-all");
  });
  it("does not display cached identity from a different release", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildVersion: "1", commit: "wrong" }) }); vi.stubGlobal("fetch", fetcher);
    render(<BuildVersionFooter />); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); expect(screen.queryByText("Revision: wrong")).toBeNull();
  });
  it("cancels the details fetch on unmount", () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {})); vi.stubGlobal("fetch", fetcher);
    const result = render(<BuildVersionFooter />); const signal = fetcher.mock.calls[0][1].signal; result.unmount(); expect(signal.aborted).toBe(true);
  });
  it("is inserted after the last Settings account section", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/app/AppPageClient.tsx"), "utf8");
    expect(source.indexOf("<BuildVersionFooter />")).toBeGreaterThan(source.indexOf('<Card title="Delete account">'));
  });
});
