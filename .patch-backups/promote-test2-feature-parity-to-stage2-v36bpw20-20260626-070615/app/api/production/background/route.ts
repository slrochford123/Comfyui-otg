
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { loadWorkflowById, extractPromptGraph, validatePromptGraph, stripPromptMeta } from "@/lib/workflows";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryFile = { filename: string; subfolder?: string; type?: string };

type BackgroundPresetOption = "Anime" | "Unreal Engine" | "Realistic" | "Noir" | "Old School";

const WORKFLOW_BY_PRESET: Record<BackgroundPresetOption, string> = {
  Anime: "presets/Create a Picture",
  "Unreal Engine": "presets/Create a Picture",
  Realistic: "presets/Create a Picture",
  Noir: "presets/Create a Picture",
  "Old School": "presets/Create a Picture",
};

function normalizeComfyBaseUrl(raw: unknown): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function firstComfyBaseUrl(...values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = normalizeComfyBaseUrl(value);
    if (normalized) return normalized;
  }
  return null;
}

function configuredImageComfyBaseUrl(): string {
  return (
    firstComfyBaseUrl(
      process.env.OTG_IMAGE_COMFY_BASE_URL,
      process.env.IMAGE_COMFY_BASE_URL,
      process.env.COMFY_IMAGE_BASE_URL,
      process.env.NEXT_PUBLIC_IMAGE_COMFY_BASE_URL,
      process.env.OTG_COMFY_BASE_URL,
      process.env.COMFY_BASE_URL,
      process.env.COMFYUI_BASE_URL,
      process.env.NEXT_PUBLIC_COMFY_BASE_URL,
      process.env.NEXT_PUBLIC_COMFYUI_BASE_URL,
    ) || "http://127.0.0.1:8188"
  );
}

function inferExt(filename: string) {
  const ext = path.extname(filename || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return ext;
  return ".png";
}

function safePrompt(prompt: string) {
  return String(prompt || "").replace(/\s+/g, " ").trim();
}

function setTextEncodes(graph: any, positive: string, negative = "") {
  if (!graph || typeof graph !== "object") return;
  const nodes: Record<string, any> = graph;

  const assign = (node: any, keys: string[], value: string) => {
    if (!node?.inputs) return false;
    for (const k of keys) {
      if (typeof node.inputs?.[k] === "string") {
        node.inputs[k] = value;
        return true;
      }
    }
    return false;
  };

  const textLike = Object.entries(nodes)
    .map(([id, node]) => ({ id, node: node as any }))
    .filter((x) => x?.node?.inputs && (typeof x.node.inputs.text === "string" || typeof x.node.inputs.prompt === "string"))
    .filter((x) => /textencode|cliptextencode|t5|prompt/i.test(String(x.node.class_type || "")));

  if (textLike[0]) assign(textLike[0].node, ["text", "prompt", "caption", "positive", "positive_prompt"], positive);
  if (textLike[1]) assign(textLike[1].node, ["text", "prompt", "caption", "negative", "negative_prompt"], negative);
}

function extractImageFilesFromHistory(record: any): HistoryFile[] {
  const out: HistoryFile[] = [];
  const seen = new Set<string>();
  const outputs = record?.outputs;
  if (!outputs || typeof outputs !== "object") return out;

  const visit = (value: any) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.filename && /\.(png|jpe?g|webp|gif)(?:$|\?)/i.test(String(value.filename))) {
      const hf = {
        filename: String(value.filename),
        subfolder: value.subfolder ? String(value.subfolder) : "",
        type: value.type ? String(value.type) : "output",
      };
      const key = `${hf.type}|${hf.subfolder}|${hf.filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(hf);
      }
    }
    for (const nested of Object.values(value)) visit(nested);
  };

  visit(outputs);
  return out;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data, text };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();

  try {
    await getOwnerContext(req);
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }

  try {
    const body = await req.json().catch(() => null);
    const prompt = safePrompt(String(body?.prompt || ""));
    const preset = String(body?.preset || "Realistic") as BackgroundPresetOption;
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Background prompt is required" }, { status: 400 });
    }

    const workflowId = WORKFLOW_BY_PRESET[preset] || WORKFLOW_BY_PRESET.Realistic;
    const wf = loadWorkflowById(workflowId);
    if (!wf.ok) {
      return NextResponse.json({ ok: false, error: `Workflow not found: ${workflowId}`, detail: wf.error }, { status: wf.status });
    }

    const extracted = extractPromptGraph(wf.json);
    if (!extracted.ok) {
      return NextResponse.json({ ok: false, error: extracted.error }, { status: 400 });
    }
    const validated = validatePromptGraph(extracted.graph);
    if (!validated.ok) {
      return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
    }

    const graph: any = JSON.parse(JSON.stringify(stripPromptMeta(extracted.graph)));
    setTextEncodes(graph, prompt, "");

    const comfyBaseUrl = configuredImageComfyBaseUrl();
    const clientId = `production-bg-${Date.now()}`;

    const queued = await fetchJson(`${comfyBaseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, prompt: graph }),
    });
    if (!queued.res.ok) {
      return NextResponse.json({ ok: false, error: queued.data?.error || queued.text || "ComfyUI prompt submission failed" }, { status: 502 });
    }

    const promptId = String(queued.data?.prompt_id || "").trim();
    if (!promptId) {
      return NextResponse.json({ ok: false, error: "ComfyUI did not return a prompt_id" }, { status: 502 });
    }

    const started = Date.now();
    let files: HistoryFile[] = [];
    while (Date.now() - started < 5 * 60 * 1000) {
      const history = await fetchJson(`${comfyBaseUrl}/history/${encodeURIComponent(promptId)}`);
      const record = history.data?.[promptId] || history.data;
      files = extractImageFilesFromHistory(record);
      if (files.length) break;
      await sleep(1500);
    }

    if (!files.length) {
      return NextResponse.json({ ok: false, error: "Timed out waiting for generated background output" }, { status: 504 });
    }

    const first = files[0];
    const viewUrl = `${comfyBaseUrl}/view?filename=${encodeURIComponent(first.filename)}&type=${encodeURIComponent(first.type || "output")}&subfolder=${encodeURIComponent(first.subfolder || "")}`;
    const outputRes = await fetch(viewUrl, { cache: "no-store" });
    if (!outputRes.ok) {
      const outputText = await outputRes.text().catch(() => "");
      return NextResponse.json({ ok: false, error: outputText || `ComfyUI /view failed (${outputRes.status})` }, { status: 502 });
    }

    const buffer = Buffer.from(await outputRes.arrayBuffer());
    const dataRoot = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
    const outDir = path.join(dataRoot, "uploads", "storyboard");
    await fs.mkdir(outDir, { recursive: true });

    const ext = inferExt(first.filename);
    const filename = `production_bg_${crypto.randomUUID()}${ext}`;
    const outPath = path.join(outDir, filename);
    await fs.writeFile(outPath, buffer);

    return NextResponse.json({
      ok: true,
      serverPath: outPath,
      filename,
      promptId,
      workflowId,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Create background failed" }, { status: 500 });
  }
}
