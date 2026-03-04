"use client";

// Ensure browser-safe polyfills (e.g. crypto.randomUUID) are installed.
// Root layouts are server components and do not automatically ship their imports
// to the client bundle, so we mount this tiny client component instead.

import "./polyfills";

export default function ClientPolyfills() {
  return null;
}
