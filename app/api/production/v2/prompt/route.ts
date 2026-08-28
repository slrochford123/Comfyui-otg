import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";
import {
  buildProductionPrompt,
  buildProductionV2SceneEnhancementInstruction,
  buildProductionV2SceneRepairInstruction,
  applyProductionV2DeterministicDialogueSequence,
  validateProductionV2ScenePrompt,
} from "@/lib/production/promptBuilder";
import { resolveProductionV2H3ReferencePlan } from "@/lib/production/referenceResolver";
import {
  normalizeProductionV2,
  type ProductionV2Model,
  type ProductionV2Scene,
} from "@/lib/production/v2";
import { QWEN_CLUSTER_MODEL, QwenClusterBusyError, qwenClusterFetch } from "@/lib/workers/qwenClusterRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRODUCTION_V2_OLLAMA_MODEL = String(process.env.PRODUCTION_V2_OLLAMA_MODEL || "qwen3.5:4b").trim();
const PRODUCTION_V2_OLLAMA_FALLBACK_MODEL = String(process.env.PRODUCTION_V2_OLLAMA_FALLBACK_MODEL || QWEN_CLUSTER_MODEL).trim();

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) },
  });
}

function normalizeScene(value: unknown): ProductionV2Scene {
  const raw = value as Partial<ProductionV2Scene> | null;
  const defaultModel: ProductionV2Model = raw?.model === "ltx-2.5" ? "ltx-2.5" : "minimax-h3";
  return normalizeProductionV2({
    schemaVersion: 2,
    id: "production-prompt-request",
    name: "Production Prompt Request",
    status: "draft",
    defaultModel,
    scenes: [raw],
  }).scenes[0];
}

async function generateScenePrompt(instruction: string) {
  const timeoutMs = Math.max(15_000, Math.min(180_000, Number(process.env.PRODUCTION_V2_PROMPT_TIMEOUT_MS || 120_000)));
  let response: Response;
  try {
    response = await qwenClusterFetch("/api/chat", {
      messages: [
        { role: "system", content: "Return only the requested final answer. Do not include analysis or planning." },
        { role: "user", content: instruction },
      ],
      think: false,
      stream: false,
      options: {
        temperature: 0.35,
        top_p: 0.8,
        repeat_penalty: 1.08,
        num_predict: 600,
      },
    }, {
      model: PRODUCTION_V2_OLLAMA_MODEL,
      modelByNode: {
        slr: PRODUCTION_V2_OLLAMA_MODEL,
        shawn: PRODUCTION_V2_OLLAMA_FALLBACK_MODEL,
      },
      allowedNodes: ["slr", "shawn"],
      timeoutMs,
      requiredContextTokens: 8192,
      keepAlive: 0,
      leaseTtlSeconds: Math.ceil(timeoutMs / 1000) + 30,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DOMException(`Local Ollama prompt generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`, "AbortError");
    }
    throw error;
  }
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    throw new Error(`The local prompt model returned non-JSON output: ${text.slice(0, 160)}`);
  }
  if (!response.ok) throw new Error(String(json.error || json.message || `Local prompt model failed with HTTP ${response.status}.`));
  const message = json.message && typeof json.message === "object" ? json.message as Record<string, unknown> : {};
  const output = String(message.content || "").trim();
  if (!output) throw new Error("The local prompt model returned an empty Scene Prompt.");
  return {
    output,
    model: response.headers.get("x-otg-qwen-model") || PRODUCTION_V2_OLLAMA_MODEL,
  };
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const body = await req.clone().json().catch(() => null) as { scene?: unknown } | null;
    await getOwnerContext(req);
    if (!body?.scene) return noStore({ ok: false, error: "A Production V2 scene is required." }, { status: 400 });
    let scene = normalizeScene(body.scene);
    if (scene.model !== "minimax-h3") return noStore({ ok: false, error: "The local H3 prompt builder only accepts MiniMax H3 scenes." }, { status: 400 });
    if (scene.generationMode === "h3-reference-to-video") scene = resolveProductionV2H3ReferencePlan(scene);

    let generation = await generateScenePrompt(
      buildProductionV2SceneEnhancementInstruction(scene),
    );
    let scenePrompt = applyProductionV2DeterministicDialogueSequence(
      scene,
      generation.output,
    );
    let validation = validateProductionV2ScenePrompt(scene, scenePrompt);
    let repaired = false;
    if (!validation.ok) {
      repaired = true;
      generation = await generateScenePrompt(
        buildProductionV2SceneRepairInstruction(
          scene,
          scenePrompt,
          validation.errors,
        ),
      );
      scenePrompt = applyProductionV2DeterministicDialogueSequence(
        scene,
        generation.output,
      );
      validation = validateProductionV2ScenePrompt(scene, scenePrompt);
    }
    if (!validation.ok) {
      return noStore({ ok: false, error: "The local prompt model returned an invalid duration or structure after repair.", validation }, { status: 422 });
    }
    const built = buildProductionPrompt({
      model: scene.model,
      mode: scene.generationMode,
      scene,
      references: scene.referencePlan,
      dialogue: scene.dialogueTurns,
      duration: scene.durationSeconds,
      scenePrompt,
    });
    return noStore({
      ok: true,
      provider: `ollama:${generation.model}`,
      repaired,
      builderId: built.builderId,
      lockedReferenceContext: built.lockedReferenceContext,
      scenePrompt: built.scenePrompt,
      finalPrompt: built.prompt,
      referencePlan: scene.referencePlan,
      validation,
    });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (error instanceof QwenClusterBusyError) return noStore({ ok: false, error: error.message, code: error.code }, { status: error.status });
    const message = error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "Could not build the Production Scene Prompt.")
      : "Could not build the Production Scene Prompt.";
    const status = error instanceof DOMException && error.name === "AbortError" ? 504 : 500;
    return noStore({ ok: false, error: message }, { status });
  }
}
