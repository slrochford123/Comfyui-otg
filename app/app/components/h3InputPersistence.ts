"use client";

import type { H3AdvancedSettings } from "@/lib/production/h3Settings";

type PersistedPromptSource = "direct" | "builder";

export type PersistedH3MediaKind = "image" | "video" | "audio";

export type PersistedH3MediaMeta = {
  id: string;
  kind: PersistedH3MediaKind;
  storageKey: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  description: string;
  includeAudio?: boolean;
  sourceDurationSeconds?: number;
  clipStartSeconds?: number;
  clipDurationSeconds?: number;
};

export type PersistedH3RefModSlot = {
  id?: string;
  name: string;
  category?: string;
  sourceKind?: string;
  strength?: number;
  components?: string;
  visualStrength?: number;
  audioStrength?: number;
  copies?: number;
  description?: string;
  characterId?: string;
};

export type PersistedH3InputState = {
  version: 1;
  savedAt: string;
  mode: string;
  quality: string;
  h3Settings: H3AdvancedSettings;
  rifeInterpolation60Fps?: boolean;
  duration: 5 | 10;
  orientation: string;
  originalPrompt: string;
  undoPrompt: string;
  scenePrompt: string;
  suggestion: string;
  suggestionDraft: string;
  reviewedFingerprint: string;
  promptSource: PersistedPromptSource;
  visualStyle: string;
  stylePresetId: string;
  cameraFeel: string;
  shotFlow: string;
  selectedLoras: Array<{ id: string; strength: number }>;
  enhancementLevel: "short" | "medium" | "long";
  firstImage: PersistedH3MediaMeta | null;
  lastImage: PersistedH3MediaMeta | null;
  references: PersistedH3MediaMeta[];
  realismPrompt?: string;
  realismReferences?: PersistedH3MediaMeta[];
  realismPreset?: string;
  realismSpeedLora?: string;
  realismPeopleEnabled?: boolean;
  realismSeedMode?: "random" | "fixed";
  realismSeed?: string;
  realismExpertEdit?: boolean;
  realismCompiledPromptDraft?: string;
  bodySwapSourceVideo?: PersistedH3MediaMeta | null;
  bodySwapReplacementImage?: PersistedH3MediaMeta | null;
  bodySwapSelector?: string;
  bodySwapPrompt?: string;
  bodySwapPreserveAudio?: boolean;
  bodySwapSeedMode?: "random" | "fixed";
  bodySwapSeed?: string;
  refModsPrompt?: string;
  refModSlots?: PersistedH3RefModSlot[];
  refModsTurbo?: boolean;
  refModsSeedMode?: "random" | "fixed";
  refModsSeed?: string;
};

export type PersistedH3MediaRecord = {
  key: string;
  file: File | Blob;
};

const DB_NAME = "otg-h3-generator-inputs-v1";
const DB_VERSION = 1;
const STORE_NAME = "media";

function hasStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function mediaPrefix(storageKey: string) {
  return `${storageKey}:media:`;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

async function openDb() {
  if (typeof indexedDB === "undefined") return null;
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open H3 input storage."));
  });
}

export function mediaStorageKey(
  storageKey: string,
  slot: string,
) {
  return `${mediaPrefix(storageKey)}${slot}`;
}

export function readPersistedH3InputState(
  storageKey: string,
): PersistedH3InputState | null {
  if (!hasStorage()) return null;
  try {
    const value = JSON.parse(
      window.localStorage.getItem(storageKey) || "null",
    ) as PersistedH3InputState | null;

    if (!value || value.version !== 1) return null;
    return value;
  } catch {
    return null;
  }
}

export function writePersistedH3InputState(
  storageKey: string,
  state: PersistedH3InputState,
) {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(state),
    );
  } catch {
    // Best-effort persistence. Media blobs may exceed device quota.
  }
}

export function clearPersistedH3InputState(
  storageKey: string,
) {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Best-effort cleanup only.
  }
}

async function deletePersistedH3MediaByPrefix(
  db: IDBDatabase,
  storageKey: string,
) {
  const prefix = mediaPrefix(storageKey);
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  await new Promise<void>((resolve, reject) => {
    const cursorRequest = store.openCursor();
    cursorRequest.onerror = () =>
      reject(cursorRequest.error || new Error("Could not inspect H3 media storage."));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (String(cursor.key).startsWith(prefix)) {
        cursor.delete();
      }
      cursor.continue();
    };
  });
  await transactionDone(transaction);
}

export async function writePersistedH3MediaFiles(
  storageKey: string,
  records: PersistedH3MediaRecord[],
) {
  const db = await openDb();
  if (!db) return;
  try {
    await deletePersistedH3MediaByPrefix(db, storageKey);
    if (!records.length) return;

    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    records.forEach((record) => {
      store.put(record);
    });
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function readPersistedH3MediaFiles(
  metas: PersistedH3MediaMeta[],
) {
  const db = await openDb();
  if (!db) return new Map<string, File>();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const entries = await Promise.all(
      metas.map(async (meta) => {
        const record = await requestResult<{
          key: string;
          file: File | Blob;
        } | undefined>(store.get(meta.storageKey));

        const file =
          record?.file instanceof File
            ? record.file
            : record?.file instanceof Blob
              ? new File(
                  [record.file],
                  meta.name,
                  {
                    type: meta.type || record.file.type,
                    lastModified: meta.lastModified || Date.now(),
                  },
                )
              : null;

        return file ? ([meta.storageKey, file] as const) : null;
      }),
    );

    await transactionDone(transaction);

    return new Map(
      entries.filter((entry): entry is readonly [string, File] => Boolean(entry)),
    );
  } finally {
    db.close();
  }
}

export async function clearPersistedH3MediaFiles(
  storageKey: string,
) {
  const db = await openDb();
  if (!db) return;
  try {
    await deletePersistedH3MediaByPrefix(db, storageKey);
  } finally {
    db.close();
  }
}
