import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

import fssync from "fs";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { markRunning } from "@/lib/contentState";

type SceneInput = {
  id?: string;
  ideaText: string;
  lensText?: string;
  identityLockText?: string;
  styleLockText?: string;
  inherit?: {
    lens?: boolean;
    identity?: boolean;
    style?: boolean;
    negative?: boolean;
  };
};

type BatchRequestBody = {
  // storyboard format inputs
  characterDescriptors?: string[];
  backgroundPrompt?: string;
  globalNegativePrompt?: string;
  scenes: SceneInput[];
  defaults?: {
    lensText?: string;
    identityLockText?: string;
    styleLockText?: string;
  };

  // comfy integration
  deviceId?: string; // used for client_id
  workflowFile?: string; // relative to OTG_WORKFLOWS_ROOT / COMFY_WORKFLOWS_DIR

  // character images (absolute server paths saved by /api/storyboard/upload)
  characterImages?: string[];
};

function env(name: string, fallback?: string) {
  const v = process.env[name];
  return (v && v.length > 0) ? v : fallback;
}

const OTG_DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(OTG_DATA_DIR, "device_jobs");

function resolveWorkflowRoot() {
  return env("OTG_WORKFLOWS_ROOT",
    env("COMFY_WORKFLOWS_DIR",
      env("COMFY_WORKFLOWS_ROOT",
        path.join(process.cwd(), "comfy_workflows")
      )
    )
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
  return json; // contains prompt_id
}

async function uploadToComfy(absPath: string): Promise<string> {
  const baseUrl = env("COMFY_BASE_URL", env("COMFY_URL", "http://127.0.0.1:8188"))!;
  const buf = await fs.readFile(absPath);
  const fd = new FormData();
  const blob = new Blob([buf]);
  fd.append("image", blob, path.basename(absPath));
  fd.append("overwrite", "true");
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/upload/image`, { method: "POST", body: fd as any });
  const text = await res.text();
  if (!res.ok) throw new Error(`ComfyUI upload failed: ${res.status} ${text}`);
  const json = JSON.parse(text);
  const name = json?.name || json?.filename;
  if (!name) throw new Error(`Could not extract filename from ComfyUI upload: ${text}`);
  return name;
}

function findLoadImageNodes(workflow: any): string[] {
  const ids = Object.keys(workflow || {}).filter((k) => workflow?.[k]?.class_type === "LoadImage");
  return ids.sort((a, b) => Number(a) - Number(b));
}

async function comfyWait(promptId: string, timeoutMs: number) {
  const baseUrl = env("COMFY_BASE_URL", env("COMFY_URL", "http://127.0.0.1:8188"))!;
  const start = Date.now();
  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ComfyUI prompt_id ${promptId}`);
    }
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/history/${promptId}`);
    if (res.ok) {
      const json = await res.json();
      // Comfy history response usually contains a dict keyed by promptId
      const entry = json?.[promptId];
      const outputs = entry?.outputs;
      if (outputs && Object.keys(outputs).length > 0) {
        return entry;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function formatScenes(body: any) {
  const baseUrl = env("NEXT_PUBLIC_OTG_BASE_URL"); // not used on server
  const res = await fetch("http://localhost/api/storyboard/format");
  // Not usable in server route. We'll call formatter internally by importing it is hard in Next.
  // Instead, re-call Ollama here using same logic as /format.
  // To avoid duplication, keep this route self-contained.
}

async function ollamaGenerate(prompt: string, signal: AbortSignal) {
  const baseUrl = env("OLLAMA_BASE_URL", "http://127.0.0.1:11434")!;
  const model = env("OLLAMA_MODEL_STORYBOARD", env("OLLAMA_MODEL", "llama2"))!;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, prompt }),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false as const, status: res.status, body: text };
  }
  try {
    const json = JSON.parse(text);
    const out = (json?.response ?? "").toString();
    return { ok: true as const, output: out };
  } catch {
    return { ok: false as const, status: 500, body: text };
  }
}

function buildEffectiveScenes(body: BatchRequestBody): Array<{
  sceneNumber: number;
  ideaText: string;
  lensText?: string;
  identityLockText?: string;
  styleLockText?: string;
  negativePrompt?: string;
}> {
  const scenes = body.scenes ?? [];
  const out: any[] = [];

  let prevLens = body.defaults?.lensText;
  let prevIdentity = body.defaults?.identityLockText;
  let prevStyle = body.defaults?.styleLockText;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const inherit = s.inherit ?? {};

    const lensText = inherit.lens ? prevLens : (s.lensText ?? prevLens);
    const identityLockText = inherit.identity ? prevIdentity : (s.identityLockText ?? prevIdentity);
    const styleLockText = inherit.style ? prevStyle : (s.styleLockText ?? prevStyle);

    const negativePrompt = (inherit.negative && body.globalNegativePrompt)
      ? body.globalNegativePrompt
      : undefined;

    out.push({
      sceneNumber: i + 1,
      ideaText: (s.ideaText ?? "").toString(),
      lensText,
      identityLockText,
      styleLockText,
      negativePrompt,
    });

    prevLens = lensText ?? prevLens;
    prevIdentity = identityLockText ?? prevIdentity;
    prevStyle = styleLockText ?? prevStyle;
  }
  return out;
}

function renderFinalPrompt(params: {
  sceneNumber: number;
  camera: string;
  location: string;
  environment: string;
  action: string;
  lensText?: string;
  identityLockText?: string;
  styleLockText?: string;
}) {
  const parts: string[] = [];
  parts.push(`Next Scene ${params.sceneNumber}:`);

  const cameraBits: string[] = [];
  if (params.camera?.trim()) cameraBits.push(params.camera.trim());
  if (params.lensText?.trim()) cameraBits.push(params.lensText.trim());
  const cameraLine = cameraBits.join(" ");
  if (cameraLine) parts.push(cameraLine.replace(/\s+/g, " ").trim());

  const paraBits = [params.location, params.environment, params.action]
    .map(s => (s ?? "").trim())
    .filter(Boolean);
  if (paraBits.length) parts.push(paraBits.join("; ").replace(/\s+/g, " ").trim() + ".");

  if (params.identityLockText?.trim()) parts.push(`Identity/Face lock: ${params.identityLockText.trim()}.`);
  if (params.styleLockText?.trim()) parts.push(params.styleLockText.trim().endsWith(".") ? params.styleLockText.trim() : `${params.styleLockText.trim()}.`);

  return parts.join(" ");
}

export async function POST(req: NextRequest) {
  const comfyTimeout = Number(env("STORYBOARD_SCENE_TIMEOUT_MS", "600000"));
  const ollamaTimeout = Number(env("STORYBOARD_OLLAMA_TIMEOUT_MS", "60000"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ollamaTimeout);

  try {
    let ownerCtx;
    try {
      ownerCtx = await getOwnerContext(req);
    } catch (e: any) {
      if (e instanceof SessionInvalidError) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      throw e;
    }

    const body = (await req.json()) as BatchRequestBody;
    if (!body?.scenes?.length) return NextResponse.json({ ok: false, error: "No scenes provided." }, { status: 400 });

    const characterImages = (body.characterImages ?? []).filter(Boolean);
    const storyboardCount = Math.max(1, Math.min(5, characterImages.length || (body.characterDescriptors?.length ?? 0) || 5));
    const defaultWorkflow = storyboardCount === 1 ? "storyboard/StoryBoard 1.json" : `storyboard/Storyboard ${storyboardCount}.json`;
    const workflowFile = body.workflowFile ?? env("STORYBOARD_WORKFLOW_FILE", defaultWorkflow)!;
    const workflowRoot = resolveWorkflowRoot();
    const workflowPath = path.join(workflowRoot, workflowFile);

    const raw = await fs.readFile(workflowPath, "utf-8");
    const workflowTemplate = JSON.parse(raw);

    const effectiveScenes = buildEffectiveScenes(body);
    const characterBlock = (body.characterDescriptors ?? []).map(s => `- ${s}`).join("\n");
    const backgroundPrompt = (body.backgroundPrompt ?? "").trim();
    const deviceId = ownerCtx.deviceId || body.deviceId || "local";
    const ownerKey = ownerCtx.ownerKey;

    // Mark RUNNING so gallery sync can promote the final output.
    try {
      const presetId = String(workflowFile || "").replace(/\.json$/i, "");
      markRunning(ownerKey, { title: "Storyboard", workflowId: presetId || null, deviceId });
    } catch {
      // best-effort
    }

    const clientId = deviceId;

    const results: any[] = [];

    for (const s of effectiveScenes) {
      // 1) Ollama -> JSON
      const prompt = [
        "You are a cinematic scene formatter.",
        "Return ONLY valid JSON. No markdown. No extra text.",
        "Schema:",
        `{ "camera": string, "location": string, "environment": string, "action": string }`,
        "",
        "Rules:",
        "- Keep continuity with previous scene unless user indicates a change.",
        "- Do not invent new characters beyond what is listed.",
        "- Be concise but cinematic; avoid adding dialogue unless provided.",
        "",
        "Characters:",
        characterBlock || "- (none provided)",
        "",
        backgroundPrompt ? `Global background/location lock: ${backgroundPrompt}` : "Global background/location lock: (none)",
        "",
        `Scene idea: ${s.ideaText}`,
        "",
        "Output JSON now."
      ].join("\n");

      const gen = await ollamaGenerate(prompt, controller.signal);
      if (!gen.ok) {
        return NextResponse.json({ ok: false, error: `Ollama error (${gen.status})`, details: gen.body }, { status: 502 });
      }

      let parsed: any;
      try {
        parsed = JSON.parse(gen.output);
      } catch {
        const repairPrompt = [
          "Fix the following into valid JSON ONLY using schema:",
          `{ "camera": string, "location": string, "environment": string, "action": string }`,
          "No markdown. No commentary.",
          "",
          "TEXT:",
          gen.output
        ].join("\n");
        const gen2 = await ollamaGenerate(repairPrompt, controller.signal);
        if (!gen2.ok) {
          return NextResponse.json({ ok: false, error: `Ollama repair error (${gen2.status})`, details: gen2.body }, { status: 502 });
        }
        parsed = JSON.parse(gen2.output);
      }

      const formattedPositive = renderFinalPrompt({
        sceneNumber: s.sceneNumber,
        camera: (parsed.camera ?? "").toString(),
        location: (parsed.location ?? "").toString(),
        environment: (parsed.environment ?? "").toString(),
        action: (parsed.action ?? "").toString(),
        lensText: s.lensText,
        identityLockText: s.identityLockText,
        styleLockText: s.styleLockText ?? "realistic cinematic style",
      });

      // 2) Inject into a fresh workflow copy
      const workflow = JSON.parse(JSON.stringify(workflowTemplate));

      // 2a) Upload character images to ComfyUI and inject into LoadImage nodes
      if (characterImages.length) {
        const comfyNames: string[] = [];
        for (const p of characterImages.slice(0, storyboardCount)) {
          comfyNames.push(await uploadToComfy(path.resolve(p)));
        }
        const loadNodes = findLoadImageNodes(workflow);
        for (let i = 0; i < Math.min(loadNodes.length, comfyNames.length); i++) {
          if (workflow?.[loadNodes[i]]?.inputs) workflow[loadNodes[i]].inputs.image = comfyNames[i];
        }
      }

      // Positive prompt line
      if (workflow?.["30"]?.inputs) workflow["30"].inputs.prompt = formattedPositive;
      // Negative prompt (Storyboard 5 uses node 36 prompt string)
      if (s.negativePrompt && workflow?.["36"]?.inputs) workflow["36"].inputs.prompt = s.negativePrompt;

      // 3) Submit to ComfyUI
      const submit = await comfySubmit(workflow, clientId);
      const promptId = submit?.prompt_id ?? submit?.promptId ?? submit?.prompt_id?.toString();

      // Persist job (JSONL) so /api/gallery/sync can resolve the newest prompt_id.
      try {
        fssync.mkdirSync(JOBS_DIR, { recursive: true });
        const jobPath = path.join(JOBS_DIR, `${deviceId}.jsonl`);
        const prompt_id = String(promptId || "").trim() || null;
        const presetId = String(workflowFile || "").replace(/\.json$/i, "") || null;
        if (prompt_id) {
          fssync.appendFileSync(
            jobPath,
            JSON.stringify({ ts: Date.now(), ownerKey, username: ownerCtx.username ?? null, deviceId, title: "Storyboard", preset: presetId, prompt_id, rawResponse: submit }) + "\n",
            "utf-8"
          );
        }
      } catch {
        // best-effort
      }

      // 4) Wait for completion before continuing (sequential)
      const entry = promptId ? await comfyWait(promptId, comfyTimeout) : null;

      results.push({
        sceneNumber: s.sceneNumber,
        promptId,
        formattedPositive,
        negativePrompt: s.negativePrompt,
        comfyHistory: entry ?? null,
      });
    }

    return NextResponse.json({ ok: true, workflowFile, results });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Ollama request timed out." : (e?.message ?? "Unknown error");
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}