import fs from "node:fs";
import path from "node:path";

export type CharacterCreateRequestStatus = "submitting" | "submitted" | "failed";

export type CharacterCreateRequestRecord = {
  version: 1;
  requestId: string;
  status: CharacterCreateRequestStatus;
  createdAt: string;
  updatedAt: string;
  model: string;
  modelLabel: string;
  style: string;
  televisionAnimeStyle: string;
  threeDAnimationStyle: string;
  mode: string;
  // OTG_CHARACTER_3D_ANIMATION_STYLES_PHASE11_STORE
  seed: number;
  outputNodeId: string;
  promptId?: string;
  comfyBaseUrl?: string;
  backend?: string;
  fallbackUsed?: boolean;
  error?: string;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function storeRoot() {
  const configured = String(process.env.OTG_CHARACTER_CREATE_REQUEST_STORE || "").trim();
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), ".otg-state", "character-create-requests");
}

function recordPath(requestId: string) {
  return path.join(storeRoot(), `${requestId}.json`);
}

function writeRecord(record: CharacterCreateRequestRecord) {
  const root = storeRoot();
  fs.mkdirSync(root, { recursive: true });
  const finalPath = recordPath(record.requestId);
  const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempPath, finalPath);
  return record;
}

export function isCharacterCreateRequestId(value: unknown): value is string {
  return REQUEST_ID_PATTERN.test(String(value || "").trim());
}

export function readCharacterCreateRequest(
  requestId: string,
): CharacterCreateRequestRecord | null {
  if (!isCharacterCreateRequestId(requestId)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath(requestId), "utf8"));
    if (parsed?.version !== 1 || parsed?.requestId !== requestId) return null;
    return parsed as CharacterCreateRequestRecord;
  } catch {
    return null;
  }
}

export function claimCharacterCreateRequest(
  input: Omit<CharacterCreateRequestRecord, "version" | "status" | "createdAt" | "updatedAt">,
): { claimed: boolean; record: CharacterCreateRequestRecord } {
  const root = storeRoot();
  fs.mkdirSync(root, { recursive: true });
  const file = recordPath(input.requestId);
  const now = new Date().toISOString();
  const record: CharacterCreateRequestRecord = {
    version: 1,
    status: "submitting",
    createdAt: now,
    updatedAt: now,
    ...input,
  };

  try {
    const fd = fs.openSync(file, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(record, null, 2), "utf8");
    } finally {
      fs.closeSync(fd);
    }
    return { claimed: true, record };
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    const existing = readCharacterCreateRequest(input.requestId);
    if (!existing) throw new Error("Character create request reservation exists but cannot be read.");
    return { claimed: false, record: existing };
  }
}

export function markCharacterCreateRequestSubmitted(
  requestId: string,
  patch: Pick<
    CharacterCreateRequestRecord,
    "promptId" | "comfyBaseUrl" | "backend" | "fallbackUsed"
  >,
) {
  const current = readCharacterCreateRequest(requestId);
  if (!current) throw new Error("Character create request reservation is missing.");
  return writeRecord({
    ...current,
    ...patch,
    status: "submitted",
    error: undefined,
    updatedAt: new Date().toISOString(),
  });
}

export function markCharacterCreateRequestFailed(requestId: string, error: string) {
  const current = readCharacterCreateRequest(requestId);
  if (!current) return null;
  return writeRecord({
    ...current,
    status: "failed",
    error: String(error || "Character generation failed."),
    updatedAt: new Date().toISOString(),
  });
}
