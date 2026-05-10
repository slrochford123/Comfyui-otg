import fs from "node:fs";
import path from "node:path";
import { OTG_DATA_ROOT, ensureDir, readJsonSafe, safeSegment, writeJsonSafe } from "@/lib/paths";

export type PromptRequestMeta = {
  promptId: string;
  ownerKey: string;
  username?: string | null;
  deviceId?: string | null;
  title?: string | null;
  workflowId?: string | null;
  workflowLabel?: string | null;
  requestKind?: string | null;
  extendRequestId?: string | null;
  sourceType?: string | null;
  extendedFromName?: string | null;
  extendSourceFrame?: string | null;
  extendMode?: string | null;
  positivePrompt?: string | null;
  negativePrompt?: string | null;
  submitPayload?: any | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

const ROOT = path.join(OTG_DATA_ROOT, "prompt_request_meta");

function safePromptId(promptId: string) {
  const raw = String(promptId || "").trim();
  return raw.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 160);
}

export function promptRequestMetaPath(ownerKey: string, promptId: string) {
  const owner = safeSegment(ownerKey || "local");
  const pid = safePromptId(promptId || "");
  if (!pid) throw new Error("Missing promptId");
  const dir = path.join(ROOT, owner);
  ensureDir(dir);
  return path.join(dir, `${pid}.json`);
}

export function readPromptRequestMeta(ownerKey: string, promptId: string): PromptRequestMeta | null {
  try {
    const filePath = promptRequestMetaPath(ownerKey, promptId);
    if (!fs.existsSync(filePath)) return null;
    return readJsonSafe<PromptRequestMeta | null>(filePath, null);
  } catch {
    return null;
  }
}

export function writePromptRequestMeta(ownerKey: string, promptId: string, patch: Partial<PromptRequestMeta>) {
  const filePath = promptRequestMetaPath(ownerKey, promptId);
  const current = readJsonSafe<PromptRequestMeta>(filePath, {
    promptId,
    ownerKey,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const next: PromptRequestMeta = {
    ...current,
    ...patch,
    promptId,
    ownerKey,
    updatedAt: Date.now(),
    createdAt: Number(current?.createdAt || Date.now()),
  };

  writeJsonSafe(filePath, next);
  return { filePath, meta: next };
}
