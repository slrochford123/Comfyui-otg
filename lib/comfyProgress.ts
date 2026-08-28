import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

type ComfyPromptStatus = "queued" | "running" | "complete" | "error";

export type ComfyPromptProgressSnapshot = {
  promptId: string;
  ownerKey: string | null;
  deviceId: string | null;
  clientId: string | null;
  comfyBaseUrl: string | null;
  status: ComfyPromptStatus;
  percent: number;
  doneNodes: number;
  cachedNodes: number;
  totalNodes: number | null;
  currentNodeId: string | null;
  currentNodeProgress: { value: number; max: number } | null;
  startedAt: number | null;
  lastUpdateAt: number | null;
  completedAt: number | null;
  elapsedMs: number | null;
  estimatedRemainingMs: number | null;
  error: string | null;
};

type ComfyPromptProgressRecord = {
  promptId: string;
  ownerKey: string | null;
  deviceId: string | null;
  clientId: string | null;
  comfyBaseUrl: string | null;
  status: ComfyPromptStatus;
  totalNodes: number | null;
  doneNodes: Set<string>;
  cachedNodes: Set<string>;
  currentNodeId: string | null;
  currentNodeValue: number | null;
  currentNodeMax: number | null;
  startedAt: number | null;
  lastUpdateAt: number | null;
  completedAt: number | null;
  error: string | null;
};

type ComfyProgressGlobal = typeof globalThis & {
  __otgComfyProgressStore?: {
    prompts: Map<string, ComfyPromptProgressRecord>;
    clientMonitors: Map<string, { ws: any; openedAt: number; closeTimer: ReturnType<typeof setTimeout> | null; openPromise: Promise<boolean> }>;
  };
};

const g = globalThis as ComfyProgressGlobal;

function store() {
  if (!g.__otgComfyProgressStore) {
    g.__otgComfyProgressStore = {
      prompts: new Map(),
      clientMonitors: new Map(),
    };
  }
  return g.__otgComfyProgressStore;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeBaseUrl(baseUrl: string | null | undefined) {
  const value = String(baseUrl || "").trim();
  return value ? value.replace(/\/+$/, "") : null;
}

function toWsBase(baseUrl: string) {
  return baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:").replace(/\/+$/, "");
}

function getOrCreateRecord(promptId: string): ComfyPromptProgressRecord {
  const key = String(promptId || "").trim();
  const progressStore = store();
  const existing = progressStore.prompts.get(key);
  if (existing) return existing;

  const now = Date.now();
  const created: ComfyPromptProgressRecord = {
    promptId: key,
    ownerKey: null,
    deviceId: null,
    clientId: null,
    comfyBaseUrl: null,
    status: "queued",
    totalNodes: null,
    doneNodes: new Set(),
    cachedNodes: new Set(),
    currentNodeId: null,
    currentNodeValue: null,
    currentNodeMax: null,
    startedAt: now,
    lastUpdateAt: now,
    completedAt: null,
    error: null,
  };
  progressStore.prompts.set(key, created);
  return created;
}

function currentNodeFraction(record: ComfyPromptProgressRecord) {
  const max = Number(record.currentNodeMax);
  const value = Number(record.currentNodeValue);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value / max));
}

function computePercent(record: ComfyPromptProgressRecord) {
  if (record.status === "complete") return 100;

  const totalNodes = Number(record.totalNodes);
  const doneCount = record.doneNodes.size;
  const currentFraction = record.currentNodeId && !record.doneNodes.has(record.currentNodeId)
    ? currentNodeFraction(record)
    : 0;

  if (Number.isFinite(totalNodes) && totalNodes > 0) {
    return clampPercent(((doneCount + currentFraction) / totalNodes) * 100);
  }

  const max = Number(record.currentNodeMax);
  const value = Number(record.currentNodeValue);
  if (Number.isFinite(max) && max > 0 && Number.isFinite(value)) {
    return clampPercent((value / max) * 100);
  }

  if (record.status === "running") return 1;
  return 0;
}

export function readComfyPromptProgress(promptId: string | null | undefined): ComfyPromptProgressSnapshot | null {
  const key = String(promptId || "").trim();
  if (!key) return null;
  const record = store().prompts.get(key);
  if (!record) return null;

  const now = Date.now();
  const percent = computePercent(record);
  const elapsedMs = record.startedAt
    ? Math.max(0, (record.completedAt || now) - record.startedAt)
    : null;
  const estimatedRemainingMs =
    record.status === "running" && elapsedMs !== null && percent > 0 && percent < 100
      ? Math.max(0, Math.round((elapsedMs * (100 - percent)) / percent))
      : null;

  return {
    promptId: record.promptId,
    ownerKey: record.ownerKey,
    deviceId: record.deviceId,
    clientId: record.clientId,
    comfyBaseUrl: record.comfyBaseUrl,
    status: record.status,
    percent,
    doneNodes: record.doneNodes.size,
    cachedNodes: record.cachedNodes.size,
    totalNodes: record.totalNodes,
    currentNodeId: record.currentNodeId,
    currentNodeProgress:
      record.currentNodeValue !== null && record.currentNodeMax !== null
        ? { value: record.currentNodeValue, max: record.currentNodeMax }
        : null,
    startedAt: record.startedAt,
    lastUpdateAt: record.lastUpdateAt,
    completedAt: record.completedAt,
    elapsedMs,
    estimatedRemainingMs,
    error: record.error,
  };
}

export function recordComfyPromptSubmitted(args: {
  promptId: string;
  ownerKey: string;
  deviceId: string;
  clientId: string;
  comfyBaseUrl: string;
  totalNodes?: number | null;
  startedAt?: number;
}) {
  const promptId = String(args.promptId || "").trim();
  if (!promptId) return null;

  const record = getOrCreateRecord(promptId);
  const now = Date.now();
  record.ownerKey = args.ownerKey || record.ownerKey;
  record.deviceId = args.deviceId || record.deviceId;
  record.clientId = args.clientId || record.clientId;
  record.comfyBaseUrl = normalizeBaseUrl(args.comfyBaseUrl) || record.comfyBaseUrl;
  record.totalNodes = Number.isFinite(Number(args.totalNodes)) && Number(args.totalNodes) > 0
    ? Math.floor(Number(args.totalNodes))
    : record.totalNodes;
  record.startedAt = args.startedAt || record.startedAt || now;
  record.lastUpdateAt = now;
  if (record.status !== "running" && record.status !== "complete" && record.status !== "error") {
    record.status = "queued";
  }
  return readComfyPromptProgress(promptId);
}

function markDone(record: ComfyPromptProgressRecord, nodeId: unknown) {
  const id = String(nodeId || "").trim();
  if (!id) return;
  record.doneNodes.add(id);
  if (record.currentNodeId === id) {
    record.currentNodeValue = record.currentNodeMax || 1;
  }
}

function applyComfyEvent(payload: any) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;

  const type = String(payload.type || "");
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  const promptId = String(data?.prompt_id || data?.promptId || "").trim();
  if (!promptId) return;

  const record = getOrCreateRecord(promptId);
  const now = Date.now();
  record.lastUpdateAt = now;

  if (type === "execution_start") {
    record.status = "running";
    record.startedAt = record.startedAt || now;
    record.error = null;
    return;
  }

  if (type === "execution_cached") {
    const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    for (const node of nodes) {
      const id = String(node || "").trim();
      if (!id) continue;
      record.cachedNodes.add(id);
      record.doneNodes.add(id);
    }
    record.status = record.status === "complete" ? "complete" : "running";
    return;
  }

  if (type === "executing") {
    if (data?.node === null) {
      record.status = "complete";
      record.completedAt = now;
      record.currentNodeId = null;
      record.currentNodeValue = null;
      record.currentNodeMax = null;
      return;
    }

    const nodeId = String(data?.node || data?.display_node || "").trim();
    if (nodeId) {
      record.status = "running";
      record.currentNodeId = nodeId;
      record.currentNodeValue = 0;
      record.currentNodeMax = 1;
    }
    return;
  }

  if (type === "progress_state") {
    const nodes = data?.nodes && typeof data.nodes === "object" ? data.nodes : {};
    let runningNodeId: string | null = null;
    let runningValue: number | null = null;
    let runningMax: number | null = null;

    for (const [nodeId, nodeState] of Object.entries(nodes) as Array<[string, any]>) {
      const state = String(nodeState?.state || "").toLowerCase();
      const value = Number(nodeState?.value);
      const max = Number(nodeState?.max);

      if (state === "finished") {
        record.doneNodes.add(nodeId);
        continue;
      }

      if (state === "running") {
        runningNodeId = String(nodeState?.node_id || nodeId);
        runningValue = Number.isFinite(value) ? value : 0;
        runningMax = Number.isFinite(max) && max > 0 ? max : 1;
      }
    }

    if (runningNodeId) {
      record.status = "running";
      record.currentNodeId = runningNodeId;
      record.currentNodeValue = runningValue;
      record.currentNodeMax = runningMax;
    }
    return;
  }

  if (type === "progress") {
    const value = Number(data?.value);
    const max = Number(data?.max);
    if (Number.isFinite(value) && Number.isFinite(max) && max > 0) {
      record.status = "running";
      record.currentNodeValue = value;
      record.currentNodeMax = max;
      if (data?.node) record.currentNodeId = String(data.node);
    }
    return;
  }

  if (type === "executed") {
    markDone(record, data?.node || data?.display_node);
    record.status = record.status === "complete" ? "complete" : "running";
    return;
  }

  if (type === "execution_success") {
    record.status = "complete";
    record.completedAt = now;
    if (record.totalNodes && record.totalNodes > 0) {
      record.doneNodes.add("__complete__");
    }
    return;
  }

  if (type === "execution_error" || type === "execution_interrupted") {
    record.status = "error";
    record.completedAt = now;
    record.error = String(data?.exception_message || data?.message || type);
  }
}

function parseMessageData(data: unknown) {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    data = data.toString("utf8");
  } else if (data instanceof ArrayBuffer) {
    data = Buffer.from(data).toString("utf8");
  }
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (data && typeof data === "object") return data;
  return null;
}

export function ensureComfyClientProgressMonitor(args: {
  comfyBaseUrl: string;
  clientId: string;
  idleTimeoutMs?: number;
}) {
  const baseUrl = normalizeBaseUrl(args.comfyBaseUrl);
  const clientId = String(args.clientId || "").trim();
  const WebSocketCtor = (globalThis as any).WebSocket || nodeRequire("ws");
  if (!baseUrl || !clientId || !WebSocketCtor) return false;

  const progressStore = store();
  const key = `${baseUrl}|${clientId}`;
  const existing = progressStore.clientMonitors.get(key);
  const openState = Number(WebSocketCtor.OPEN ?? 1);
  if (existing && existing.ws.readyState === openState) return true;
  if (existing) {
    try {
      existing.ws.close();
    } catch {}
    if (existing.closeTimer) clearTimeout(existing.closeTimer);
    progressStore.clientMonitors.delete(key);
  }

  const ws = new WebSocketCtor(`${toWsBase(baseUrl)}/ws?clientId=${encodeURIComponent(clientId)}`);
  let resolveOpen: (value: boolean) => void = () => {};
  const openPromise = new Promise<boolean>((resolve) => {
    resolveOpen = resolve;
  });
  const monitor = {
    ws,
    openedAt: Date.now(),
    closeTimer: null as ReturnType<typeof setTimeout> | null,
    openPromise,
  };
  progressStore.clientMonitors.set(key, monitor);

  const idleTimeoutMs = Math.max(30_000, Math.min(6 * 60 * 60_000, Number(args.idleTimeoutMs || 90 * 60_000)));
  monitor.closeTimer = setTimeout(() => {
    try {
      ws.close();
    } catch {}
    progressStore.clientMonitors.delete(key);
  }, idleTimeoutMs);

  const handleMessage = (data: unknown) => {
    const payload = parseMessageData(data);
    if (payload) applyComfyEvent(payload);
  };
  const handleOpen = () => resolveOpen(true);
  const handleError = () => {
    resolveOpen(false);
    progressStore.clientMonitors.delete(key);
    if (monitor.closeTimer) clearTimeout(monitor.closeTimer);
  };
  const handleClose = () => {
    resolveOpen(false);
    progressStore.clientMonitors.delete(key);
    if (monitor.closeTimer) clearTimeout(monitor.closeTimer);
  };

  ws.onmessage = (event: any) => {
    const payload = parseMessageData(event?.data);
    if (payload) applyComfyEvent(payload);
  };

  ws.onopen = handleOpen;

  ws.onerror = handleError;

  ws.onclose = handleClose;

  if (typeof ws.on === "function") {
    ws.on("message", handleMessage);
    ws.on("open", handleOpen);
    ws.on("error", handleError);
    ws.on("close", handleClose);
  }

  return true;
}

export async function waitForComfyClientProgressMonitor(args: {
  comfyBaseUrl: string;
  clientId: string;
  timeoutMs?: number;
}) {
  const baseUrl = normalizeBaseUrl(args.comfyBaseUrl);
  const clientId = String(args.clientId || "").trim();
  if (!baseUrl || !clientId) return false;

  ensureComfyClientProgressMonitor({ comfyBaseUrl: baseUrl, clientId });
  const monitor = store().clientMonitors.get(`${baseUrl}|${clientId}`);
  if (!monitor) return false;
  const openState = Number(((globalThis as any).WebSocket || nodeRequire("ws"))?.OPEN ?? 1);
  if (monitor.ws.readyState === openState) return true;

  const timeoutMs = Math.max(100, Math.min(5000, Number(args.timeoutMs || 1500)));
  return await Promise.race([
    monitor.openPromise,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}
