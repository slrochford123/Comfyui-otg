/** A new ComfyUI-compatible seed, including on Android over LAN HTTP. */
export function newRandomSeed(previous: number): number {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Random seed is unavailable in this browser. Lock a seed or use another browser.");
  }
  const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  // Avoid an accidental immediate repeat, including when the previous seed is 0.
  return seed === previous ? (seed + 1) >>> 0 : seed;
}
