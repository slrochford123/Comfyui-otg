import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { SLR_COMFY_URL, SLR_GPU_LOCK_ID, SLR_QWEN_URL } from "@/lib/workers/clusterGpu";
import { QWEN_CLUSTER_MODEL, qwenClusterFetch } from "@/lib/workers/qwenClusterRouter";
import { listResourceLocks } from "@/lib/workers/resourceLocks";

type QueuePayload = { queue_running?: unknown[]; queue_pending?: unknown[] };

async function readJson(url: string): Promise<any> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function queueIsIdle(payload: QueuePayload): boolean {
  return Array.isArray(payload.queue_running) && payload.queue_running.length === 0
    && Array.isArray(payload.queue_pending) && payload.queue_pending.length === 0;
}

function qwenResident(payload: any): boolean {
  return Array.isArray(payload?.models) && payload.models.some((model: any) =>
    String(model?.name || model?.model || "").toLowerCase().startsWith("qwen3.6"));
}

async function main() {
  const initialLocks = listResourceLocks();
  if (initialLocks.some((lock) => lock.lockId === SLR_GPU_LOCK_ID)) {
    console.log(JSON.stringify({ result: "skipped", reason: "gpu:slr-5060 is locked" }));
    return;
  }

  const beforeQueue = await readJson(`${SLR_COMFY_URL}/queue`);
  if (!queueIsIdle(beforeQueue)) {
    console.log(JSON.stringify({ result: "skipped", reason: "SLR ComfyUI queue is active" }));
    return;
  }
  const beforePs = await readJson(`${SLR_QWEN_URL}/api/ps`);
  if (qwenResident(beforePs)) {
    console.log(JSON.stringify({ result: "skipped", reason: "SLR Qwen is already resident without an app lease" }));
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-qwen-vision-smoke-"));
  const imagePath = path.join(tempDir, "tiny-red-square.png");
  await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toFile(imagePath);
  const image = fs.readFileSync(imagePath).toString("base64");

  const response = await qwenClusterFetch("/api/generate", {
    model: QWEN_CLUSTER_MODEL,
    prompt: "Identify the dominant color in this tiny test image. Answer with one short sentence.",
    images: [image],
    think: false,
    options: { num_ctx: 4_096, num_predict: 128, temperature: 0 },
  }, {
    allowedNodes: ["slr"],
    requiredContextTokens: 4_096,
    waitMs: 0,
    timeoutMs: 180_000,
  });
  const payload = await response.json().catch(() => null) as any;
  const output = String(payload?.response || payload?.message?.content || "").trim();
  if (!response.ok) throw new Error(`SLR vision request failed (${response.status}): ${JSON.stringify(payload)}`);
  if (!output || !/red/i.test(output)) {
    throw new Error(`SLR vision response was not useful: ${output || "(empty)"}; payload=${JSON.stringify(payload)}`);
  }

  const leaseReleased = !listResourceLocks().some((lock) => lock.lockId === SLR_GPU_LOCK_ID);
  let unloaded = false;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const ps = await readJson(`${SLR_QWEN_URL}/api/ps`);
    if (!qwenResident(ps)) {
      unloaded = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const afterQueue = await readJson(`${SLR_COMFY_URL}/queue`);
  const comfyUndisturbed = queueIsIdle(afterQueue);
  if (!leaseReleased || !unloaded || !comfyUndisturbed) {
    throw new Error(`Post-smoke invariant failed: ${JSON.stringify({ leaseReleased, unloaded, comfyUndisturbed })}`);
  }

  console.log(JSON.stringify({
    result: "passed",
    node: "slr",
    endpoint: SLR_QWEN_URL,
    model: QWEN_CLUSTER_MODEL,
    keepAlive: 0,
    imageBytes: fs.statSync(imagePath).size,
    response: output,
    leaseReleased,
    modelUnloaded: unloaded,
    comfyUndisturbed,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ result: "failed", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
