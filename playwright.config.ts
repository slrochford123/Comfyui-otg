import { defineConfig } from "@playwright/test";

// The vendored editor has its own Playwright configuration and test suite.
export default defineConfig({
  testIgnore: ["**/vendor/**", "**/timeline-editor/**"],
});
