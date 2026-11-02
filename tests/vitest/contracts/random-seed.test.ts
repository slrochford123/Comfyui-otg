import { afterEach, expect, it, vi } from "vitest";
import { newRandomSeed } from "@/lib/client/randomSeed";
afterEach(() => vi.unstubAllGlobals());
it("uses Web Crypto without requiring HTTPS randomUUID and allows seed zero", () => {
  vi.stubGlobal("crypto", { getRandomValues: (a: Uint32Array) => { a[0] = 0; return a; } });
  expect(newRandomSeed(424242)).toBe(0);
  expect(newRandomSeed(0)).toBe(1);
});
it("avoids adjacent repeats at the unsigned integer boundary", () => {
  vi.stubGlobal("crypto", { getRandomValues: (a: Uint32Array) => { a[0] = 0xffffffff; return a; } });
  expect(newRandomSeed(0xffffffff)).toBe(0);
  expect(newRandomSeed(Number.MAX_SAFE_INTEGER)).toBe(0xffffffff);
});
it("fails clearly without secure random generation", () => {
  vi.stubGlobal("crypto", {});
  expect(() => newRandomSeed(0)).toThrow("Random seed is unavailable");
});
