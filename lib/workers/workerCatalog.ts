export const WORKER_PLATFORMS = ["windows", "linux"] as const;
export const WORKER_KINDS = ["agent", "polling-worker", "service", "comfy"] as const;
export const WORKER_ALLOWED_ACTIONS = ["status", "start", "stop", "restart"] as const;
export const WORKER_LIFECYCLE_ACTIONS = ["status", "ensure-running", "start", "stop", "restart", "release"] as const;

export type WorkerPlatform = (typeof WORKER_PLATFORMS)[number];
export type WorkerKind = (typeof WORKER_KINDS)[number];
export type WorkerAllowedAction = (typeof WORKER_ALLOWED_ACTIONS)[number];
export type WorkerLifecycleAction = (typeof WORKER_LIFECYCLE_ACTIONS)[number];

export type WorkerCatalogEntry = {
  id: string;
  displayName: string;
  platform: WorkerPlatform;
  kind: WorkerKind;
  enabled: boolean;
  dryRunOnly: boolean;
  resources: string[];
  dependencies: string[];
  idleTimeoutSeconds: number;
  dangerousStop: boolean;
  userVisible: boolean;
  allowedActions: WorkerAllowedAction[];
  description: string;
  lane?: "image" | "video" | "audio";
  gpu?: "linux-5060ti" | "linux-3090" | "windows-3090" | "windows-helper";
  userStatusKind?: "service" | "worker" | "lane" | "one-shot";
};

export const REQUIRED_RESOURCE_LOCK_IDS = [
  "gpu:slr-5060",
  "gpu:shawn-3090",
  "gpu:linux-3090",
  "gpu:linux-5060ti",
  "service:qwen3-tts",
  "service:cozyvoice",
  "service:applio",
  "service:voice-dataset",
  "service:voice-design",
  "service:character-preview",
  "service:character-completion",
  "service:ltx-video",
  "comfy:linux-image",
] as const;

export type WorkerResourceLockId = (typeof REQUIRED_RESOURCE_LOCK_IDS)[number];

export const WORKER_CATALOG = [
  {
    id: "voice-ltx",
    displayName: "Linux LTX Voice Worker",
    platform: "linux",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["gpu:linux-3090", "service:ltx-video"],
    dependencies: [],
    idleTimeoutSeconds: 900,
    dangerousStop: true,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Linux systemd worker for LTX and Unnatural LTX character voice samples. RTX 3090 is primary; only a deterministic pre-submit failure may select the TEST RTX 5060 Ti split-aux fallback through its shared GPU lease. Ambiguous primary submission is never replayed.",
    lane: "audio",
    gpu: "linux-3090",
    userStatusKind: "worker",
  },
  {
    id: "ltx-audio-5060",
    displayName: "TEST RTX 5060 Ti LTX Audio Fallback",
    platform: "linux",
    kind: "service",
    enabled: true,
    dryRunOnly: false,
    resources: ["gpu:linux-5060ti", "service:ltx-video"],
    dependencies: [],
    idleTimeoutSeconds: 300,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "TEST-only remote systemd service otg-character-ltx-audio-5060-3003.service exposing the proven split-aux LTX audio workflow on port 8191. It is started on demand and must remain disabled at boot.",
    lane: "audio",
    gpu: "linux-5060ti",
    userStatusKind: "service",
  },
  {
    id: "qwen3-tts",
    displayName: "Qwen3 TTS Embedded Runtime",
    platform: "linux",
    kind: "service",
    enabled: false,
    dryRunOnly: true,
    resources: ["gpu:linux-3090", "service:qwen3-tts"],
    dependencies: [],
    idleTimeoutSeconds: 0,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status"],
    description: "Qwen3-TTS is loaded on demand inside the Linux Voice Design Worker. There is no separate persistent TTS service holding VRAM.",
    lane: "audio",
    gpu: "linux-3090",
    userStatusKind: "one-shot",
  },
  {
    id: "voice-design",
    displayName: "Linux Qwen3 Voice Design Worker",
    platform: "linux",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["gpu:linux-3090", "service:voice-design", "service:qwen3-tts"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Linux systemd polling worker for Qwen3 character voice-design/sample jobs. It waits for the RTX 3090 ComfyUI queue to become idle, releases cached ComfyUI models, loads Qwen3-TTS for one job, uploads the WAV, then releases GPU memory.",
    lane: "audio",
    gpu: "linux-3090",
    userStatusKind: "worker",
  },
  {
    id: "cozyvoice",
    displayName: "Linux CosyVoice3 Character Worker",
    platform: "linux",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["gpu:linux-3090", "service:cozyvoice"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Linux systemd polling worker for CosyVoice3 character voice-sample jobs. It waits for the RTX 3090 ComfyUI queue to become idle, releases cached models, generates one sample, uploads it, and exits the model subprocess to release VRAM.",
    lane: "audio",
    gpu: "linux-3090",
    userStatusKind: "worker",
  },
  {
    id: "applio",
    displayName: "Linux Applio Training Worker",
    platform: "linux",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["gpu:linux-3090", "service:applio"],
    dependencies: ["voice-dataset"],
    idleTimeoutSeconds: 10800,
    dangerousStop: true,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Linux systemd polling worker for durable Applio model-training jobs. It claims only start_applio_training after a real IndexTTS2 voice pack is ready, shares the RTX 3090 voice GPU lock, waits for ComfyUI to become idle, runs preprocess/extract/train/index, and persists verified .pth and .index artifacts.",
    lane: "audio",
    gpu: "linux-3090",
    userStatusKind: "worker",
  },
  {
    id: "voice-dataset",
    displayName: "Linux IndexTTS2 Dataset Worker",
    platform: "linux",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["gpu:linux-3090", "service:voice-dataset"],
    dependencies: [],
    idleTimeoutSeconds: 1800,
    dangerousStop: true,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Linux systemd polling worker for durable IndexTTS2 training-dataset jobs. It claims only generate_training_dataset, shares the RTX 3090 voice GPU lock, releases idle ComfyUI models, generates and uploads resumable WAV batches, and leaves completed packs ready for user review.",
    lane: "audio",
    gpu: "linux-3090",
    userStatusKind: "worker",
  },
  {
    id: "applio-inference",
    displayName: "Linux Applio Inference Worker",
    platform: "linux",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["gpu:linux-3090", "service:applio"],
    dependencies: ["applio"],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Linux systemd polling worker for test_trained_voice jobs. It validates the trained .pth and .index artifacts, shares the RTX 3090 voice GPU lock, runs real Applio inference, uploads the WAV, and reports a non-mock playback result.",
    lane: "audio",
    gpu: "linux-3090",
    userStatusKind: "worker",
  },
  {
    id: "character-preview",
    displayName: "Linux Character Preview Dub Worker",
    platform: "linux",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["gpu:linux-3090", "service:character-preview", "service:applio"],
    dependencies: ["applio-inference"],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Linux systemd polling worker for generate_character_preview jobs. It creates deterministic guide speech, converts it through the trained Applio model, builds a short source-image MP4, muxes the trained voice, validates the final audio/video streams, and persists the real preview under the TEST data root.",
    lane: "audio",
    gpu: "linux-3090",
    userStatusKind: "worker",
  },
  {
    id: "character-completion",
    displayName: "Character Completion Worker",
    platform: "linux",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:character-completion", "gpu:linux-5060ti", "comfy:linux-image"],
    dependencies: [],
    idleTimeoutSeconds: 900,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Linux systemd polling worker that completes saved-for-later characters, submits the 8-angle card once, checks both ComfyUI GPUs for output, and saves the final character.",
    lane: "image",
    gpu: "linux-5060ti",
    userStatusKind: "worker",
  },
] as const satisfies readonly WorkerCatalogEntry[];

const CATALOG_BY_ID = new Map<string, WorkerCatalogEntry>(WORKER_CATALOG.map((entry) => [entry.id, entry]));

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function includesString<T extends readonly string[]>(items: T, value: unknown): value is T[number] {
  return typeof value === "string" && (items as readonly string[]).includes(value);
}

export function getWorkerCatalog(): WorkerCatalogEntry[] {
  return WORKER_CATALOG.map((entry) => ({ ...entry, resources: [...entry.resources], dependencies: [...entry.dependencies], allowedActions: [...entry.allowedActions] }));
}

export function getWorkerCatalogEntry(workerId: unknown): WorkerCatalogEntry | null {
  return CATALOG_BY_ID.get(cleanString(workerId)) || null;
}

export function isKnownWorkerId(workerId: unknown): boolean {
  return !!getWorkerCatalogEntry(workerId);
}

export function normalizeWorkerLifecycleAction(value: unknown): WorkerLifecycleAction | null {
  const action = cleanString(value);
  return includesString(WORKER_LIFECYCLE_ACTIONS, action) ? action : null;
}

export function isWorkerActionAllowed(workerId: unknown, action: unknown): boolean {
  const entry = getWorkerCatalogEntry(workerId);
  const normalized = normalizeWorkerLifecycleAction(action);
  if (!entry || !normalized || !entry.enabled) return false;
  if (normalized === "ensure-running") return entry.allowedActions.includes("start");
  if (normalized === "release") return entry.allowedActions.includes("stop");
  return entry.allowedActions.includes(normalized);
}

export function validateWorkerLifecycleRequest(workerId: unknown, action: unknown): { ok: true; entry: WorkerCatalogEntry; action: WorkerLifecycleAction } | { ok: false; error: string } {
  const entry = getWorkerCatalogEntry(workerId);
  if (!entry) return { ok: false, error: "Unknown workerId." };
  const normalized = normalizeWorkerLifecycleAction(action);
  if (!normalized) return { ok: false, error: "Unknown worker lifecycle action." };
  if (!isWorkerActionAllowed(entry.id, normalized)) return { ok: false, error: "Worker action is not allowed for this worker." };
  return { ok: true, entry, action: normalized };
}

export function publicWorkerCatalogEntry(entry: WorkerCatalogEntry): WorkerCatalogEntry {
  return {
    ...entry,
    resources: [...entry.resources],
    dependencies: [...entry.dependencies],
    allowedActions: [...entry.allowedActions],
  };
}
