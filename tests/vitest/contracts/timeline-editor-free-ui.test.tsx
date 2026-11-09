// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/app/app/components/StudioOrientationButton", () => ({ default: () => null }));
import TimelineEditorEvaluation from "@/app/app/components/TimelineEditorEvaluation";
import SpinDialNav from "@/app/app/components/SpinDialNav";
const testEditorUrl = "https://shawn-1.tail2c7e2e.ts.net:8443/app/final-export-studio";
const prodEditorUrl = "https://comf-otg.comfyui-otg.win/app/final-export-studio";
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
it.each([[true, testEditorUrl], [false, testEditorUrl], [false, prodEditorUrl]] as const)("opens and saves with native randomUUID available=%s at %s", async (nativeUuid, secureEditorUrl) => {
  if (!nativeUuid) {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    vi.stubGlobal("isSecureContext", false);
  }
  vi.stubGlobal("React", React);
  const id = "12345678-1234-1234-1234-123456789abc";
  const fetcher = vi.fn(async (_url, options) =>
    Response.json(
      options?.method === "POST"
        ? { ok: true, project: { id, name: "My edit", revision: 0 } }
        : { ok: true, projects: [] },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<TimelineEditorEvaluation secureEditorUrl={secureEditorUrl} />);
  fireEvent.click(await screen.findByRole("button", { name: "New project" }));
  const frame = await screen.findByTitle("Free multitrack video editor");
  expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveClass("h-dvh", "overflow-hidden");
  fireEvent.click(screen.getByRole("button", { name: "Project" }));
  const createCall = fetcher.mock.calls.find(([, options]) => options?.method === "POST");
  expect(JSON.parse(createCall![1].body).requestId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  if (!nativeUuid)
    expect(screen.getByRole("link", { name: "Open secure editor" })).toHaveAttribute("href", secureEditorUrl);
  expect(frame).toHaveAttribute(
    "src",
    `/api/timeline-editor/app/otg.html?project=${id}`,
  );
  const save = screen.getByRole("button", { name: "Save project" });
  expect(save).toBeDisabled();
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: "https://foreign.invalid",
      source: window,
      data: { channel: "otg-sequence-v1", type: "ready" },
    }),
  );
  expect(save).toBeDisabled();
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: location.origin,
      source: (frame as HTMLIFrameElement).contentWindow,
      data: { channel: "otg-sequence-v1", type: "ready" },
    }),
  );
  await waitFor(() => expect(save).toBeEnabled());
  const send = vi.spyOn((frame as HTMLIFrameElement).contentWindow!, "postMessage");
  fireEvent.click(save);
  const requestId = send.mock.calls[0][0].requestId;
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
  fireEvent(window, new MessageEvent("message", {
    origin: location.origin, source: (frame as HTMLIFrameElement).contentWindow,
    data: { channel: "otg-sequence-v1", type: "saved", clean: true, revision: 1, requests: [requestId] },
  }));
  await waitFor(() => expect(save).toBeEnabled());
  expect(screen.queryByLabelText(/license/i)).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Editor source and license" }),
  ).toHaveAttribute("href", "/api/timeline-editor/app/source.tar.gz");
  fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
  expect(screen.getByTitle("Free multitrack video editor")).toBe(frame);
  expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
});


it("opens saved projects directly into the studio and keeps it mounted during export review", async () => {
  vi.stubGlobal("React", React);
  const id = "12345678-1234-1234-1234-123456789abc";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    ok: true, projects: [{ id, name: "Saved edit", revision: 2 }],
  })));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () { this.setAttribute("open", ""); },
  });
  render(<TimelineEditorEvaluation secureEditorUrl={prodEditorUrl} />);
  await screen.findByRole("option", { name: "Saved edit" });
  fireEvent.change(screen.getByRole("combobox", { name: "Open saved project" }), { target: { value: id } });
  const frame = await screen.findByTitle("Free multitrack video editor");
  expect(screen.queryByRole("combobox", { name: "Open saved project" })).not.toBeInTheDocument();
  fireEvent(window, new MessageEvent("message", {
    origin: location.origin, source: (frame as HTMLIFrameElement).contentWindow,
    data: { channel: "otg-sequence-v1", type: "export", media: { id } },
  }));
  expect(await screen.findByRole("dialog", { name: "Review edited video" })).toBeInTheDocument();
  expect(screen.getByTitle("Free multitrack video editor")).toBe(frame);
  fireEvent.click(screen.getByRole("button", { name: "Back to studio" }));
  expect(screen.queryByRole("dialog", { name: "Review edited video" })).not.toBeInTheDocument();
  expect(screen.getByTitle("Free multitrack video editor")).toBe(frame);
});

it("saves before leaving, retains the studio on save failure, and blocks Back during export", async () => {
  vi.stubGlobal("React", React);
  const id = "12345678-1234-1234-1234-123456789abc";
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => Response.json(
    options?.method === "POST"
      ? { ok: true, project: { id, name: "My edit", revision: 0 } }
      : { ok: true, projects: [] },
  )));
  render(<TimelineEditorEvaluation secureEditorUrl={prodEditorUrl} />);
  fireEvent.click(await screen.findByRole("button", { name: "New project" }));
  const frame = await screen.findByTitle("Free multitrack video editor") as HTMLIFrameElement;
  const receive = (data: Record<string, unknown>) => fireEvent(window, new MessageEvent("message", {
    origin: location.origin, source: frame.contentWindow,
    data: { channel: "otg-sequence-v1", ...data },
  }));
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  receive({ type: "ready" });
  receive({ type: "dirty" });
  const back = screen.getByRole("button", { name: "Back to app" });
  receive({ type: "rendering", active: true });
  expect(back).toBeDisabled();
  receive({ type: "rendering", active: false });
  fireEvent.click(back);
  expect(navigation.push).not.toHaveBeenCalled();
  const first = send.mock.calls.at(-1)![0].requestId;
  receive({ type: "error", message: "Upload failed", requests: [first] });
  await waitFor(() => expect(back).toBeEnabled());
  expect(navigation.push).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Upload failed");
  expect(screen.getByTitle("Free multitrack video editor")).toBe(frame);
  fireEvent.click(back);
  const retry = send.mock.calls.at(-1)![0].requestId;
  receive({ type: "saved", clean: true, revision: 1, requests: [retry] });
  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/app"));
});


it("offers Final Export Studio without exposing experimental tabs", () => {
  vi.stubGlobal("React", React);
  const onTab = vi.fn();
  render(<SpinDialNav tab="gallery" onTab={onTab} isAdmin showExperimental={false} showFinalExportStudio />);
  fireEvent.click(screen.getByRole("button", { name: "Final Export Studio" }));
  expect(onTab).toHaveBeenCalledWith("finalexport");
  expect(screen.queryByRole("button", { name: "Testing" })).not.toBeInTheDocument();
});
