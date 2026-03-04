import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import crypto from "crypto";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { markRunning } from "@/lib/contentState";

export const runtime = "nodejs";

const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");

function env(name: string, fallback?: string) {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function resolveWorkflowRoot() {
  return env(
    "OTG_WORKFLOWS_ROOT",
    env("COMFY_WORKFLOWS_DIR", env("COMFY_WORKFLOWS_ROOT", path.join(process.cwd(), "comfy_workflows")))
  )!;
}

async function comfySubmit(workflow: any, clientId: string) {
  const baseUrl = env("COMFY_BASE_URL", env("COMFY_URL", "http://127.0.0.1:8188"))!;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`ComfyUI /prompt failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function uploadToComfy(absPath: string): Promise<string> {
  const baseUrl = env("COMFY_BASE_URL", env("COMFY_URL", "http://127.0.0.1:8188"))!;
  if (!fssync.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);
  const buf = await fs.readFile(absPath);
  const filename = path.basename(absPath);

  const fd = new FormData();
  const blob = new Blob([buf]);
  fd.append("image", blob, filename);
  fd.append("overwrite", "true");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/upload/image`, {
    method: "POST",
    body: fd as any,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ComfyUI upload failed: ${res.status} ${text}`);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`ComfyUI upload returned non-JSON: ${text}`);
  }
  const name = json?.name || json?.filename;
  if (!name) throw new Error(`Could not extract filename from ComfyUI upload: ${text}`);
  return name;
}

function findLoadImageNodes(workflow: any): string[] {
  const ids = Object.keys(workflow || {}).filter((k) => workflow?.[k]?.class_type === "LoadImage");
  return ids.sort((a, b) => Number(a) - Number(b));
}

function findPromptNodes(workflow: any): { positive?: string; negative?: string } {
  const promptNodes: Array<{ id: string; classType: string; key: string }> = [];
  for (const id of Object.keys(workflow || {})) {
    const node = workflow[id];
    const inputs = node?.inputs || {};
    if (typeof inputs?.prompt === "string") {
      promptNodes.push({ id, classType: node?.class_type || "", key: "prompt" });
    }
  }
  const pos = promptNodes.find((n) => /promptLine/i.test(n.classType))?.id || promptNodes[0]?.id;
  const neg = promptNodes.find((n) => n.id !== pos)?.id;
  return { positive: pos, negative: neg };
}

function randomSeed48(): number {
  // crypto.randomInt max is < 2^48. This produces a stable, safe integer seed.
  return crypto.randomInt(0, 2 ** 48 - 1);
}

function randomizeSeeds(workflow: any) {
  for (const id of Object.keys(workflow || {})) {
    const node = workflow[id];
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== "object") continue;

    for (const key of ["seed", "noise_seed"] as const) {
      if (typeof inputs[key] === "number" && Number.isFinite(inputs[key])) {
        inputs[key] = randomSeed48();
      }
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    // IMPORTANT: getOwnerContext may read deviceId from request headers/body.
    // Call it before req.json() so the body isn't consumed twice.
    let ownerCtx;
    try {
      ownerCtx = await getOwnerContext(req);
    } catch (e: any) {
      if (e instanceof SessionInvalidError) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      throw e;
    }

    const body = await req.json();

    const storyboardCount = Number(body?.storyboardCount || 1);
    const workflowFile = (body?.workflowFile as string) || `storyboard/Storyboard ${storyboardCount}.json`;

    const characterImages: string[] = (body?.characterImages || []).filter(Boolean);
    const characterDescriptors: string[] = (body?.characterDescriptors || []).filter(Boolean);

    const backgroundPrompt: string | undefined = body?.backgroundPrompt;
    const negativePrompt: string | undefined = body?.globalNegativePrompt;

    const scenePrompts: string[] = (body?.scenePrompts || []).filter(Boolean);
    const fullPromptRaw: string | undefined = body?.fullPrompt;

    if (storyboardCount < 1 || storyboardCount > 5) {
      return NextResponse.json({ error: "Invalid storyboardCount" }, { status: 400 });
    }
    if (characterImages.length !== storyboardCount) {
      return NextResponse.json(
        { error: `Storyboard ${storyboardCount} requires ${storyboardCount} character image(s).` },
        { status: 400 }
      );
    }

    if (scenePrompts.length > 15) {
      return NextResponse.json({ error: "Maximum 15 scenes allowed." }, { status: 400 });
    }

    const workflowRootEnv = resolveWorkflowRoot();
    const candidates: string[] = [];

    const add = (root: string, file: string) => candidates.push(path.join(root, file));

    // 1) env-configured workflows root
    add(workflowRootEnv, workflowFile);
    if (/Storyboard\s+1\.json$/i.test(workflowFile)) add(workflowRootEnv, "storyboard/StoryBoard 1.json");

    // 2) fallback to repo-local comfy_workflows
    const cwdRoot = path.join(process.cwd(), "comfy_workflows");
    add(cwdRoot, workflowFile);
    if (/Storyboard\s+1\.json$/i.test(workflowFile)) add(cwdRoot, "storyboard/StoryBoard 1.json");

    const workflowPath = candidates.find((p) => fssync.existsSync(p));
    if (!workflowPath) {
      return NextResponse.json(
        { error: `Workflow template not found. Checked: ${candidates.join(" | ")}` },
        { status: 500 }
      );
    }

    const raw = await fs.readFile(workflowPath, "utf-8");
    const workflowTemplate = JSON.parse(raw);
    const workflow = JSON.parse(JSON.stringify(workflowTemplate));

    // Upload character images to ComfyUI, then inject into LoadImage nodes
    const comfyFilenames: string[] = [];
    for (const imgPath of characterImages) {
      comfyFilenames.push(await uploadToComfy(path.resolve(imgPath)));
    }

    const loadNodes = findLoadImageNodes(workflow);
    if (loadNodes.length < storyboardCount) {
      return NextResponse.json(
        { error: `Workflow has only ${loadNodes.length} LoadImage nodes; expected ${storyboardCount}.` },
        { status: 500 }
      );
    }
    for (let i = 0; i < storyboardCount; i++) {
      const nodeId = loadNodes[i];
      if (workflow?.[nodeId]?.inputs) workflow[nodeId].inputs.image = comfyFilenames[i];
    }

    // Prompt injection (ALL scenes in one prompt)
    const nodes = findPromptNodes(workflow);
    const fullPrompt =
      (typeof fullPromptRaw === "string" && fullPromptRaw.trim())
        ? fullPromptRaw.trim()
        : scenePrompts.length
          ? scenePrompts.join("\n\n")
          : "";

    if (!fullPrompt) {
      return NextResponse.json({ error: "Missing fullPrompt/scenePrompts" }, { status: 400 });
    }

    if (nodes.positive && workflow?.[nodes.positive]?.inputs) {
      workflow[nodes.positive].inputs.prompt = fullPrompt;
    }
    if (negativePrompt && nodes.negative && workflow?.[nodes.negative]?.inputs) {
      workflow[nodes.negative].inputs.prompt = negativePrompt;
    }

    // Randomize seed every submission
    randomizeSeeds(workflow);

    const deviceId = ownerCtx.deviceId;
    const ownerKey = ownerCtx.ownerKey;

    // Mark RUNNING so /api/gallery/sync will promote the finished output into the gallery.
    // (Otherwise storyboard outputs stay only in ComfyUI's output dir.)
    try {
      const presetId = String(workflowFile || "").replace(/\.json$/i, "");
      markRunning(ownerKey, {
        title: `Storyboard`,
        workflowId: presetId || null,
        deviceId,
      });
    } catch {
      // best-effort only
    }

    const submit = await comfySubmit(workflow, deviceId || "otg_storyboard");
    const promptId = submit?.prompt_id ?? submit?.promptId;

    // Persist job submission in the same JSONL format used by /api/comfy.
    try {
      fssync.mkdirSync(JOBS_DIR, { recursive: true });
      const jobPath = path.join(JOBS_DIR, `${deviceId}.jsonl`);
      const prompt_id = String(promptId || "").trim() || null;
      const presetId = String(workflowFile || "").replace(/\.json$/i, "") || null;

      fssync.appendFileSync(
        jobPath,
        JSON.stringify({
          ts: Date.now(),
          ownerKey,
          username: ownerCtx.username ?? null,
          deviceId,
          title: "Storyboard",
          preset: presetId,
          prompt_id,
          rawResponse: submit,
        }) + "\n",
        "utf-8"
      );
    } catch {
      // best-effort only
    }

    return NextResponse.json({ ok: true, promptId, workflowFile, usedSeedRandom: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
