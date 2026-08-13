import {
  acquireComfy5060Lease,
  createComfyLeaseOwnerId,
  heartbeatComfy5060Lease,
  isRtx5060Comfy8188Endpoint,
  releaseComfy5060Lease,
  type Comfy5060Lease,
} from "@/lib/workers/comfy5060Lease";

const IMAGE_LEASE_TTL_SECONDS = 6 * 60 * 60;
const MONITOR_POLL_MS = 2_000;

export class Comfy5060BusyError extends Error {
  readonly code = "gpu_linux_5060ti_busy";
  readonly status = 409;

  constructor(message = "RTX 5060 Ti is busy with another exclusive GPU workload.") {
    super(message);
    this.name = "Comfy5060BusyError";
  }
}

function normalizeBaseUrl(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function promptIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  return String(record.prompt_id || record.promptId || "").trim();
}

function historyTerminal(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  const status = record.status && typeof record.status === "object" && !Array.isArray(record.status)
    ? record.status as Record<string, unknown>
    : {};
  return status.completed === true || status.status_str === "error" || !!record.outputs;
}

async function waitForPromptTerminal(baseUrl: string, promptId: string, lease: Comfy5060Lease): Promise<void> {
  let currentLease: Comfy5060Lease | null = lease;
  const deadline = Date.now() + IMAGE_LEASE_TTL_SECONDS * 1000;
  let nextHeartbeat = 0;
  while (Date.now() < deadline && currentLease) {
    if (Date.now() >= nextHeartbeat) {
      currentLease = heartbeatComfy5060Lease(currentLease, IMAGE_LEASE_TTL_SECONDS);
      nextHeartbeat = Date.now() + 30_000;
      if (!currentLease) return;
    }
    try {
      const response = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { cache: "no-store" });
      if (response.ok) {
        const body = await response.json().catch(() => null) as Record<string, unknown> | null;
        const entry = body?.[promptId] ?? body;
        if (historyTerminal(entry)) return;
      }
    } catch {
      // Preserve the lease across transient history failures.
    }
    await new Promise((resolve) => setTimeout(resolve, MONITOR_POLL_MS));
  }
}

function monitorAndRelease(baseUrl: string, promptId: string, lease: Comfy5060Lease): void {
  void waitForPromptTerminal(baseUrl, promptId, lease)
    .finally(() => {
      releaseComfy5060Lease(lease);
    });
}

export async function submitComfyPromptWith5060Lease(args: {
  baseUrl: string;
  init: RequestInit;
  workerId: string;
  ownerId?: string;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<Response> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const submit = args.fetcher || fetch;
  if (!isRtx5060Comfy8188Endpoint(baseUrl)) {
    return submit(`${baseUrl}/prompt`, args.init);
  }

  const acquired = acquireComfy5060Lease({
    ownerId: args.ownerId || createComfyLeaseOwnerId(args.workerId),
    workerId: args.workerId,
    purpose: "image",
    ttlSeconds: IMAGE_LEASE_TTL_SECONDS,
  });
  if (!acquired.ok) throw new Comfy5060BusyError();

  const lease = acquired.lease;
  let response: Response;
  try {
    response = await submit(`${baseUrl}/prompt`, args.init);
  } catch (error) {
    // The POST outcome may be ambiguous. Keep ownership until the long lease
    // expires rather than allowing a second GPU workload to overlap it.
    throw error;
  }

  if (!response.ok) {
    releaseComfy5060Lease(lease);
    return response;
  }

  const clone = response.clone();
  const parsed = await clone.json().catch(() => null);
  const promptId = promptIdFromPayload(parsed);
  if (!promptId) {
    // An unreadable success response is ambiguous. Retain the lease to expiry.
    return response;
  }
  monitorAndRelease(baseUrl, promptId, lease);
  return response;
}
