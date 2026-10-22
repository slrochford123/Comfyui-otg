import { fileURLToPath, URL } from "node:url";
import { randomBytes } from "node:crypto";
import { configDefaults, defineConfig } from "vitest/config";

// Auth route imports require a signing key even when exercising denial paths.
// Tests use a disposable process-local key, never the live TEST/PROD secret.
process.env.AUTH_SECRET ||= randomBytes(48).toString("hex");

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    fileParallelism: false,
    // Integration fixtures own process.env, native SQLite connections and local
    // FFmpeg processes. Run one fork; do not compete for these shared resources.
    minWorkers: 1,
    maxWorkers: 1,
    exclude: [
      ...configDefaults.exclude,
      "**/.patch-backups/**",
    ],
  },
});
