(() => {
  // Only run in the browser/webview
  if (typeof window === "undefined") return;

  const c = globalThis.crypto as any;

  // If randomUUID exists, do nothing
  if (c && typeof c.randomUUID === "function") return;

  // Ensure crypto exists
  if (!globalThis.crypto) (globalThis as any).crypto = {};

  const getRandomValues =
    (globalThis.crypto as any).getRandomValues?.bind(globalThis.crypto);

  function fallbackUUID() {
    const bytes = new Uint8Array(16);
    if (getRandomValues) getRandomValues(bytes);
    else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
    return (
      hex.slice(0, 8) + "-" +
      hex.slice(8, 12) + "-" +
      hex.slice(12, 16) + "-" +
      hex.slice(16, 20) + "-" +
      hex.slice(20)
    );
  }

  (globalThis.crypto as any).randomUUID = fallbackUUID;
})();
