// Server-only credential, separate from the ordinary inference API key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function openAIAdminKeyPath() {
  const root = process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT || path.join(os.homedir(), "AI/runtime/test/data");
  return path.join(root, "openai", "admin-key");
}

export function readOpenAIAdminKey(): string {
  const configured = (process.env.OPENAI_ADMIN_API_KEY || process.env.OPENAI_ADMIN_KEY || "").trim();
  if (configured) return configured;
  try {
    const file = openAIAdminKeyPath();
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 4096) return "";
    return fs.readFileSync(file, "utf8").trim();
  } catch { return ""; }
}

export function openAIAdminConfigured() { return Boolean(readOpenAIAdminKey()); }
