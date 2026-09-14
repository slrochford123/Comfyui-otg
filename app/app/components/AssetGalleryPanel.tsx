"use client";

import React from "react";

import {
  ASSET_IMAGE_MODELS,
  type AssetImageModelId,
} from "@/lib/assets/imageModelCatalog";
import {
  MAX_ASSET_CANDIDATES,
  appendAssetCandidate,
  removeAssetCandidate,
} from "@/lib/assets/candidateFlow";
import {
  executeAssetCandidateEdit,
  type EditableAssetCandidate,
} from "@/lib/assets/assetCandidateEditClient";

type AssetWorkspaceMode =
  | "create"
  | "upload"
  | "library";

type AssetCandidateSource =
  | "generated"
  | "uploaded"
  | "edited"
  | "saved";

type AssetCandidate = {
  id: string;
  name: string;
  imageUrl: string;
  serverPath: string;
  source: AssetCandidateSource;
  modelId?: AssetImageModelId;
  modelLabel?: string;
  artStyle?: string;
  prompt?: string;
  promptId?: string;
  seed?: number;
  workflowId?: string;
  internalPrompt?: string;
  sourceCandidateId?: string;
  rootCandidateId?: string;
  editDepth?: number;
  editInstruction?: string;
  backgroundFree?: boolean;
};

type AssetLibraryItem = {
  id: string;
  name: string;
  imageUrl: string;
  identityDescription: string;
  createdAt: number;
};

type SavedAssetCandidate = {
  id: string;
  name: string;
  imageUrl: string;
  serverPath: string;
  source: string;
  modelId: string;
  modelLabel: string;
  artStyle: string;
  prompt: string;
  promptId: string;
  seed: number;
  workflowId?: string;
  internalPrompt?: string;
  sourceCandidateId?: string;
  rootCandidateId?: string;
  editDepth?: number;
  editInstruction?: string;
  backgroundFree?: boolean;
  createdAt: string;
  updatedAt: string;
};

type AssetSort =
  | "newest"
  | "oldest"
  | "name";

const ASSET_PROMPT_ENHANCE_LEVELS = [
  { key: "short", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "long", label: "Large" },
] as const;

type AssetPromptEnhanceLevel =
  (typeof ASSET_PROMPT_ENHANCE_LEVELS)[number]["key"];

const ASSET_ART_STYLES = [
  "Cartoon",
  "Anime",
  "3D Animation",
  "Unreal Engine",
  "Photorealistic",
  "Cinematic",
] as const;

const ASSET_MASTER_WORKFLOW_ID =
  "internal/character-reference/seedvr2_character_reference_1080p";

const ASSET_MASTER_WORKFLOW_FILE =
  "comfy_workflows/internal/character-reference/seedvr2_character_reference_1080p.json";

const ASSET_MASTER_OUTPUT_NODE =
  "9";

const ASSET_MASTER_WIDTH =
  1080;

const ASSET_MASTER_HEIGHT =
  1080;

function text(
  value: unknown,
) {
  return String(
    value ?? "",
  ).trim();
}

function numericTime(
  value: unknown,
) {
  const numeric =
    Number(value);

  if (
    Number.isFinite(
      numeric,
    ) &&
    numeric > 0
  ) {
    return numeric;
  }

  const parsed =
    Date.parse(
      text(value),
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : 0;
}

function booleanish(
  value: unknown,
) {
  const raw =
    text(value).toLowerCase();

  return [
    "true",
    "1",
    "yes",
    "on",
  ].includes(raw);
}

function fileUrl(
  value: unknown,
) {
  const raw =
    text(value);

  if (!raw) {
    return "";
  }

  if (
    raw.startsWith("/") ||
    raw.startsWith(
      "http://",
    ) ||
    raw.startsWith(
      "https://",
    ) ||
    raw.startsWith(
      "blob:",
    ) ||
    raw.startsWith(
      "data:",
    )
  ) {
    return raw;
  }

  return `/api/file?path=${encodeURIComponent(raw)}`;
}

function imageFromAssetRecord(
  record: Record<
    string,
    any
  >,
) {
  const defaultImage =
    record.defaultImage;

  if (
    defaultImage &&
    typeof defaultImage ===
      "object"
  ) {
    const nested =
      defaultImage as Record<
        string,
        any
      >;

    return fileUrl(
      nested.displayImage ||
        nested.url ||
        nested.imageUrl ||
        nested.workflowImage ||
        nested.serverPath ||
        nested.path,
    );
  }

  return fileUrl(
    defaultImage ||
      record.displayImage ||
      record.imageUrl ||
      record.previewImage ||
      record.previewUrl ||
      record.url ||
      record.workflowImage ||
      record.serverPath ||
      record.path,
  );
}

function unwrapRecords(
  payload: unknown,
): unknown[] {
  if (
    Array.isArray(payload)
  ) {
    return payload;
  }

  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    return [];
  }

  const record =
    payload as Record<
      string,
      any
    >;

  for (
    const key of [
      "items",
      "assets",
      "results",
    ]
  ) {
    if (
      Array.isArray(
        record[key],
      )
    ) {
      return record[key];
    }
  }

  return [];
}

function normalizeLibraryAsset(
  value: unknown,
  index: number,
): AssetLibraryItem | null {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return null;
  }

  const record =
    value as Record<
      string,
      any
    >;

  const id =
    text(
      record.id ||
        record.assetId,
    );

  if (!id) {
    return null;
  }

  return {
    id,
    name:
      text(
        record.name,
      ) ||
      `Asset ${index + 1}`,
    imageUrl:
      imageFromAssetRecord(
        record,
      ),
    identityDescription:
      text(
        record.identityDescription ||
          record.description ||
          record.prompt,
      ),
    createdAt:
      numericTime(
        record.updatedAt ||
          record.createdAt,
      ),
  };
}

function normalizeSavedAsset(
  value: unknown,
): SavedAssetCandidate | null {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return null;
  }

  const record =
    value as Record<
      string,
      any
    >;

  const id =
    text(record.id);

  const name =
    text(record.name);

  const imageUrl =
    fileUrl(
      record.imageUrl ||
        record.serverPath,
    );

  const serverPath =
    text(
      record.serverPath,
    );

  if (
    !id ||
    !name ||
    !imageUrl ||
    !serverPath
  ) {
    return null;
  }

  return {
    id,
    name,
    imageUrl,
    serverPath,
    source:
      text(
        record.source,
      ),
    modelId:
      text(
        record.modelId,
      ),
    modelLabel:
      text(
        record.modelLabel,
      ),
    artStyle:
      text(
        record.artStyle,
      ),
    prompt:
      text(
        record.prompt,
      ),
    promptId:
      text(
        record.promptId,
      ),
    seed:
      Number(
        record.seed,
      ) || 0,
    workflowId:
      text(
        record.workflowId,
      ),
    internalPrompt:
      text(
        record.internalPrompt,
      ),
    sourceCandidateId:
      text(
        record.sourceCandidateId,
      ),
    rootCandidateId:
      text(
        record.rootCandidateId,
      ),
    editDepth:
      Number(
        record.editDepth,
      ) || 0,
    editInstruction:
      text(
        record.editInstruction,
      ),
    backgroundFree:
      booleanish(
        record.backgroundFree,
      ),
    createdAt:
      text(
        record.createdAt,
      ),
    updatedAt:
      text(
        record.updatedAt,
      ),
  };
}

function candidateId(
  prefix: string,
) {
  if (
    typeof crypto !==
      "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

function randomAssetSeed() {
  const values =
    new Uint32Array(2);

  if (
    typeof crypto !==
      "undefined" &&
    typeof crypto.getRandomValues ===
      "function"
  ) {
    crypto.getRandomValues(
      values,
    );

    return String(
      values[0] *
        0x100000 +
        (
          values[1] &
          0xfffff
        ),
    );
  }

  return String(
    Math.floor(
      Math.random() *
        Number.MAX_SAFE_INTEGER,
    ),
  );
}

function getAssetDeviceId() {
  if (
    typeof window ===
    "undefined"
  ) {
    return "asset-web";
  }

  const key =
    "otg_asset_device_id";

  const existing =
    window.localStorage.getItem(
      key,
    );

  if (existing) {
    return existing;
  }

  const value =
    typeof crypto !==
      "undefined" &&
    typeof crypto.randomUUID ===
      "function"
      ? `asset-${crypto.randomUUID()}`
      : `asset-${Date.now()}`;

  window.localStorage.setItem(
    key,
    value,
  );

  return value;
}

function sleep(
  ms: number,
) {
  return new Promise<void>(
    (resolve) =>
      window.setTimeout(
        resolve,
        ms,
      ),
  );
}

async function readJson(
  response: Response,
) {
  return response
    .json()
    .catch(
      () =>
        ({} as Record<
          string,
          any
        >),
    );
}

async function waitForAssetWorkflowImage(
  args: {
    promptId: string;
    nodeId: string;
    filenamePrefix?: string;
    comfyBaseUrl?: string;
    timeoutMs?: number;
  },
) {
  const started =
    Date.now();

  const timeoutMs =
    args.timeoutMs ||
    10 * 60 * 1000;

  while (
    Date.now() -
      started <
    timeoutMs
  ) {
    const params =
      new URLSearchParams({
        promptId:
          args.promptId,
        nodeId:
          args.nodeId,
        t: Date.now().toString(
          36,
        ),
      });

    if (
      args.filenamePrefix
    ) {
      params.set(
        "filenamePrefix",
        args.filenamePrefix,
      );
    }

    if (
      args.comfyBaseUrl
    ) {
      params.set(
        "comfyBaseUrl",
        args.comfyBaseUrl,
      );
    }

    const response =
      await fetch(
        `/api/comfy/history-image?${params.toString()}`,
        {
          cache:
            "no-store",
          credentials:
            "include",
        },
      );

    const payload =
      await readJson(
        response,
      );

    if (
      response.status ===
      401
    ) {
      window.location.href =
        "/login?reason=session";

      throw new Error(
        "Session expired.",
      );
    }

    if (
      response.ok &&
      payload?.ok
    ) {
      const url =
        text(
          payload.imageUrl ||
            payload.url,
        );

      if (url) {
        return {
          url,
        };
      }
    }

    if (
      response.status !==
        404 &&
      payload?.error
    ) {
      throw new Error(
        text(
          payload.error,
        ),
      );
    }

    await sleep(1500);
  }

  throw new Error(
    `Timed out waiting for Asset workflow image ${args.promptId}.`,
  );
}

function extensionForMime(
  mime: string,
) {
  const value =
    mime.toLowerCase();

  if (
    value.includes(
      "jpeg",
    )
  ) {
    return ".jpg";
  }

  if (
    value.includes(
      "webp",
    )
  ) {
    return ".webp";
  }

  if (
    value.includes(
      "gif",
    )
  ) {
    return ".gif";
  }

  return ".png";
}

async function copyAssetImageToUpload(
  outputUrl: string,
  filenameBase: string,
  assetName: string,
) {
  const imageResponse =
    await fetch(
      outputUrl,
      {
        cache:
          "no-store",
        credentials:
          "include",
      },
    );

  if (
    !imageResponse.ok
  ) {
    throw new Error(
      `Could not read the Asset image output (${imageResponse.status}).`,
    );
  }

  const blob =
    await imageResponse.blob();

  if (!blob.size) {
    throw new Error(
      "Asset image output was empty.",
    );
  }

  const ext =
    extensionForMime(
      blob.type ||
        "image/png",
    );

  const safeBase =
    filenameBase
      .replace(
        /[^a-z0-9_-]+/gi,
        "-",
      )
      .replace(
        /^-+|-+$/g,
        "",
      ) ||
    "asset";

  const form =
    new FormData();

  form.set(
    "assetName",
    assetName,
  );

  form.set(
    "image",
    new File(
      [blob],
      `${safeBase}${ext}`,
      {
        type:
          blob.type ||
          "image/png",
      },
    ),
  );

  const response =
    await fetch(
      "/api/assets/upload",
      {
        method: "POST",
        credentials:
          "include",
        body: form,
      },
    );

  const payload =
    await readJson(
      response,
    );

  if (
    response.status ===
    401
  ) {
    window.location.href =
      "/login?reason=session";

    throw new Error(
      "Session expired.",
    );
  }

  if (
    !response.ok ||
    !payload?.ok
  ) {
    throw new Error(
      text(
        payload?.error,
      ) ||
        `Could not persist the Asset image (${response.status}).`,
    );
  }

  const serverPath =
    text(
      payload.serverPath,
    );

  if (!serverPath) {
    throw new Error(
      "Asset upload did not return a stable server path.",
    );
  }

  return {
    serverPath,
    fileUrl:
      text(
        payload.fileUrl,
      ) ||
      `/api/file?path=${encodeURIComponent(serverPath)}`,
  };
}

function editableAssetCandidate(
  candidate: AssetCandidate,
): EditableAssetCandidate {
  return {
    id:
      candidate.id,
    label:
      candidate.modelLabel ||
      candidate.name,
    url:
      candidate.imageUrl,
    serverPath:
      candidate.serverPath,
    internalPrompt:
      candidate.internalPrompt ||
      candidate.prompt,
    promptId:
      candidate.promptId,
    workflowId:
      candidate.workflowId,
    backgroundFree:
      candidate.backgroundFree,
    sourceCandidateId:
      candidate.sourceCandidateId,
    rootCandidateId:
      candidate.rootCandidateId,
    editDepth:
      candidate.editDepth,
    editInstruction:
      candidate.editInstruction,
  };
}

function assetIdentityDescription(
  candidate: AssetCandidate,
) {
  return [
    candidate.prompt
      ? `Asset description: ${candidate.prompt}`
      : "",
    candidate.artStyle
      ? `Visual style: ${candidate.artStyle}.`
      : "",
    candidate.modelLabel
      ? `Original image model: ${candidate.modelLabel}.`
      : "",
    "Preserve the Asset's established shape, proportions, materials, colors, markings, and visible continuity-critical details.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function validateAssetMasterDimensions(
  imageUrl: string,
) {
  await new Promise<void>(
    (resolve, reject) => {
      const image =
        new Image();

      image.onload =
        () => {
          const width =
            Number(
              image.naturalWidth ||
                image.width ||
                0,
            );

          const height =
            Number(
              image.naturalHeight ||
                image.height ||
                0,
            );

          if (
            width !==
              ASSET_MASTER_WIDTH ||
            height !==
              ASSET_MASTER_HEIGHT
          ) {
            reject(
              new Error(
                `Asset Master size contract failed: expected ${ASSET_MASTER_WIDTH}x${ASSET_MASTER_HEIGHT}, received ${width}x${height}.`,
              ),
            );

            return;
          }

          resolve();
        };

      image.onerror =
        () =>
          reject(
            new Error(
              "Asset Master validation failed because the SeedVR output could not be loaded.",
            ),
          );

      image.src =
        imageUrl +
        (
          imageUrl.includes(
            "?",
          )
            ? "&"
            : "?"
        ) +
        `assetMasterValidation=${Date.now().toString(36)}`;
    },
  );
}

function CandidateSlots({
  candidates,
  busyCandidateId,
  onClear,
  onSave,
  onEdit,
  onUse,
}: {
  candidates:
    AssetCandidate[];
  busyCandidateId:
    string;
  onClear:
    (id: string) => void;
  onSave:
    (
      candidate:
        AssetCandidate,
    ) => void;
  onEdit:
    (
      candidate:
        AssetCandidate,
    ) => void;
  onUse:
    (
      candidate:
        AssetCandidate,
    ) => void;
}) {
  return (
    <section
      className="rounded-[28px] border border-blue-300/15 bg-blue-400/[0.045] p-5"
      data-otg="asset-candidate-slots"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-200/65">
            Candidate Slots
          </div>

          <h3 className="mt-1 text-xl font-black text-white">
            Five Asset Candidates
          </h3>
        </div>

        <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-bold text-white/45">
          {candidates.length} /{" "}
          {MAX_ASSET_CANDIDATES}
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">
        Slots 1–4 remain fixed.
        After all five slots are
        filled, each new result
        replaces slot 5 only.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({
          length:
            MAX_ASSET_CANDIDATES,
        }).map(
          (_, index) => {
            const candidate =
              candidates[index];

            const busy =
              Boolean(
                candidate &&
                  busyCandidateId ===
                    candidate.id,
              );

            return (
              <article
                key={
                  candidate?.id ||
                  `empty-${index}`
                }
                className="overflow-hidden rounded-2xl border border-white/10 bg-black/30"
                data-otg={`asset-candidate-slot-${index + 1}`}
              >
                <div className="border-b border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
                  Slot {index + 1}
                </div>

                {candidate ? (
                  <>
                    <div className="flex aspect-square items-center justify-center bg-black/40">
                      <img
                        src={
                          candidate.imageUrl
                        }
                        alt={
                          candidate.name
                        }
                        draggable={
                          false
                        }
                        className="h-full w-full object-contain"
                      />
                    </div>

                    <div className="space-y-3 p-3">
                      <div>
                        <div className="truncate text-sm font-black text-white">
                          {
                            candidate.name
                          }
                        </div>

                        <div className="mt-1 text-xs text-white/40">
                          {candidate.source ===
                          "uploaded"
                            ? "Uploaded Image"
                            : candidate.source ===
                                "edited"
                              ? "Qwen Image Edit"
                              : candidate.source ===
                                  "saved"
                                ? "Restored Candidate"
                                : candidate.modelLabel ||
                                  "Generated"}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={
                            busy
                          }
                          onClick={() =>
                            onSave(
                              candidate,
                            )
                          }
                          className="min-h-9 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-2 text-[11px] font-black text-emerald-100 disabled:opacity-40"
                        >
                          Save for Later
                        </button>

                        <button
                          type="button"
                          disabled={
                            busy
                          }
                          onClick={() =>
                            onEdit(
                              candidate,
                            )
                          }
                          className="min-h-9 rounded-lg border border-violet-300/20 bg-violet-400/10 px-2 text-xs font-black text-violet-100 disabled:opacity-40"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          disabled={
                            busy
                          }
                          onClick={() =>
                            onUse(
                              candidate,
                            )
                          }
                          className="min-h-9 rounded-lg border border-blue-300/25 bg-blue-400/15 px-2 text-xs font-black text-blue-50 disabled:opacity-40"
                        >
                          {busy
                            ? "Working..."
                            : "Use"}
                        </button>

                        <button
                          type="button"
                          disabled={
                            busy
                          }
                          onClick={() =>
                            onClear(
                              candidate.id,
                            )
                          }
                          className="min-h-9 rounded-lg border border-red-300/20 bg-red-400/10 px-2 text-xs font-black text-red-100 disabled:opacity-40"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex aspect-square items-center justify-center p-4 text-center text-xs font-bold leading-5 text-white/25">
                    Empty candidate
                    slot
                  </div>
                )}
              </article>
            );
          },
        )}
      </div>
    </section>
  );
}

export default function AssetGalleryPanel({
  onBack,
}: {
  onBack: () => void;
}) {
  const [
    mode,
    setMode,
  ] =
    React.useState<AssetWorkspaceMode>(
      "create",
    );

  const [
    assetName,
    setAssetName,
  ] =
    React.useState("");

  const [
    modelId,
    setModelId,
  ] =
    React.useState<AssetImageModelId>(
      "ernie-image",
    );

  const [
    artStyle,
    setArtStyle,
  ] =
    React.useState<string>(
      "Cinematic",
    );

  const [
    prompt,
    setPrompt,
  ] =
    React.useState("");

  const [
    assetPromptEnhanceLevel,
    setAssetPromptEnhanceLevel,
  ] =
    React.useState<AssetPromptEnhanceLevel>(
      "medium",
    );

  const [
    enhancingPrompt,
    setEnhancingPrompt,
  ] =
    React.useState(false);

  const [
    candidates,
    setCandidates,
  ] =
    React.useState<
      AssetCandidate[]
    >([]);

  const [
    generating,
    setGenerating,
  ] =
    React.useState(false);

  const [
    uploading,
    setUploading,
  ] =
    React.useState(false);

  const [
    uploadFile,
    setUploadFile,
  ] =
    React.useState<File | null>(
      null,
    );

  const [
    message,
    setMessage,
  ] =
    React.useState("");

  const [
    error,
    setError,
  ] =
    React.useState("");

  const [
    library,
    setLibrary,
  ] =
    React.useState<
      AssetLibraryItem[]
    >([]);

  const [
    libraryLoading,
    setLibraryLoading,
  ] =
    React.useState(false);

  const [
    savedForLater,
    setSavedForLater,
  ] =
    React.useState<
      SavedAssetCandidate[]
    >([]);

  const [
    savedLoading,
    setSavedLoading,
  ] =
    React.useState(false);

  const [
    search,
    setSearch,
  ] =
    React.useState("");

  const [
    sort,
    setSort,
  ] =
    React.useState<AssetSort>(
      "newest",
    );

  const [
    busyCandidateId,
    setBusyCandidateId,
  ] =
    React.useState("");

  const [
    editingCandidateId,
    setEditingCandidateId,
  ] =
    React.useState("");

  const [
    editInstruction,
    setEditInstruction,
  ] =
    React.useState("");

  const [
    editNegativePrompt,
    setEditNegativePrompt,
  ] =
    React.useState("");

  const loadLibrary =
    React.useCallback(
      async () => {
        setLibraryLoading(
          true,
        );

        try {
          const response =
            await fetch(
              "/api/assets",
              {
                cache:
                  "no-store",
                credentials:
                  "include",
              },
            );

          const payload =
            await readJson(
              response,
            );

          if (
            response.status ===
            401
          ) {
            window.location.href =
              "/login?reason=session";

            return;
          }

          if (
            !response.ok
          ) {
            throw new Error(
              text(
                payload?.error,
              ) ||
                `Could not load Asset Library (${response.status}).`,
            );
          }

          const normalized =
            unwrapRecords(
              payload,
            )
              .map(
                normalizeLibraryAsset,
              )
              .filter(
                (
                  item,
                ): item is AssetLibraryItem =>
                  Boolean(item),
              );

          setLibrary(
            normalized,
          );
        } catch (
          cause
        ) {
          setError(
            cause instanceof
              Error
              ? cause.message
              : "Could not load Asset Library.",
          );
        } finally {
          setLibraryLoading(
            false,
          );
        }
      },
      [],
    );

  const loadSavedForLater =
    React.useCallback(
      async () => {
        setSavedLoading(
          true,
        );

        try {
          const response =
            await fetch(
              "/api/assets/saved-for-later",
              {
                cache:
                  "no-store",
                credentials:
                  "include",
              },
            );

          const payload =
            await readJson(
              response,
            );

          if (
            response.status ===
            401
          ) {
            window.location.href =
              "/login?reason=session";

            return;
          }

          if (
            !response.ok
          ) {
            throw new Error(
              text(
                payload?.error,
              ) ||
                `Could not load saved Asset candidates (${response.status}).`,
            );
          }

          setSavedForLater(
            unwrapRecords(
              payload,
            )
              .map(
                normalizeSavedAsset,
              )
              .filter(
                (
                  item,
                ): item is SavedAssetCandidate =>
                  Boolean(item),
              ),
          );
        } catch (
          cause
        ) {
          setError(
            cause instanceof
              Error
              ? cause.message
              : "Could not load saved Asset candidates.",
          );
        } finally {
          setSavedLoading(
            false,
          );
        }
      },
      [],
    );

  React.useEffect(
    () => {
      void loadLibrary();
      void loadSavedForLater();
    },
    [
      loadLibrary,
      loadSavedForLater,
    ],
  );

  async function ensureStableCandidate(
    candidate: AssetCandidate,
  ) {
    if (
      candidate.serverPath
    ) {
      return candidate;
    }

    const upload =
      await copyAssetImageToUpload(
        candidate.imageUrl,
        `asset-candidate-${candidate.id}`,
        candidate.name,
      );

    const stable:
      AssetCandidate = {
      ...candidate,
      serverPath:
        upload.serverPath,
      imageUrl:
        upload.fileUrl ||
        candidate.imageUrl,
    };

    setCandidates(
      (current) =>
        current.map(
          (item) =>
            item.id ===
            candidate.id
              ? stable
              : item,
        ),
    );

    return stable;
  }

  async function enhanceAssetPrompt() {
    const originalPrompt =
      prompt.trim();

    if (!originalPrompt) {
      setError(
        "Enter an Asset prompt to enhance.",
      );

      return;
    }

    if (enhancingPrompt) {
      return;
    }

    const selectedModel =
      ASSET_IMAGE_MODELS.find(
        (model) =>
          model.id ===
          modelId,
      );

    setEnhancingPrompt(true);
    setError("");
    setMessage(
      "Enhancing Asset prompt with Qwen...",
    );

    try {
      const response =
        await fetch(
          "/api/enhance-prompt",
          {
            method:
              "POST",
            credentials:
              "include",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                contextType: "asset",
                prompt:
                  originalPrompt,
                enhanceLevel:
                  assetPromptEnhanceLevel,
                level:
                  assetPromptEnhanceLevel,
                size:
                  assetPromptEnhanceLevel,
                mediaMode:
                  "image",
                mode:
                  "image",
                imageOperation:
                  "create-asset",
                workflowId:
                  "asset-gallery",
                workflowLabel:
                  "Asset Gallery",
                assetName:
                  assetName.trim(),
                modelId,
                modelLabel:
                  selectedModel?.label ||
                  "",
                assetModelLabel:
                  selectedModel?.label ||
                  "",
                artStyle,
                assetArtStyle:
                  artStyle,
                styleLabel:
                  artStyle,
              }),
          },
        );

      const payload =
        await readJson(
          response,
        );

      if (
        response.status ===
        401
      ) {
        window.location.href =
          "/login?reason=session";

        return;
      }

      if (
        !response.ok ||
        payload?.ok ===
          false
      ) {
        throw new Error(
          text(
            payload?.error,
          ) ||
            `Asset prompt enhancement failed (${response.status}).`,
        );
      }

      const nextPrompt =
        text(
          payload.enhancedPrompt ||
            payload.prompt,
        );

      if (!nextPrompt) {
        throw new Error(
          "Asset prompt enhancement returned no prompt. The original prompt was preserved.",
        );
      }

      setPrompt(nextPrompt);
      setMessage(
        "Asset prompt enhanced. Review or edit it before generating.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Asset prompt enhancement failed. The original prompt was preserved.",
      );

      setMessage("");
    } finally {
      setEnhancingPrompt(false);
    }
  }

  async function generateAsset() {
    const cleanName =
      assetName.trim();

    const cleanPrompt =
      prompt.trim();

    if (!cleanName) {
      setError(
        "Enter an Asset Name.",
      );

      return;
    }

    if (!cleanPrompt) {
      setError(
        "Describe the Asset you want to create.",
      );

      return;
    }

    if (generating) {
      return;
    }

    setGenerating(true);
    setError("");
    setMessage(
      "Submitting Asset candidate to ComfyUI...",
    );

    try {
      const response =
        await fetch(
          "/api/assets/create-image",
          {
            method:
              "POST",
            credentials:
              "include",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                name:
                  cleanName,
                model:
                  modelId,
                artStyle,
                prompt:
                  cleanPrompt,
              }),
          },
        );

      const payload =
        await readJson(
          response,
        );

      if (
        response.status ===
        401
      ) {
        window.location.href =
          "/login?reason=session";

        return;
      }

      if (
        !response.ok ||
        !payload?.ok
      ) {
        throw new Error(
          text(
            payload?.error,
          ) ||
            `Asset generation failed (${response.status}).`,
        );
      }

      const promptId =
        text(
          payload.promptId ||
            payload.prompt_id,
        );

      const outputNodeId =
        text(
          payload.outputNodeId,
        );

      if (
        !promptId ||
        !outputNodeId
      ) {
        throw new Error(
          "Asset generation returned an incomplete ComfyUI job.",
        );
      }

      setMessage(
        `${text(payload.modelLabel) || "Asset"} candidate submitted. Waiting for output...`,
      );

      const output =
        await waitForAssetWorkflowImage(
          {
            promptId,
            nodeId:
              outputNodeId,
            comfyBaseUrl:
              text(
                payload.comfyBaseUrl,
              ),
          },
        );

      const candidate:
        AssetCandidate = {
        id:
          candidateId(
            "generated",
          ),
        name:
          cleanName,
        imageUrl:
          output.url,
        serverPath: "",
        source:
          "generated",
        modelId,
        modelLabel:
          text(
            payload.modelLabel,
          ),
        artStyle,
        prompt:
          cleanPrompt,
        promptId,
        seed:
          Number(
            payload.seed,
          ) || 0,
      };

      setCandidates(
        (current) =>
          appendAssetCandidate(
            current,
            candidate,
          ),
      );

      setMessage(
        candidates.length >=
        MAX_ASSET_CANDIDATES
          ? "New candidate finished and replaced slot 5."
          : "New Asset candidate finished.",
      );
    } catch (
      cause
    ) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Asset generation failed.",
      );

      setMessage("");
    } finally {
      setGenerating(false);
    }
  }

  async function uploadAsset() {
    const cleanName =
      assetName.trim();

    if (!cleanName) {
      setError(
        "Enter an Asset Name.",
      );

      return;
    }

    if (!uploadFile) {
      setError(
        "Choose an Asset image to upload.",
      );

      return;
    }

    if (uploading) {
      return;
    }

    setUploading(true);
    setError("");
    setMessage(
      "Uploading Asset image...",
    );

    try {
      const form =
        new FormData();

      form.set(
        "assetName",
        cleanName,
      );

      form.set(
        "image",
        uploadFile,
        uploadFile.name,
      );

      const response =
        await fetch(
          "/api/assets/upload",
          {
            method:
              "POST",
            credentials:
              "include",
            body: form,
          },
        );

      const payload =
        await readJson(
          response,
        );

      if (
        response.status ===
        401
      ) {
        window.location.href =
          "/login?reason=session";

        return;
      }

      if (
        !response.ok ||
        !payload?.ok
      ) {
        throw new Error(
          text(
            payload?.error,
          ) ||
            `Asset upload failed (${response.status}).`,
        );
      }

      const imageUrl =
        text(
          payload.fileUrl,
        );

      const serverPath =
        text(
          payload.serverPath,
        );

      if (
        !imageUrl ||
        !serverPath
      ) {
        throw new Error(
          "Asset upload completed without a stable image reference.",
        );
      }

      const candidate:
        AssetCandidate = {
        id:
          candidateId(
            "uploaded",
          ),
        name:
          cleanName,
        imageUrl,
        serverPath,
        source:
          "uploaded",
      };

      setCandidates(
        (current) =>
          appendAssetCandidate(
            current,
            candidate,
          ),
      );

      setUploadFile(
        null,
      );

      setMessage(
        candidates.length >=
        MAX_ASSET_CANDIDATES
          ? "Uploaded image replaced candidate slot 5."
          : "Uploaded image added as an Asset candidate.",
      );
    } catch (
      cause
    ) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Asset upload failed.",
      );

      setMessage("");
    } finally {
      setUploading(false);
    }
  }

  function clearCandidate(
    id: string,
  ) {
    setCandidates(
      (current) =>
        removeAssetCandidate(
          current,
          id,
        ),
    );

    if (
      editingCandidateId ===
      id
    ) {
      setEditingCandidateId(
        "",
      );
      setEditInstruction(
        "",
      );
      setEditNegativePrompt(
        "",
      );
    }

    setMessage(
      "Candidate cleared.",
    );

    setError("");
  }

  async function saveCandidateForLater(
    candidate:
      AssetCandidate,
  ) {
    if (
      busyCandidateId
    ) {
      return;
    }

    setBusyCandidateId(
      candidate.id,
    );
    setError("");
    setMessage(
      "Saving Asset candidate for later...",
    );

    try {
      const imageResponse =
        await fetch(
          candidate.imageUrl,
          {
            cache:
              "no-store",
            credentials:
              "include",
          },
        );

      if (
        !imageResponse.ok
      ) {
        throw new Error(
          `Could not read Asset candidate (${imageResponse.status}).`,
        );
      }

      const blob =
        await imageResponse.blob();

      const form =
        new FormData();

      form.set(
        "assetName",
        candidate.name,
      );

      form.set(
        "source",
        candidate.source,
      );

      form.set(
        "modelId",
        candidate.modelId ||
          "",
      );

      form.set(
        "modelLabel",
        candidate.modelLabel ||
          "",
      );

      form.set(
        "artStyle",
        candidate.artStyle ||
          "",
      );

      form.set(
        "prompt",
        candidate.prompt ||
          "",
      );

      form.set(
        "promptId",
        candidate.promptId ||
          "",
      );

      form.set(
        "seed",
        String(
          candidate.seed ||
            0,
        ),
      );

      form.set(
        "workflowId",
        candidate.workflowId ||
          "",
      );

      form.set(
        "internalPrompt",
        candidate.internalPrompt ||
          "",
      );

      form.set(
        "sourceCandidateId",
        candidate.sourceCandidateId ||
          "",
      );

      form.set(
        "rootCandidateId",
        candidate.rootCandidateId ||
          "",
      );

      form.set(
        "editDepth",
        String(
          candidate.editDepth ||
            0,
        ),
      );

      form.set(
        "editInstruction",
        candidate.editInstruction ||
          "",
      );

      form.set(
        "backgroundFree",
        candidate.backgroundFree
          ? "true"
          : "false",
      );

      form.set(
        "image",
        new File(
          [blob],
          `asset-saved-${candidate.id}.png`,
          {
            type:
              blob.type ||
              "image/png",
          },
        ),
      );

      const response =
        await fetch(
          "/api/assets/saved-for-later",
          {
            method:
              "POST",
            credentials:
              "include",
            body: form,
          },
        );

      const payload =
        await readJson(
          response,
        );

      if (
        response.status ===
        401
      ) {
        window.location.href =
          "/login?reason=session";

        return;
      }

      if (
        !response.ok ||
        !payload?.ok
      ) {
        throw new Error(
          text(
            payload?.error,
          ) ||
            `Save for Later failed (${response.status}).`,
        );
      }

      await loadSavedForLater();

      setMessage(
        "Asset candidate saved for later.",
      );
    } catch (
      cause
    ) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Save for Later failed.",
      );

      setMessage("");
    } finally {
      setBusyCandidateId(
        "",
      );
    }
  }

  function openCandidateEdit(
    candidate:
      AssetCandidate,
  ) {
    if (
      busyCandidateId
    ) {
      return;
    }

    setEditingCandidateId(
      candidate.id,
    );

    setEditInstruction(
      "",
    );

    setEditNegativePrompt(
      "",
    );

    setError("");
    setMessage(
      "Describe the change for Qwen Image Edit.",
    );
  }

  async function applyCandidateEdit() {
    if (
      busyCandidateId
    ) {
      return;
    }

    const source =
      candidates.find(
        (candidate) =>
          candidate.id ===
          editingCandidateId,
      );

    if (!source) {
      setError(
        "The Asset candidate selected for editing is no longer available.",
      );

      return;
    }

    const requestedChange =
      editInstruction.trim();

    if (
      !requestedChange
    ) {
      setError(
        "Describe the Asset change you want Qwen Image Edit to make.",
      );

      return;
    }

    setBusyCandidateId(
      source.id,
    );

    setError("");
    setMessage(
      "Preparing the Asset candidate for Qwen Image Edit 2509...",
    );

    try {
      const stable =
        await ensureStableCandidate(
          source,
        );

      const edited =
        await executeAssetCandidateEdit(
          {
            source:
              editableAssetCandidate(
                stable,
              ),
            requestedChange,
            negativePrompt:
              editNegativePrompt.trim(),
            seed:
              randomAssetSeed(),
            requestInit: {
              credentials:
                "include",
              headers: {
                "x-otg-device-id":
                  getAssetDeviceId(),
              },
            },
            resolveOutput:
              async (
                promptId,
                selector,
              ) =>
                waitForAssetWorkflowImage(
                  {
                    promptId,
                    nodeId:
                      selector.nodeId,
                    filenamePrefix:
                      selector.filenamePrefix,
                    timeoutMs:
                      10 *
                      60 *
                      1000,
                  },
                ),
            persistOutput:
              (
                outputUrl,
                filename,
              ) =>
                copyAssetImageToUpload(
                  outputUrl,
                  filename.replace(
                    /\.[^.]+$/,
                    "",
                  ),
                  stable.name,
                ),
            makeCandidateId:
              () =>
                candidateId(
                  "edited",
                ),
            onSubmitted:
              (job) =>
                setMessage(
                  `Qwen Image Edit submitted. Prompt ${job.promptId}. Waiting for output...`,
                ),
          },
        );

      const next:
        AssetCandidate = {
        ...stable,
        id:
          edited.id,
        imageUrl:
          edited.url,
        serverPath:
          text(
            edited.serverPath,
          ),
        source:
          "edited",
        modelLabel:
          "Qwen Image Edit 2509",
        prompt:
          requestedChange,
        promptId:
          edited.promptId ||
          stable.promptId,
        workflowId:
          edited.workflowId,
        internalPrompt:
          edited.internalPrompt,
        sourceCandidateId:
          edited.sourceCandidateId,
        rootCandidateId:
          edited.rootCandidateId,
        editDepth:
          edited.editDepth,
        editInstruction:
          edited.editInstruction,
        backgroundFree:
          edited.backgroundFree,
      };

      setCandidates(
        (current) =>
          appendAssetCandidate(
            current,
            next,
          ),
      );

      setEditingCandidateId(
        "",
      );

      setEditInstruction(
        "",
      );

      setEditNegativePrompt(
        "",
      );

      setMessage(
        candidates.length >=
        MAX_ASSET_CANDIDATES
          ? "Qwen edit complete. The edited result replaced slot 5."
          : "Qwen edit complete. The edited result was added as a new candidate.",
      );
    } catch (
      cause
    ) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Qwen Image Edit failed.",
      );

      setMessage("");
    } finally {
      setBusyCandidateId(
        "",
      );
    }
  }

  async function useCandidate(
    candidate:
      AssetCandidate,
  ) {
    if (
      busyCandidateId
    ) {
      return;
    }

    setBusyCandidateId(
      candidate.id,
    );

    setError("");
    setMessage(
      "Preparing the selected Asset for its 1080x1080 SeedVR Master...",
    );

    try {
      const sourceResponse =
        await fetch(
          candidate.imageUrl,
          {
            cache:
              "no-store",
            credentials:
              "include",
          },
        );

      if (
        !sourceResponse.ok
      ) {
        throw new Error(
          `Could not read the selected Asset candidate (${sourceResponse.status}).`,
        );
      }

      const sourceBlob =
        await sourceResponse.blob();

      if (
        !sourceBlob.size
      ) {
        throw new Error(
          "The selected Asset candidate image was empty.",
        );
      }

      const prepareForm =
        new FormData();

      prepareForm.set(
        "image",
        new File(
          [sourceBlob],
          `${candidate.id}-asset-master-source.png`,
          {
            type:
              sourceBlob.type ||
              "image/png",
          },
        ),
      );

      const prepareResponse =
        await fetch(
          "/api/assets/master-upscale",
          {
            method:
              "POST",
            credentials:
              "include",
            cache:
              "no-store",
            body:
              prepareForm,
          },
        );

      if (
        !prepareResponse.ok
      ) {
        const payload =
          await readJson(
            prepareResponse,
          );

        throw new Error(
          text(
            payload?.error,
          ) ||
            `Asset Master preprocessing failed (${prepareResponse.status}).`,
        );
      }

      const preparedBlob =
        await prepareResponse.blob();

      if (
        !preparedBlob.size
      ) {
        throw new Error(
          "Asset Master preprocessing returned an empty image.",
        );
      }

      const outputPrefix =
        `otg-asset-master-${candidate.id}-${Date.now()}`;

      setMessage(
        "Submitting the prepared Asset to SeedVR2 on the RTX 3090...",
      );

      const body =
        new FormData();

      body.set(
        "workflowId",
        ASSET_MASTER_WORKFLOW_ID,
      );

      body.set(
        "workflowFile",
        ASSET_MASTER_WORKFLOW_FILE,
      );

      body.set(
        "workflowLabel",
        "Asset Master SeedVR2 1080p",
      );

      body.set(
        "requestKind",
        "asset-master-seedvr",
      );

      body.set(
        "sourceType",
        "asset-master-seedvr",
      );

      body.set(
        "gpuTarget",
        "rtx3090",
      );

      body.set(
        "loadImageNodeId",
        "1",
      );

      body.set(
        "saveImageNodeId",
        ASSET_MASTER_OUTPUT_NODE,
      );

      body.set(
        "filenamePrefix",
        outputPrefix,
      );

      body.set(
        "filename_prefix",
        outputPrefix,
      );

      body.set(
        "title",
        candidate.name,
      );

      body.set(
        "saveToGallery",
        "false",
      );

      body.set(
        "save_to_gallery",
        "false",
      );

      body.set(
        "persistToGallery",
        "false",
      );

      body.set(
        "addToGallery",
        "false",
      );

      body.set(
        "copyToGallery",
        "false",
      );

      body.set(
        "writeToGallery",
        "false",
      );

      body.set(
        "gallery",
        "false",
      );

      body.set(
        "skipGallery",
        "true",
      );

      body.set(
        "skipGeneralGallery",
        "true",
      );

      body.set(
        "assetLibraryOnly",
        "true",
      );

      body.set(
        "outputLibrary",
        "assets",
      );

      body.set(
        "galleryExclusionPolicy",
        "asset-master-only",
      );

      body.set(
        "imageA",
        new File(
          [preparedBlob],
          `${candidate.id}-asset-master-seedvr-input.png`,
          {
            type:
              "image/png",
          },
        ),
      );

      const submitResponse =
        await fetch(
          "/api/comfy",
          {
            method:
              "POST",
            credentials:
              "include",
            cache:
              "no-store",
            headers: {
              "x-otg-device-id":
                getAssetDeviceId(),
            },
            body,
          },
        );

      const submit =
        await readJson(
          submitResponse,
        );

      if (
        !submitResponse.ok ||
        submit?.ok ===
          false
      ) {
        throw new Error(
          text(
            submit?.error,
          ) ||
            `Asset Master SeedVR submission failed (${submitResponse.status}).`,
        );
      }

      const masterPromptId =
        text(
          submit.prompt_id ||
            submit.promptId,
        );

      if (
        !masterPromptId
      ) {
        throw new Error(
          "Asset Master SeedVR workflow was accepted but returned no prompt id.",
        );
      }

      setMessage(
        `SeedVR2 Master queued. Prompt ${masterPromptId}. Waiting for output node ${ASSET_MASTER_OUTPUT_NODE}...`,
      );

      const master =
        await waitForAssetWorkflowImage(
          {
            promptId:
              masterPromptId,
            nodeId:
              ASSET_MASTER_OUTPUT_NODE,
            // OTG_ASSET_MASTER_HISTORY_NODE_MATCH_PP06_V1
            // The SeedVR workflow can emit ComfyUI temp filenames even when
            // filenamePrefix is supplied at submission. promptId + output
            // node uniquely identify the canonical Asset Master result.
            timeoutMs:
              15 *
              60 *
              1000,
          },
        );

      await validateAssetMasterDimensions(
        master.url,
      );

      setMessage(
        "SeedVR2 Master validated at 1080x1080. Saving the canonical Asset...",
      );

      const masterUpload =
        await copyAssetImageToUpload(
          master.url,
          `${candidate.id}-master-1080`,
          candidate.name,
        );

      const saveResponse =
        await fetch(
          "/api/assets",
          {
            method:
              "POST",
            credentials:
              "include",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                action:
                  "save",
                asset: {
                  name:
                    candidate.name,
                  description:
                    assetIdentityDescription(
                      candidate,
                    ),
                  defaultImage: {
                    displayImage:
                      masterUpload.fileUrl,
                    workflowImage:
                      masterUpload.serverPath,
                  },
                  perspectives: {},
                },
              }),
          },
        );

      const saved =
        await readJson(
          saveResponse,
        );

      if (
        saveResponse.status ===
        401
      ) {
        window.location.href =
          "/login?reason=session";

        return;
      }

      if (
        !saveResponse.ok ||
        !saved?.ok ||
        !saved?.asset
      ) {
        throw new Error(
          text(
            saved?.error,
          ) ||
            `Could not save the final Asset (${saveResponse.status}).`,
        );
      }

      await loadLibrary();

      setMode(
        "library",
      );

      setMessage(
        `${candidate.name} is now a canonical 1080x1080 Asset and is available to Production.`,
      );
    } catch (
      cause
    ) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Asset finalization failed.",
      );

      setMessage("");
    } finally {
      setBusyCandidateId(
        "",
      );
    }
  }

  function restoreSavedCandidate(
    item:
      SavedAssetCandidate,
  ) {
    const candidate:
      AssetCandidate = {
      id:
        candidateId(
          "restored",
        ),
      name:
        item.name,
      imageUrl:
        item.imageUrl,
      serverPath:
        item.serverPath,
      source:
        "saved",
      modelId:
        ASSET_IMAGE_MODELS.some(
          (model) =>
            model.id ===
            item.modelId,
        )
          ? item.modelId as AssetImageModelId
          : undefined,
      modelLabel:
        item.modelLabel,
      artStyle:
        item.artStyle,
      prompt:
        item.prompt,
      promptId:
        item.promptId,
      seed:
        item.seed,
      workflowId:
        item.workflowId,
      internalPrompt:
        item.internalPrompt,
      sourceCandidateId:
        item.sourceCandidateId,
      rootCandidateId:
        item.rootCandidateId,
      editDepth:
        item.editDepth,
      editInstruction:
        item.editInstruction,
      backgroundFree:
        item.backgroundFree,
    };

    setCandidates(
      (current) =>
        appendAssetCandidate(
          current,
          candidate,
        ),
    );

    setAssetName(
      item.name,
    );

    if (
      item.artStyle
    ) {
      setArtStyle(
        item.artStyle,
      );
    }

    if (
      item.prompt
    ) {
      setPrompt(
        item.prompt,
      );
    }

    setMode(
      "create",
    );

    setError("");
    setMessage(
      "Saved Asset candidate restored to the candidate slots.",
    );
  }

  async function deleteSavedCandidate(
    item:
      SavedAssetCandidate,
  ) {
    try {
      const response =
        await fetch(
          `/api/assets/saved-for-later?id=${encodeURIComponent(item.id)}`,
          {
            method:
              "DELETE",
            credentials:
              "include",
          },
        );

      const payload =
        await readJson(
          response,
        );

      if (
        !response.ok ||
        !payload?.ok
      ) {
        throw new Error(
          text(
            payload?.error,
          ) ||
            `Could not delete saved candidate (${response.status}).`,
        );
      }

      await loadSavedForLater();

      setMessage(
        "Saved Asset candidate deleted.",
      );
    } catch (
      cause
    ) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not delete saved candidate.",
      );
    }
  }

  const editingCandidate =
    candidates.find(
      (candidate) =>
        candidate.id ===
        editingCandidateId,
    ) ||
    null;

  const visibleLibrary =
    React.useMemo(
      () => {
        const query =
          search
            .trim()
            .toLowerCase();

        const rows =
          library.filter(
            (item) => {
              if (!query) {
                return true;
              }

              return [
                item.name,
                item.identityDescription,
              ]
                .join(" ")
                .toLowerCase()
                .includes(
                  query,
                );
            },
          );

        rows.sort(
          (a, b) => {
            if (
              sort ===
              "name"
            ) {
              return a.name.localeCompare(
                b.name,
              );
            }

            if (
              sort ===
              "oldest"
            ) {
              return (
                a.createdAt -
                b.createdAt
              );
            }

            return (
              b.createdAt -
              a.createdAt
            );
          },
        );

        return rows;
      },
      [
        library,
        search,
        sort,
      ],
    );

  return (
    <div
      className="space-y-5"
      data-otg="character-asset-gallery"
    >
      <section className="rounded-[30px] border border-blue-300/20 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.22),transparent_42%),rgba(2,8,16,0.94)] p-5 sm:p-7">
        <button
          type="button"
          onClick={
            onBack
          }
          className="mb-4 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm font-bold text-white/70 hover:bg-white/10"
        >
          ← Characters
        </button>

        <div className="text-xs font-black uppercase tracking-[0.22em] text-blue-200/65">
          Reusable Production
          Assets
        </div>

        <h2 className="mt-2 text-3xl font-black text-white">
          Asset Gallery
        </h2>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
          Create reusable production
          props and objects, upload an
          existing image, save
          candidates for later, edit
          them with Qwen Image Edit,
          and turn the selected image
          into one canonical 1080
          Asset reference.
        </p>
      </section>

      <section
        className="rounded-[26px] border border-white/10 bg-black/25 p-4"
        data-otg="asset-gallery-workspace-tabs"
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            [
              "create",
              "Create Asset",
            ],
            [
              "upload",
              "Upload Asset",
            ],
            [
              "library",
              "Asset Library",
            ],
          ].map(
            ([
              value,
              label,
            ]) => (
              <button
                key={value}
                type="button"
                aria-pressed={
                  mode ===
                  value
                }
                onClick={() => {
                  setMode(
                    value as AssetWorkspaceMode,
                  );
                  setError(
                    "",
                  );
                }}
                className={`min-h-12 rounded-xl border px-4 text-sm font-black transition ${
                  mode ===
                  value
                    ? "border-blue-300/40 bg-blue-400/15 text-blue-50"
                    : "border-white/10 bg-black/30 text-white/55 hover:bg-white/[0.06]"
                }`}
              >
                {label}
              </button>
            ),
          )}
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-300/25 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-blue-300/20 bg-blue-400/[0.08] p-4 text-sm text-blue-50">
          {message}
        </div>
      ) : null}

      {mode ===
      "create" ? (
        <section
          className="rounded-[28px] border border-white/10 bg-black/25 p-5 sm:p-6"
          data-otg="create-asset-workspace"
        >
          <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-200/65">
            Create Asset
          </div>

          <h3 className="mt-2 text-2xl font-black text-white">
            Generate a reusable
            production Asset
          </h3>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
                Asset Name
              </span>

              <input
                value={
                  assetName
                }
                onChange={(
                  event,
                ) =>
                  setAssetName(
                    event.target
                      .value,
                  )
                }
                maxLength={
                  120
                }
                placeholder="Ancient sword"
                className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/45 px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-blue-300/40"
                data-otg="asset-name-input"
              />
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
                Image Model
              </span>

              <select
                value={
                  modelId
                }
                onChange={(
                  event,
                ) =>
                  setModelId(
                    event.target
                      .value as AssetImageModelId,
                  )
                }
                className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/45 px-4 text-sm font-bold text-white"
                data-otg="asset-image-model-select"
              >
                {ASSET_IMAGE_MODELS.map(
                  (
                    model,
                  ) => (
                    <option
                      key={
                        model.id
                      }
                      value={
                        model.id
                      }
                    >
                      {
                        model.label
                      }
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
                Art Style
              </span>

              <select
                value={
                  artStyle
                }
                onChange={(
                  event,
                ) =>
                  setArtStyle(
                    event.target
                      .value,
                  )
                }
                className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/45 px-4 text-sm font-bold text-white"
                data-otg="asset-art-style-select"
              >
                {ASSET_ART_STYLES.map(
                  (
                    style,
                  ) => (
                    <option
                      key={
                        style
                      }
                      value={
                        style
                      }
                    >
                      {style}
                    </option>
                  ),
                )}
              </select>
            </label>

            <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-xs leading-6 text-white/40">
              Use creates one
              canonical Asset image.
              It does not create
              additional reference
              views.
            </div>
          </div>

          <label className="mt-5 block">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
              Prompt
            </span>

            <textarea
              value={
                prompt
              }
              onChange={(
                event,
              ) =>
                setPrompt(
                  event.target
                    .value,
                )
              }
              rows={5}
              maxLength={
                4000
              }
              placeholder="Describe the object, shape, materials, colors, markings, proportions, and continuity-critical details..."
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/45 p-4 text-sm leading-6 text-white outline-none placeholder:text-white/25 focus:border-blue-300/40"
              data-otg="asset-prompt-input"
            />
          </label>

          <div
            className="mt-3 flex flex-wrap items-center gap-3"
            data-otg="asset-enhance-prompt-controls"
          >
            <button
              type="button"
              onClick={() =>
                void enhanceAssetPrompt()
              }
              disabled={
                enhancingPrompt ||
                !prompt.trim()
              }
              className="min-h-11 rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-5 text-sm font-black text-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
              data-otg="asset-enhance-prompt-button"
            >
              {enhancingPrompt
                ? "Enhancing..."
                : "Enhance Prompt"}
            </button>

            <div className="inline-flex overflow-hidden rounded-xl border border-white/10 bg-black/30">
              {ASSET_PROMPT_ENHANCE_LEVELS.map(
                (
                  level,
                ) => (
                  <button
                    key={
                      level.key
                    }
                    type="button"
                    aria-pressed={
                      assetPromptEnhanceLevel ===
                      level.key
                    }
                    onClick={() =>
                      setAssetPromptEnhanceLevel(
                        level.key,
                      )
                    }
                    className={`min-h-11 px-4 text-xs font-black transition ${
                      assetPromptEnhanceLevel ===
                      level.key
                        ? "bg-emerald-300 text-slate-950"
                        : "text-white/55 hover:bg-white/[0.06]"
                    }`}
                  >
                    {level.label}
                  </button>
                ),
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              void generateAsset()
            }
            disabled={
              generating ||
              !assetName.trim() ||
              !prompt.trim()
            }
            className="mt-5 min-h-12 rounded-xl bg-blue-300 px-6 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            data-otg="asset-generate-button"
          >
            {generating
              ? "Generating..."
              : "Generate"}
          </button>
        </section>
      ) : null}

      {mode ===
      "upload" ? (
        <section
          className="rounded-[28px] border border-white/10 bg-black/25 p-5 sm:p-6"
          data-otg="upload-asset-workspace"
        >
          <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-200/65">
            Upload Asset
          </div>

          <h3 className="mt-2 text-2xl font-black text-white">
            Add an existing Asset
            image
          </h3>

          <label className="mt-5 block">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
              Asset Name
            </span>

            <input
              value={
                assetName
              }
              onChange={(
                event,
              ) =>
                setAssetName(
                  event.target
                    .value,
                )
              }
              maxLength={
                120
              }
              placeholder="Hero motorcycle"
              className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/45 px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-blue-300/40"
              data-otg="asset-upload-name-input"
            />
          </label>

          <label className="mt-5 block">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
              Asset Image
            </span>

            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(
                event,
              ) =>
                setUploadFile(
                  event.target
                    .files?.[0] ||
                    null,
                )
              }
              className="mt-2 block w-full rounded-xl border border-white/10 bg-black/45 p-3 text-sm text-white/70"
              data-otg="asset-upload-file-input"
            />
          </label>

          {uploadFile ? (
            <div className="mt-3 text-xs text-white/40">
              Selected:{" "}
              {uploadFile.name}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() =>
              void uploadAsset()
            }
            disabled={
              uploading ||
              !assetName.trim() ||
              !uploadFile
            }
            className="mt-5 min-h-12 rounded-xl bg-blue-300 px-6 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            data-otg="asset-upload-button"
          >
            {uploading
              ? "Uploading..."
              : "Upload Asset"}
          </button>
        </section>
      ) : null}

      {mode !==
      "library" ? (
        <>
          <CandidateSlots
            candidates={
              candidates
            }
            busyCandidateId={
              busyCandidateId
            }
            onClear={
              clearCandidate
            }
            onSave={(
              candidate,
            ) =>
              void saveCandidateForLater(
                candidate,
              )
            }
            onEdit={
              openCandidateEdit
            }
            onUse={(
              candidate,
            ) =>
              void useCandidate(
                candidate,
              )
            }
          />

          {editingCandidate ? (
            <section
              className="rounded-[28px] border border-violet-300/20 bg-violet-400/[0.055] p-5"
              data-otg="asset-qwen-edit"
            >
              <div className="text-xs font-black uppercase tracking-[0.2em] text-violet-200/70">
                Qwen Image Edit
              </div>

              <h3 className="mt-2 text-xl font-black text-white">
                Edit{" "}
                {
                  editingCandidate.name
                }
              </h3>

              <label className="mt-4 block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
                  Requested Change
                </span>

                <textarea
                  value={
                    editInstruction
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditInstruction(
                      event.target
                        .value,
                    )
                  }
                  rows={4}
                  placeholder="Example: make the sword blade longer, keep the handle and engravings exactly the same."
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-white outline-none focus:border-violet-300/40"
                />
              </label>

              <label className="mt-4 block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-white/45">
                  Avoid
                </span>

                <textarea
                  value={
                    editNegativePrompt
                  }
                  onChange={(
                    event,
                  ) =>
                    setEditNegativePrompt(
                      event.target
                        .value,
                    )
                  }
                  rows={2}
                  placeholder="Optional details the edit should avoid."
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-white outline-none focus:border-violet-300/40"
                />
              </label>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={
                    Boolean(
                      busyCandidateId,
                    )
                  }
                  onClick={() =>
                    void applyCandidateEdit()
                  }
                  className="min-h-11 rounded-xl bg-violet-300 px-5 text-sm font-black text-slate-950 disabled:opacity-40"
                >
                  Apply Edit
                </button>

                <button
                  type="button"
                  disabled={
                    Boolean(
                      busyCandidateId,
                    )
                  }
                  onClick={() => {
                    setEditingCandidateId(
                      "",
                    );
                    setEditInstruction(
                      "",
                    );
                    setEditNegativePrompt(
                      "",
                    );
                  }}
                  className="min-h-11 rounded-xl border border-white/10 bg-black/25 px-5 text-sm font-black text-white/65 disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {mode ===
      "library" ? (
        <section
          className="space-y-5"
          data-otg="asset-library-workspace"
        >
          <div className="rounded-[28px] border border-white/10 bg-black/25 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-200/65">
                  Asset Library
                </div>

                <h3 className="mt-2 text-2xl font-black text-white">
                  Canonical Assets
                </h3>
              </div>

              <button
                type="button"
                onClick={() => {
                  void loadLibrary();
                  void loadSavedForLater();
                }}
                disabled={
                  libraryLoading ||
                  savedLoading
                }
                className="min-h-10 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-black text-white/65 disabled:opacity-40"
              >
                {libraryLoading ||
                savedLoading
                  ? "Refreshing..."
                  : "Refresh"}
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={
                  search
                }
                onChange={(
                  event,
                ) =>
                  setSearch(
                    event.target
                      .value,
                  )
                }
                placeholder="Search Asset Library"
                className="min-h-12 rounded-xl border border-white/10 bg-black/45 px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-blue-300/40"
              />

              <select
                value={
                  sort
                }
                onChange={(
                  event,
                ) =>
                  setSort(
                    event.target
                      .value as AssetSort,
                  )
                }
                className="min-h-12 rounded-xl border border-white/10 bg-black/45 px-4 text-sm font-bold text-white"
              >
                <option value="newest">
                  Newest first
                </option>

                <option value="oldest">
                  Oldest first
                </option>

                <option value="name">
                  Name
                </option>
              </select>
            </div>

            <div className="mt-3 text-sm text-white/40">
              {
                visibleLibrary.length
              }{" "}
              canonical Asset
              {visibleLibrary.length ===
              1
                ? ""
                : "s"}
            </div>
          </div>

          {!libraryLoading &&
          !visibleLibrary.length ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-8 text-center">
              <div className="font-black text-white/70">
                No canonical Assets
              </div>

              <p className="mt-2 text-sm text-white/40">
                Choose Use on a
                candidate to create its
                SeedVR2 master and add
                it here.
              </p>
            </div>
          ) : null}

          {visibleLibrary.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleLibrary.map(
                (
                  item,
                ) => (
                  <article
                    key={
                      item.id
                    }
                    className="overflow-hidden rounded-[24px] border border-white/10 bg-black/30"
                  >
                    <div className="flex aspect-square items-center justify-center bg-black/45">
                      {item.imageUrl ? (
                        <img
                          src={
                            item.imageUrl
                          }
                          alt={
                            item.name
                          }
                          loading="lazy"
                          draggable={
                            false
                          }
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="p-4 text-center text-xs font-bold text-white/25">
                          Preview
                          unavailable
                        </div>
                      )}
                    </div>

                    <div className="p-4">
                      <div className="truncate font-black text-white">
                        {
                          item.name
                        }
                      </div>

                      {item.identityDescription ? (
                        <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/40">
                          {
                            item.identityDescription
                          }
                        </p>
                      ) : null}

                      {item.createdAt ? (
                        <div className="mt-3 text-xs text-white/30">
                          {new Date(
                            item.createdAt,
                          ).toLocaleString()}
                        </div>
                      ) : null}
                    </div>
                  </article>
                ),
              )}
            </div>
          ) : null}

          <section className="rounded-[28px] border border-emerald-300/15 bg-emerald-400/[0.04] p-5">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-200/65">
              Saved for Later
            </div>

            <h3 className="mt-2 text-xl font-black text-white">
              Unfinished Asset
              Candidates
            </h3>

            {savedLoading ? (
              <div className="mt-4 text-sm text-white/40">
                Loading saved
                candidates...
              </div>
            ) : null}

            {!savedLoading &&
            !savedForLater.length ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-5 text-sm text-white/40">
                No Asset candidates
                are saved for later.
              </div>
            ) : null}

            {savedForLater.length ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {savedForLater.map(
                  (
                    item,
                  ) => (
                    <article
                      key={
                        item.id
                      }
                      className="overflow-hidden rounded-2xl border border-white/10 bg-black/30"
                    >
                      <div className="flex aspect-square items-center justify-center bg-black/40">
                        <img
                          src={
                            item.imageUrl
                          }
                          alt={
                            item.name
                          }
                          loading="lazy"
                          className="h-full w-full object-contain"
                        />
                      </div>

                      <div className="p-3">
                        <div className="truncate text-sm font-black text-white">
                          {
                            item.name
                          }
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              restoreSavedCandidate(
                                item,
                              )
                            }
                            className="min-h-9 rounded-lg bg-emerald-300 px-2 text-xs font-black text-slate-950"
                          >
                            Restore
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              void deleteSavedCandidate(
                                item,
                              )
                            }
                            className="min-h-9 rounded-lg border border-red-300/20 bg-red-400/10 px-2 text-xs font-black text-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  ),
                )}
              </div>
            ) : null}
          </section>
        </section>
      ) : null}
    </div>
  );
}
