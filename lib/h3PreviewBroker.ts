import crypto from "node:crypto";
import WebSocket from "ws";

import { H3_BACKEND_PROFILES, type ProductionV2H3BackendId } from "@/lib/production/h3Workflows";

type PreviewFrame = {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "video/webm" | "video/mp4";
  version: number;
  promptId: string;
  receivedAt: string;
};

type PreviewEvent =
  | { type: "preview"; version: number; receivedAt: string; contentType: PreviewFrame["contentType"] }
  | { type: "progress"; value: number; max: number; node: string | null }
  | { type: "connection"; state: "connected" | "closed" | "unavailable" };

type PreviewSession = {
  jobId: string;
  ownerKey: string;
  backend: ProductionV2H3BackendId;
  clientId: string;
  promptId: string | null;
  socket: WebSocket | null;
  frame: PreviewFrame | null;
  listeners: Set<(event: PreviewEvent) => void>;
  closeTimer: ReturnType<typeof setTimeout> | null;
};

const GLOBAL_KEY = "__otgH3PreviewBroker";
const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, PreviewSession>;
};

function sessions() {
  globalState[GLOBAL_KEY] ||= new Map<string, PreviewSession>();
  return globalState[GLOBAL_KEY];
}

export function h3LivePreviewEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.H3_LIVE_PREVIEW_ENABLED || ""));
}

function emit(session: PreviewSession, event: PreviewEvent) {
  session.listeners.forEach((listener) => listener(event));
}

function contentTypeFromMetadata(value: unknown, bytes: Buffer): PreviewFrame["contentType"] {
  const text = String(value || "").toLowerCase();
  if (text.includes("webp")) return "image/webp";
  if (text.includes("png")) return "image/png";
  if (text.includes("webm")) return "video/webm";
  if (text.includes("mp4")) return "video/mp4";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  return "image/jpeg";
}

export function decodeH3PreviewWithMetadata(data: Buffer) {
  if (data.length < 8 || data.readUInt32BE(0) !== 4) return null;
  const metadataLength = data.readUInt32BE(4);
  if (metadataLength < 2 || data.length < 8 + metadataLength) return null;
  try {
    const metadata = JSON.parse(data.subarray(8, 8 + metadataLength).toString("utf8")) as Record<string, unknown>;
    const bytes = data.subarray(8 + metadataLength);
    const promptId = String(metadata.prompt_id || "").trim();
    const contentType = contentTypeFromMetadata(metadata.image_type || metadata.content_type || metadata.type, bytes);
    return promptId && bytes.length ? { promptId, contentType, bytes } : null;
  } catch {
    return null;
  }
}

export function decodeH3PreviewWithoutMetadata(data: Buffer, promptId: string) {
  if (data.length < 9 || data.readUInt32BE(0) !== 1) return null;
  const imageType = data.readUInt32BE(4);
  const bytes = data.subarray(8);
  if (!promptId || !bytes.length) return null;
  return {
    promptId,
    contentType:
      imageType === 2
        ? "image/png"
        : contentTypeFromMetadata(null, bytes),
    bytes,
  };
}

export function decodeKJPreviewOverrideEvent(data: Record<string, unknown>, fallbackPromptId: string | null) {
  const promptId = String(data.prompt_id || fallbackPromptId || "").trim();
  const rawImage = String(data.image || "").trim();
  if (!promptId || !rawImage) return null;
  const base64 = rawImage.includes(",") ? rawImage.slice(rawImage.indexOf(",") + 1) : rawImage;
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) return null;
  return {
    promptId,
    contentType: contentTypeFromMetadata(data.mime || data.content_type || data.type, bytes),
    bytes,
    progress: {
      value: Number(data.step || 0),
      max: Number(data.total || 0),
      node: data.node_id == null ? null : String(data.node_id),
    },
  };
}

export function shouldPublishKJPreviewFrame(parsed: ReturnType<typeof decodeKJPreviewOverrideEvent>) {
  if (!parsed) return false;
  const expectsAnimatedPreview = parsed.progress.max > 1;
  const isInitialStillFrame = parsed.progress.value === 0 && parsed.contentType === "image/jpeg";
  return !(expectsAnimatedPreview && isInitialStillFrame);
}

function acceptPreviewFrame(
  session: PreviewSession,
  parsed: { promptId: string; contentType: PreviewFrame["contentType"]; bytes: Buffer },
) {
  if (!session.promptId || parsed.promptId !== session.promptId) return;
  const version = (session.frame?.version || 0) + 1;
  session.frame = {
    ...parsed,
    version,
    receivedAt: new Date().toISOString(),
  };
  emit(session, {
    type: "preview",
    version,
    receivedAt: session.frame.receivedAt,
    contentType: session.frame.contentType,
  });
}

function handleJson(session: PreviewSession, text: string) {
  try {
    const message = JSON.parse(text) as { type?: string; data?: Record<string, unknown> };
    const data = message.data || {};
    const messagePromptId = String(data.prompt_id || "").trim();
    if (messagePromptId && session.promptId && messagePromptId !== session.promptId) return;
    if (message.type === "kj_preview_override") {
      const parsed = decodeKJPreviewOverrideEvent(data, session.promptId);
      if (!parsed || !session.promptId || parsed.promptId !== session.promptId) return;
      if (shouldPublishKJPreviewFrame(parsed)) acceptPreviewFrame(session, parsed);
      emit(session, {
        type: "progress",
        value: parsed.progress.value,
        max: parsed.progress.max,
        node: parsed.progress.node,
      });
    } else if (message.type === "progress") {
      emit(session, {
        type: "progress",
        value: Number(data.value || 0),
        max: Number(data.max || 0),
        node: data.node == null ? null : String(data.node),
      });
    } else if (message.type === "executing" && data.node != null) {
      emit(session, {
        type: "progress",
        value: 0,
        max: 0,
        node: String(data.node),
      });
    }
  } catch {
    // Non-JSON messages are ignored; binary previews are handled separately.
  }
}

export async function prepareH3PreviewSession(input: {
  jobId: string;
  ownerKey: string;
  backend: ProductionV2H3BackendId;
}) {
  if (!h3LivePreviewEnabled()) return null;
  const existing = sessions().get(input.jobId);
  if (existing) return { clientId: existing.clientId };
  const clientId = `otg-h3-preview-${crypto.randomUUID()}`;
  const session: PreviewSession = {
    ...input,
    clientId,
    promptId: null,
    socket: null,
    frame: null,
    listeners: new Set(),
    closeTimer: null,
  };
  sessions().set(input.jobId, session);
  const url = new URL(H3_BACKEND_PROFILES[input.backend].baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("clientId", clientId);

  await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url.toString(), { handshakeTimeout: 8_000, maxPayload: 32 * 1024 * 1024 });
    session.socket = socket;
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("ComfyUI preview WebSocket timed out."));
    }, 8_000);
    socket.once("open", () => {
      clearTimeout(timeout);
      socket.send(JSON.stringify({ type: "feature_flags", data: { supports_preview_metadata: true } }));
      emit(session, { type: "connection", state: "connected" });
      resolve();
    });
    socket.once("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("message", (value: unknown, isBinary: boolean) => {
      if (!isBinary) return handleJson(session, Buffer.isBuffer(value) ? value.toString() : String(value));
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value as ArrayBuffer);
      const parsed =
        decodeH3PreviewWithMetadata(bytes)
        || decodeH3PreviewWithoutMetadata(bytes, session.promptId || "");
      if (!parsed) return;
      acceptPreviewFrame(session, parsed);
    });
    socket.on("close", () => emit(session, { type: "connection", state: "closed" }));
  }).catch((error) => {
    sessions().delete(input.jobId);
    throw error;
  });
  return { clientId };
}

export function bindH3PreviewPrompt(jobId: string, promptId: string) {
  const session = sessions().get(jobId);
  if (session) session.promptId = String(promptId || "").trim() || null;
}

export function getH3PreviewFrame(jobId: string, ownerKey: string) {
  const session = sessions().get(jobId);
  return session?.ownerKey === ownerKey ? session.frame : null;
}

export function subscribeH3Preview(
  jobId: string,
  ownerKey: string,
  listener: (event: PreviewEvent) => void,
) {
  const session = sessions().get(jobId);
  if (!session || session.ownerKey !== ownerKey) return null;
  session.listeners.add(listener);
  if (session.frame) {
    listener({
      type: "preview",
      version: session.frame.version,
      receivedAt: session.frame.receivedAt,
      contentType: session.frame.contentType,
    });
  }
  return () => session.listeners.delete(listener);
}

export function closeH3PreviewSession(jobId: string, delayMs = 60_000) {
  const session = sessions().get(jobId);
  if (!session || session.closeTimer) return;
  session.closeTimer = setTimeout(() => {
    session.socket?.close();
    sessions().delete(jobId);
  }, delayMs);
  session.closeTimer.unref?.();
}

export function resetH3PreviewBrokerForTests() {
  sessions().forEach((session) => session.socket?.terminate());
  sessions().clear();
}

export function seedH3PreviewFrameForTests(input: {
  jobId: string;
  ownerKey: string;
  backend: ProductionV2H3BackendId;
  promptId: string;
  bytes?: Buffer;
  contentType?: PreviewFrame["contentType"];
}) {
  sessions().set(input.jobId, {
    jobId: input.jobId,
    ownerKey: input.ownerKey,
    backend: input.backend,
    clientId: `test-${input.jobId}`,
    promptId: input.promptId,
    socket: null,
    listeners: new Set(),
    closeTimer: null,
    frame: {
      bytes: input.bytes || Buffer.from("preview"),
      contentType: input.contentType || "image/jpeg",
      version: 1,
      promptId: input.promptId,
      receivedAt: new Date(0).toISOString(),
    },
  });
}
