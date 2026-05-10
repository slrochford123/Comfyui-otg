import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
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
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}", "tests/vitest/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "otg-clean-reapply-kit/**", "node_modules/**", ".next/**"],
    // Keep tests fast + predictable in CI/Windows.
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
  },
});
