import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  OTG_DATA_ROOT,
  ensureDir,
} from "@/lib/paths";

import {
  applyProductionV2DeterministicDialogueSequence,
  buildProductionPrompt,
  buildProductionV2SceneEnhancementInstruction,
  buildProductionV2SceneRepairInstruction,
  validateProductionV2ScenePromptForModel,
} from "@/lib/production/promptBuilder";

import {
  buildLtx25VisionEnhancementInstruction,
  buildLtx25VisionRepairInstruction,
  prepareLtx25VisionPrompt,
} from "@/lib/production/ltx25VisionPrompt";

import type {
  ProductionV2ReferencePlan,
  ProductionV2Scene,
} from "@/lib/production/v2";

import {
  QWEN_CLUSTER_MODEL,
} from "@/lib/workers/qwenClusterRouter";

import {
  ensureQwenDurableJob,
  getQwenDurableJob,
  type QwenDurableJob,
} from "@/lib/workers/qwenDurableJobs";

import {
  kickQwenDurableScheduler,
} from "@/lib/workers/qwenDurableScheduler";

/*
 * OTG_PRODUCTION_V2_PROMPT_OPERATION_V1
 *
 * Browser-independent Production V2 Scene Prompt orchestration.
 *
 * The operation itself is durable.
 * Its enhancement and repair Qwen children use deterministic IDs.
 *
 * A process restart can therefore resume orchestration without
 * creating duplicate inference requests.
 */

type PromptValidation =
  ReturnType<
    typeof validateProductionV2ScenePromptForModel
  >;

export type ProductionV2PromptBuildResult = {
  ok: true;
  provider: string;
  repaired: boolean;
  builderId: string;
  lockedReferenceContext: string;
  scenePrompt: string;
  finalPrompt: string;
  referencePlan: ProductionV2ReferencePlan;
  validation: PromptValidation;
};

export type ProductionV2PromptOperationStatus =
  | "queued"
  | "waiting_for_qwen"
  | "completed"
  | "failed";

export type ProductionV2PromptOperationStage =
  | "enhancement"
  | "repair";

export type ProductionV2PromptOperation = {
  schemaVersion: 1;
  id: string;
  ownerKey: string;

  status:
    ProductionV2PromptOperationStatus;

  stage:
    ProductionV2PromptOperationStage;

  statusMessage: string;

  scene:
    ProductionV2Scene;

  enhancementJobId:
    string | null;

  repairJobId:
    string | null;

  enhancementScenePrompt:
    string | null;

  validation:
    PromptValidation | null;

  result:
    ProductionV2PromptBuildResult | null;

  error:
    string | null;

  createdAt: string;
  updatedAt: string;
};

export type ProductionV2PromptOperationDependencies = {
  ensureJob?:
    typeof ensureQwenDurableJob;

  getJob?:
    typeof getQwenDurableJob;

  kickQwen?:
    () => void;

  sleep?:
    (
      milliseconds: number,
    ) => Promise<void>;
};

const PRODUCTION_V2_OLLAMA_MODEL =
  String(
    process.env.PRODUCTION_V2_OLLAMA_MODEL
    || "qwen3.5:4b",
  ).trim();

const PRODUCTION_V2_OLLAMA_FALLBACK_MODEL =
  String(
    process.env.PRODUCTION_V2_OLLAMA_FALLBACK_MODEL
    || QWEN_CLUSTER_MODEL,
  ).trim();

/*
 * OTG_PRODUCTION_V2_LTX_DURABLE_QWEN_V1
 *
 * H3 keeps its existing Qwen model and node routing unchanged.
 *
 * LTX Ingredients vision prompting:
 * - uses its own model setting
 * - runs on SHAWN only
 * - uses the existing deterministic durable child-job mechanism
 */
const PRODUCTION_V2_LTX_OLLAMA_MODEL =
  String(
    process.env.PRODUCTION_V2_LTX_OLLAMA_MODEL
    || "qwen3.5:4b",
  ).trim();

function isLtxVisionPromptScene(
  scene: ProductionV2Scene,
) {
  return (
    scene.model
    === "ltx-2.5"
    && scene.generationMode
    === "ltx-ingredients-image-to-video"
  );
}

let storeRootOverrideForTests:
  string | null =
    null;

function nowIso() {
  return new Date().toISOString();
}

function configuredRoot() {
  return (
    storeRootOverrideForTests
    || path.join(
      OTG_DATA_ROOT,
      "production-v2-prompt-operations",
    )
  );
}

export function setProductionV2PromptOperationStoreRootForTests(
  value: string | null,
) {
  storeRootOverrideForTests =
    value;
}

function validOperationId(
  value: string,
) {
  return /^promptop_[A-Za-z0-9-]{1,100}$/.test(
    value,
  );
}

function operationFile(
  operationId: string,
) {
  if (
    !validOperationId(
      operationId,
    )
  ) {
    throw new Error(
      "Invalid Production V2 prompt operation id.",
    );
  }

  const root =
    configuredRoot();

  ensureDir(
    root,
  );

  return path.join(
    root,
    `${operationId}.json`,
  );
}

function readJson(
  filePath: string,
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8",
      ),
    ) as unknown;
  } catch {
    return null;
  }
}

function writeJsonAtomic(
  filePath: string,
  value: unknown,
) {
  ensureDir(
    path.dirname(
      filePath,
    ),
  );

  const temporaryPath =
    `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );

  fs.renameSync(
    temporaryPath,
    filePath,
  );
}

function isOperation(
  value: unknown,
): value is ProductionV2PromptOperation {
  if (
    !value
    || typeof value !== "object"
  ) {
    return false;
  }

  const record =
    value as
      Record<string, unknown>;

  return (
    record.schemaVersion === 1
    && typeof record.id === "string"
    && validOperationId(
      record.id,
    )
    && typeof record.ownerKey === "string"
    && (
      record.status === "queued"
      || record.status === "waiting_for_qwen"
      || record.status === "completed"
      || record.status === "failed"
    )
    && (
      record.stage === "enhancement"
      || record.stage === "repair"
    )
    && typeof record.scene === "object"
    && record.scene !== null
  );
}

export function getProductionV2PromptOperation(
  operationId: string,
) {
  if (
    !validOperationId(
      operationId,
    )
  ) {
    return null;
  }

  const value =
    readJson(
      operationFile(
        operationId,
      ),
    );

  return isOperation(
    value,
  )
    ? value
    : null;
}

function saveOperation(
  operation:
    ProductionV2PromptOperation,
) {
  const next = {
    ...operation,
    updatedAt:
      nowIso(),
  };

  writeJsonAtomic(
    operationFile(
      next.id,
    ),
    next,
  );

  return next;
}

function patchOperation(
  operation:
    ProductionV2PromptOperation,
  patch:
    Partial<
      ProductionV2PromptOperation
    >,
) {
  return saveOperation({
    ...operation,
    ...patch,

    id:
      operation.id,

    ownerKey:
      operation.ownerKey,

    schemaVersion:
      1,
  });
}

export function createProductionV2PromptOperation(
  ownerKey: string,
  scene: ProductionV2Scene,
) {
  const id =
    `promptop_${crypto.randomUUID()}`;

  const timestamp =
    nowIso();

  const operation:
    ProductionV2PromptOperation = {
      schemaVersion:
        1,

      id,

      ownerKey:
        String(
          ownerKey
          || "",
        ).trim(),

      status:
        "queued",

      stage:
        "enhancement",

      statusMessage:
        "Scene Prompt queued. Waiting for the prompt model.",

      scene,

      enhancementJobId:
        null,

      repairJobId:
        null,

      enhancementScenePrompt:
        null,

      validation:
        null,

      result:
        null,

      error:
        null,

      createdAt:
        timestamp,

      updatedAt:
        timestamp,
    };

  writeJsonAtomic(
    operationFile(
      operation.id,
    ),
    operation,
  );

  return operation;
}

export function listActiveProductionV2PromptOperations() {
  const root =
    configuredRoot();

  ensureDir(
    root,
  );

  return fs
    .readdirSync(
      root,
      {
        withFileTypes:
          true,
      },
    )
    .filter(
      (entry) =>
        entry.isFile()
        && entry.name.startsWith(
          "promptop_",
        )
        && entry.name.endsWith(
          ".json",
        ),
    )
    .map(
      (entry) =>
        readJson(
          path.join(
            root,
            entry.name,
          ),
        ),
    )
    .filter(
      isOperation,
    )
    .filter(
      (operation) =>
        operation.status
          !== "completed"
        && operation.status
          !== "failed",
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(
          right.createdAt,
        ),
    );
}

function executionTimeoutMs() {
  return Math.max(
    15_000,
    Math.min(
      180_000,
      Number(
        process.env.PRODUCTION_V2_PROMPT_TIMEOUT_MS
        || 120_000,
      ),
    ),
  );
}

function childJobId(
  operationId: string,
  stage:
    ProductionV2PromptOperationStage,
) {
  return `qwen_${operationId}_${stage}`;
}

function qwenPayload(
  instruction: string,
  images:
    readonly string[] =
    [],
) {
  return {
    messages: [
      {
        role:
          "system",

        content:
          "Return only the requested final answer. Do not include analysis or planning.",
      },
      {
        role:
          "user",

        content:
          instruction,

        ...(
          images.length
            ? {
                images:
                  [
                    ...images,
                  ],
              }
            : {}
        ),
      },
    ],

    think:
      false,

    stream:
      false,

    options: {
      temperature:
        0.35,

      top_p:
        0.8,

      repeat_penalty:
        1.08,

      num_predict:
        600,
    },
  };
}

async function childInput(
  operation:
    ProductionV2PromptOperation,
  stage:
    ProductionV2PromptOperationStage,
) {
  const timeoutMs =
    executionTimeoutMs();

  const isLtx =
    isLtxVisionPromptScene(
      operation.scene,
    );

  /*
   * LTX prepares the exact canonical manifest images in slot order.
   * H3 never enters this path.
   */
  const ltxVision =
    isLtx
      ? await prepareLtx25VisionPrompt(
          operation.scene,
        )
      : null;

  let instruction =
    "";

  if (
    stage === "enhancement"
  ) {
    instruction =
      ltxVision
        ? buildLtx25VisionEnhancementInstruction(
            operation.scene,
            ltxVision.manifest,
          )
        : buildProductionV2SceneEnhancementInstruction(
            operation.scene,
          );
  } else {
    if (
      !operation.enhancementScenePrompt
    ) {
      throw new Error(
        "Repair stage is missing the enhancement Scene Prompt.",
      );
    }

    const validation =
      operation.validation
      || validateProductionV2ScenePromptForModel(
        operation.scene,
        operation.enhancementScenePrompt,
      );

    instruction =
      ltxVision
        ? buildLtx25VisionRepairInstruction(
            operation.scene,
            ltxVision.manifest,
            operation.enhancementScenePrompt,
            validation.errors,
          )
        : buildProductionV2SceneRepairInstruction(
            operation.scene,
            operation.enhancementScenePrompt,
            validation.errors,
          );
  }

  return {
    /*
     * Deterministic durable child identity is unchanged.
     */
    id:
      childJobId(
        operation.id,
        stage,
      ),

    ownerKey:
      operation.ownerKey,

    requestKind:
      stage === "enhancement"
        ? "production-v2-scene-prompt:enhancement"
        : "production-v2-scene-prompt:repair",

    path:
      "/api/chat" as const,

    payload:
      qwenPayload(
        instruction,
        ltxVision
          ?.images
        || [],
      ),

    requiredContextTokens:
      8192,

    /*
     * Existing H3 routing remains:
     *   slr -> shawn
     *
     * LTX vision-Qwen is SHAWN ONLY.
     */
    allowedNodes:
      isLtx
        ? (
            [
              "shawn",
            ] as const
          )
        : (
            [
              "slr",
              "shawn",
            ] as const
          ),

    model:
      isLtx
        ? PRODUCTION_V2_LTX_OLLAMA_MODEL
        : PRODUCTION_V2_OLLAMA_MODEL,

    modelByNode:
      isLtx
        ? {
            shawn:
              PRODUCTION_V2_LTX_OLLAMA_MODEL,
          }
        : {
            slr:
              PRODUCTION_V2_OLLAMA_MODEL,

            shawn:
              PRODUCTION_V2_OLLAMA_FALLBACK_MODEL,
          },

    keepAlive:
      0,

    executionTimeoutMs:
      timeoutMs,

    leaseTtlSeconds:
      Math.ceil(
        timeoutMs / 1000,
      ) + 30,
  };
}

function parseGeneration(
  job: QwenDurableJob,
  fallbackModel:
    string =
    PRODUCTION_V2_OLLAMA_MODEL,
) {
  if (
    job.status
    !== "completed"
  ) {
    throw new Error(
      `Qwen job ${job.id} is not complete.`,
    );
  }

  const responseStatus =
    Number(
      job.responseStatus
      || 0,
    );

  const body =
    String(
      job.responseBody
      || "",
    );

  let json:
    Record<string, unknown> =
      {};

  try {
    json =
      body
        ? JSON.parse(
            body,
          ) as
            Record<string, unknown>
        : {};
  } catch {
    throw new Error(
      `The local prompt model returned non-JSON output: ${body.slice(0, 160)}`,
    );
  }

  if (
    responseStatus < 200
    || responseStatus >= 300
  ) {
    throw new Error(
      String(
        json.error
        || json.message
        || `Local prompt model failed with HTTP ${responseStatus}.`,
      ),
    );
  }

  const message =
    json.message
    && typeof json.message === "object"
      ? json.message as
          Record<string, unknown>
      : {};

  const output =
    String(
      message.content
      || "",
    ).trim();

  if (!output) {
    throw new Error(
      "The local prompt model returned an empty Scene Prompt.",
    );
  }

  return {
    output,

    model:
      String(
        job.responseHeaders[
          "x-otg-qwen-model"
        ]
        || fallbackModel,
      ),
  };
}

function completedResult(
  operation:
    ProductionV2PromptOperation,
  generation:
    {
      output: string;
      model: string;
    },
  repaired: boolean,
) {
  const scenePrompt =
    isLtxVisionPromptScene(
      operation.scene,
    )
      ? generation.output
          .replace(
            /\s+/g,
            " ",
          )
          .trim()
      : applyProductionV2DeterministicDialogueSequence(
          operation.scene,
          generation.output,
        );

  const validation =
    validateProductionV2ScenePromptForModel(
      operation.scene,
      scenePrompt,
    );

  if (!validation.ok) {
    return {
      scenePrompt,
      validation,
      result:
        null,
    };
  }

  const built =
    buildProductionPrompt({
      model:
        operation.scene.model,

      mode:
        operation.scene.generationMode,

      scene:
        operation.scene,

      references:
        operation.scene.referencePlan,

      dialogue:
        operation.scene.dialogueTurns,

      duration:
        operation.scene.durationSeconds,

      scenePrompt,
    });

  const result:
    ProductionV2PromptBuildResult = {
      ok:
        true,

      provider:
        `ollama:${generation.model}`,

      repaired,

      builderId:
        built.builderId,

      lockedReferenceContext:
        built.lockedReferenceContext,

      scenePrompt:
        built.scenePrompt,

      finalPrompt:
        built.prompt,

      referencePlan:
        operation.scene.referencePlan,

      validation,
    };

  return {
    scenePrompt,
    validation,
    result,
  };
}

type ProcessResult =
  | "waiting"
  | "advanced"
  | "completed"
  | "failed"
  | "skipped";

type PromptOperationGlobal =
  typeof globalThis & {
    __otgProductionV2PromptOperationLoopV1?:
      Promise<void>
      | null;

    __otgProductionV2PromptOperationInFlightV1?:
      Set<string>;
  };

function globalState() {
  return globalThis as
    PromptOperationGlobal;
}

function inFlightSet() {
  const state =
    globalState();

  if (
    !state
      .__otgProductionV2PromptOperationInFlightV1
  ) {
    state
      .__otgProductionV2PromptOperationInFlightV1 =
        new Set<string>();
  }

  return state
    .__otgProductionV2PromptOperationInFlightV1;
}

async function processOperation(
  operationId: string,
  dependencies:
    ProductionV2PromptOperationDependencies,
): Promise<ProcessResult> {
  const inFlight =
    inFlightSet();

  if (
    inFlight.has(
      operationId,
    )
  ) {
    return "skipped";
  }

  inFlight.add(
    operationId,
  );

  try {
    let operation =
      getProductionV2PromptOperation(
        operationId,
      );

    if (
      !operation
      || operation.status === "completed"
      || operation.status === "failed"
    ) {
      return "skipped";
    }

    const ensureJob =
      dependencies.ensureJob
      || ensureQwenDurableJob;

    const getJob =
      dependencies.getJob
      || getQwenDurableJob;

    const kickQwen =
      dependencies.kickQwen
      || (() => {
        kickQwenDurableScheduler();
      });

    const stage =
      operation.stage;

    const preparedChildInput =
      await childInput(
        operation,
        stage,
      );

    const child =
      ensureJob(
        preparedChildInput,
      );

    kickQwen();

    const current =
      getJob(
        child.id,
      )
      || child;

    const childField =
      stage === "enhancement"
        ? {
            enhancementJobId:
              child.id,
          }
        : {
            repairJobId:
              child.id,
          };

    if (
      current.status
      === "failed"
    ) {
      patchOperation(
        operation,
        {
          ...childField,

          status:
            "failed",

          statusMessage:
            "Scene Prompt generation failed.",

          error:
            current.error
            || "The local prompt model failed.",
        },
      );

      return "failed";
    }

    if (
      current.status
      !== "completed"
    ) {
      patchOperation(
        operation,
        {
          ...childField,

          status:
            "waiting_for_qwen",

          statusMessage:
            current.statusMessage
            || "Waiting for the prompt model.",
        },
      );

      return "waiting";
    }

    const generation =
      parseGeneration(
        current,
        isLtxVisionPromptScene(
          operation.scene,
        )
          ? PRODUCTION_V2_LTX_OLLAMA_MODEL
          : PRODUCTION_V2_OLLAMA_MODEL,
      );

    if (
      stage === "enhancement"
    ) {
      const resolved =
        completedResult(
          operation,
          generation,
          false,
        );

      if (
        resolved.result
      ) {
        patchOperation(
          operation,
          {
            ...childField,

            status:
              "completed",

            statusMessage:
              "Scene Prompt complete.",

            validation:
              resolved.validation,

            result:
              resolved.result,

            error:
              null,
          },
        );

        return "completed";
      }

      /*
       * Persist the enhancement result and the decision to repair
       * BEFORE the repair child exists.
       *
       * If the process dies here, restart resumes the same
       * deterministic repair child.
       */
      patchOperation(
        operation,
        {
          ...childField,

          stage:
            "repair",

          status:
            "queued",

          statusMessage:
            "Scene Prompt needs validation repair.",

          enhancementScenePrompt:
            resolved.scenePrompt,

          validation:
            resolved.validation,

          error:
            null,
        },
      );

      return "advanced";
    }

    const repaired =
      completedResult(
        operation,
        generation,
        true,
      );

    if (
      !repaired.result
    ) {
      patchOperation(
        operation,
        {
          ...childField,

          status:
            "failed",

          statusMessage:
            "Scene Prompt failed validation after repair.",

          validation:
            repaired.validation,

          error:
            "The local prompt model returned an invalid duration or structure after repair.",
        },
      );

      return "failed";
    }

    patchOperation(
      operation,
      {
        ...childField,

        status:
          "completed",

        statusMessage:
          "Scene Prompt complete.",

        validation:
          repaired.validation,

        result:
          repaired.result,

        error:
          null,
      },
    );

    return "completed";
  } catch (error) {
    const operation =
      getProductionV2PromptOperation(
        operationId,
      );

    if (
      operation
      && operation.status !== "completed"
    ) {
      patchOperation(
        operation,
        {
          status:
            "failed",

          statusMessage:
            "Scene Prompt operation failed.",

          error:
            error instanceof Error
              ? error.message
              : String(
                  error,
                ),
        },
      );
    }

    return "failed";
  } finally {
    inFlight.delete(
      operationId,
    );
  }
}

export async function runProductionV2PromptOperationTick(
  dependencies:
    ProductionV2PromptOperationDependencies =
      {},
) {
  const active =
    listActiveProductionV2PromptOperations();

  if (!active.length) {
    return {
      examined:
        0,

      waiting:
        0,

      advanced:
        0,

      completed:
        0,

      failed:
        0,

      skipped:
        0,
    };
  }

  const results =
    await Promise.all(
      active.map(
        (operation) =>
          processOperation(
            operation.id,
            dependencies,
          ),
      ),
    );

  return {
    examined:
      results.length,

    waiting:
      results.filter(
        (value) =>
          value === "waiting",
      ).length,

    advanced:
      results.filter(
        (value) =>
          value === "advanced",
      ).length,

    completed:
      results.filter(
        (value) =>
          value === "completed",
      ).length,

    failed:
      results.filter(
        (value) =>
          value === "failed",
      ).length,

    skipped:
      results.filter(
        (value) =>
          value === "skipped",
      ).length,
  };
}

function sleep(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

export function kickProductionV2PromptOperationScheduler(
  dependencies:
    ProductionV2PromptOperationDependencies =
      {},
) {
  const state =
    globalState();

  if (
    state
      .__otgProductionV2PromptOperationLoopV1
  ) {
    return;
  }

  state
    .__otgProductionV2PromptOperationLoopV1 =
      (async () => {
        for (;;) {
          const active =
            listActiveProductionV2PromptOperations();

          if (!active.length) {
            return;
          }

          await runProductionV2PromptOperationTick(
            dependencies,
          );

          if (
            !listActiveProductionV2PromptOperations()
              .length
          ) {
            return;
          }

          await (
            dependencies.sleep
            || sleep
          )(
            1_000,
          );
        }
      })()
        .catch(
          (error) => {
            console.error(
              "[production-v2-prompt-operation]",
              error,
            );
          },
        )
        .finally(
          () => {
            state
              .__otgProductionV2PromptOperationLoopV1 =
                null;
          },
        );
}

export function enqueueProductionV2PromptOperation(
  ownerKey: string,
  scene: ProductionV2Scene,
) {
  const operation =
    createProductionV2PromptOperation(
      ownerKey,
      scene,
    );

  kickProductionV2PromptOperationScheduler();

  return operation;
}

export function bootstrapProductionV2PromptOperationScheduler() {
  kickProductionV2PromptOperationScheduler();
}
