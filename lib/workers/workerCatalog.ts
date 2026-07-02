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
  gpu?: "linux-5060ti" | "windows-3090" | "windows-helper";
  userStatusKind?: "service" | "worker" | "lane" | "one-shot";
};

export const REQUIRED_RESOURCE_LOCK_IDS = [
  "gpu:windows-3090",
  "gpu:linux-5060ti",
  "service:qwen3-tts",
  "service:xtts",
  "service:cozyvoice",
  "service:applio",
  "service:voice-dataset",
  "service:voice-design",
  "service:character-preview",
  "service:bg-remove",
  "service:whisper",
  "service:speaker-diarization",
  "service:ace-step",
  "service:ltx-video",
  "comfy:windows-3090",
  "comfy:linux-image",
] as const;

export type WorkerResourceLockId = (typeof REQUIRED_RESOURCE_LOCK_IDS)[number];

export const WORKER_CATALOG = [
  {
    id: "voice-ltx",
    displayName: "LTX Voice/Video Preview Worker",
    platform: "windows",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["gpu:windows-3090", "service:ltx-video"],
    dependencies: ["comfy-3090-sage-video"],
    idleTimeoutSeconds: 900,
    dangerousStop: true,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Windows LTX/SageAttention lane for video and voice-preview work only. Qwen image jobs must not use this worker.",
    lane: "video",
    gpu: "windows-3090",
    userStatusKind: "worker",
  },
  {
    id: "comfy-3090-sage-video",
    displayName: "Windows RTX 3090 SageAttention ComfyUI",
    platform: "windows",
    kind: "comfy",
    enabled: true,
    dryRunOnly: true,
    resources: ["gpu:windows-3090", "comfy:windows-3090"],
    dependencies: [],
    idleTimeoutSeconds: 1200,
    dangerousStop: true,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Windows RTX 3090 ComfyUI lane reserved for LTX/video workloads. It is not an image-generation target for Qwen image jobs.",
    lane: "video",
    gpu: "windows-3090",
    userStatusKind: "lane",
  },
  {
    id: "qwen3-tts",
    displayName: "Qwen3 TTS Service",
    platform: "windows",
    kind: "service",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:qwen3-tts"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Qwen3 TTS voice service used after a character exists and the user selects the Qwen TTS voice method.",
    userStatusKind: "service",
  },
  {
    id: "voice-design",
    displayName: "Voice Design Worker",
    platform: "windows",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:voice-design", "service:qwen3-tts"],
    dependencies: ["qwen3-tts"],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Windows polling worker for character voice-design/sample jobs. It uses OTG_WORKER_TOKEN from the environment only.",
    userStatusKind: "worker",
  },
  {
    id: "xtts",
    displayName: "XTTS Service",
    platform: "windows",
    kind: "service",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:xtts"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "XTTS voice service used only when the user selects XTTS for voice sample generation. WorkerManager ownership is now enabled after launcher validation.",
    userStatusKind: "service",
  },
  {
    id: "cozyvoice",
    displayName: "CozyVoice Service",
    platform: "windows",
    kind: "service",
    enabled: false,
    dryRunOnly: true,
    resources: ["service:cozyvoice"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "CozyVoice currently has a one-shot runner, not a verified long-running service wrapper. It stays disabled until a WorkerManager-owned service/job wrapper is validated.",
    userStatusKind: "one-shot",
  },
  {
    id: "applio",
    displayName: "Applio Training Worker",
    platform: "windows",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:applio"],
    dependencies: ["voice-dataset"],
    idleTimeoutSeconds: 600,
    dangerousStop: true,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Applio model-training worker. It should run only after approved voice samples and any required dataset are ready.",
    userStatusKind: "worker",
  },
  {
    id: "voice-dataset",
    displayName: "Voice Dataset Worker",
    platform: "windows",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:voice-dataset"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Dataset generation worker used after voice sample approval and before Applio training.",
    userStatusKind: "worker",
  },
  {
    id: "bg-remove",
    displayName: "Background Removal Helper",
    platform: "windows",
    kind: "service",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:bg-remove"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Windows TEST background-removal helper at port 3333. WorkerManager ownership is enabled after runtime launcher validation.",
    lane: "image",
    gpu: "windows-helper",
    userStatusKind: "service",
  },
  {
    id: "whisper",
    displayName: "Whisper Transcription Service",
    platform: "windows",
    kind: "service",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:whisper"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Windows Whisper transcription service at port 9001. WorkerManager ownership is now enabled after launcher validation.",
    lane: "audio",
    userStatusKind: "service",
  },
  {
    id: "speaker-diarization",
    displayName: "Speaker Diarization Service",
    platform: "windows",
    kind: "service",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:speaker-diarization"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Windows pyannote speaker diarization service at port 9010. WorkerManager ownership is now enabled after launcher validation.",
    lane: "audio",
    userStatusKind: "service",
  },
  {
    id: "character-preview",
    displayName: "Character Preview Worker",
    platform: "windows",
    kind: "polling-worker",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:character-preview"],
    dependencies: [],
    idleTimeoutSeconds: 600,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Windows polling worker for character preview/dub jobs. WorkerManager ownership is enabled after launcher validation.",
    lane: "audio",
    userStatusKind: "worker",
  },
  {
    id: "ace-step",
    displayName: "ACE-Step Music Service",
    platform: "windows",
    kind: "service",
    enabled: true,
    dryRunOnly: false,
    resources: ["service:ace-step"],
    dependencies: [],
    idleTimeoutSeconds: 900,
    dangerousStop: false,
    userVisible: false,
    allowedActions: ["status", "start", "stop", "restart"],
    description: "Windows ACE-Step 1.5 API runtime at port 8001. WorkerManager ownership is enabled after direct runtime API validation.",
    lane: "audio",
    gpu: "windows-3090",
    userStatusKind: "service",
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

