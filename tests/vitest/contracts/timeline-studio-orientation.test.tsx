// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import StudioOrientationButton from "@/app/app/components/StudioOrientationButton";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(orientation: object) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("screen", { orientation });
  const element = document.createElement("main");
  const requestFullscreen = vi.fn(async () => {});
  Object.assign(element, { requestFullscreen });
  render(<StudioOrientationButton targetRef={{ current: element }} />);
  return requestFullscreen;
}
it("enters fullscreen before rotating and switches back without changing a project", async () => {
  const orientation = Object.assign(new EventTarget(), {
    type: "portrait-primary", lock: vi.fn(async (_mode: string) => {}), unlock: vi.fn(),
  });
  const fullscreen = setup(orientation);
  fireEvent.click(screen.getByRole("button", { name: "Rotate studio to landscape" }));
  await waitFor(() => expect(orientation.lock).toHaveBeenCalledWith("landscape"));
  expect(fullscreen.mock.invocationCallOrder[0]).toBeLessThan(orientation.lock.mock.invocationCallOrder[0]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Rotate studio to portrait" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Rotate studio to portrait" }));
  await waitFor(() => expect(orientation.lock).toHaveBeenLastCalledWith("portrait"));
  cleanup();
  expect(orientation.unlock).toHaveBeenCalledOnce();
});
it("keeps the editor usable when orientation locking is unsupported", () => {
  const fullscreen = setup(Object.assign(new EventTarget(), { type: "portrait-primary" }));
  fireEvent.click(screen.getByRole("button", { name: "Rotate studio to landscape" }));
  expect(screen.getByRole("status")).toHaveTextContent("Enable auto-rotate");
  expect(fullscreen).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Rotate studio to landscape" })).toBeEnabled();
});
it("recovers when the browser rejects a rotation request", async () => {
  const orientation = Object.assign(new EventTarget(), {
    type: "portrait-primary", lock: vi.fn().mockRejectedValue(new Error("NotSupportedError")), unlock: vi.fn(),
  });
  setup(orientation);
  fireEvent.click(screen.getByRole("button", { name: "Rotate studio to landscape" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("could not rotate"));
  expect(screen.getByRole("button", { name: "Rotate studio to landscape" })).toBeEnabled();
  expect(orientation.unlock).not.toHaveBeenCalled();
});
