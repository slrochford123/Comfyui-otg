import { afterEach, expect, it, vi } from "vitest";
import { emptyProject, uid } from "../src/core/model";

afterEach(() => vi.unstubAllGlobals());
it("creates valid independent project and track identities on LAN HTTP", () => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.stubGlobal("crypto", { getRandomValues });
  const project = emptyProject();
  const ids = [project.id, ...project.tracks.map((track) => track.id), uid()];
  for (const id of ids)
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(new Set(ids).size).toBe(ids.length);
});
it("retains native UUID generation when available", () => {
  vi.stubGlobal("crypto", { randomUUID: () => "native-id" });
  expect(uid()).toBe("native-id");
});
it("explains how to recover if secure randomness is unavailable", () => {
  vi.stubGlobal("crypto", undefined);
  expect(() => uid()).toThrow("secure editor address");
});
