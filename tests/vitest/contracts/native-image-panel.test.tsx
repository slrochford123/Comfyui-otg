// @vitest-environment jsdom
import React from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import NativeImagePanel from "@/app/app/components/NativeImagePanel";
vi.mock("@/app/app/components/MediaGpuControl", () => ({default: () => <div>Shared GPU controls</div>}));
const fetcher = vi.fn();
beforeEach(() => {vi.stubGlobal("fetch", fetcher); fetcher.mockReset();});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
describe("Native image UI submission", () => {
  it("works on Android LAN HTTP without crypto.randomUUID and prevents rapid duplicate submissions", async () => {
    vi.stubGlobal("crypto", {getRandomValues: (bytes: Uint8Array) => {bytes.fill(17); return bytes;}});
    fetcher.mockImplementation(async () => Response.json({error: "Controlled input validation fixture"}, {status: 400}));
    render(<NativeImagePanel h3Only />);
    fireEvent.change(screen.getByLabelText("Describe your image"), {target: {value: "A brass compass"}});
    const form = screen.getByRole("button", {name: "Create image"}).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const body = fetcher.mock.calls[0][1].body as FormData;
    expect(body.get("clientRequestId")).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.get("model")).toBe("minimax-h3-image");
    expect(body.get("width")).toBe("1024");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Controlled input"));
  });
  it("defaults Fibo edits to matching the source aspect, not forced square cropping", () => {
    render(<NativeImagePanel sourcePath="/owner/source.png" />);
    expect((screen.getByLabelText("Canvas") as HTMLSelectElement).value).toBe("source");
    expect(screen.getByRole("button", {name: "Apply edit"}).hasAttribute("disabled")).toBe(true);
  });
});
