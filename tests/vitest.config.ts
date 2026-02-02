import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Ensure JSX uses the modern automatic runtime so tests don't require `import React`.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    // Match the app/Storybook convention where "@" points at repo root.
    // This allows imports like "@/app/..." inside components under test.
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Keep tests fast + predictable in CI/Windows.
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
  },
});
