import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_ROOT = process.cwd();
const WORKFLOW_PATH = path.join(REPO_ROOT, "app", "workflows", "production", "audio_stable_audio_3_medium_base.json");
const OUTPUT_DIR = path.join(REPO_ROOT, "data", "production", "assembly-music");
const AUDIO_EXT_RE = /\.(mp3|wav|flac|m4a|aac|ogg)$/i;

type HistoryFile = {
  filename: string;
  subfolder: string;
  type: string;
  nodeId: string;
};

function safeName(value: unknown, fallback = "assembly_music") {
  const clean = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return clean || fallback;
}

function clampDuration(value: unknown) {
  const numeric = Math.round(Number(value || 0));
  if (!Number.isFinite(numeric)) return 30;
  return Math.max(5, Math.min(300, numeric));
}

function randomSeed() {
  return Math.floor(Math.random() * 900_000_000_000_000) + 100_000_000_000_000;
}

function comfyBaseUrlCandidates() {
  const raw = [
    process.env.OTG_COMFY_AUDIO_URL,
    process.env.OTG_COMFY_URL,
    process.env.COMFYUI_BASE_URL,
    process.env.COMFY_BASE_URL,
    process.env.COMFYUI_URL,
    process.env.NEXT_PUBLIC_COMFYUI_BASE_URL,
    "http://127.0.0.1:8588",
    "http://127.0.0.1:8188",
  ];

  const seen = new Set<string>();
  return raw
    .map((value) => String(value || "").trim().replace(/\/+$/, ""))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function collectHistoryFiles(value: any, out: HistoryFile[] = [], currentNodeId = ""): HistoryFile[] {
  if (!value || typeof value !== "object") return out;

  if (Array.isArray(value)) {
    value.forEach((item) => collectHistoryFiles(item, out, currentNodeId));
    return out;
  }

  const filename = typeof value.filename === "string" ? value.filename : "";
  if (filename) {
    out.push({
      filename,
      subfolder: typeof value.subfolder === "string" ? value.subfolder : "",
      type: typeof value.type === "string" ? value.type : "output",
      nodeId: currentNodeId,
    });
  }

  for (const [key, child] of Object.entries<any>(value)) {
    const nextNodeId = /^\d+(?::\d+)?$/.test(String(key)) ? String(key) : currentNodeId;
    collectHistoryFiles(child, out, nextNodeId);
  }

  return out;
}

function scoreAudioFile(file: HistoryFile) {
  const name = String(file.filename || "").toLowerCase();
  let score = 0;
  if (AUDIO_EXT_RE.test(name)) score += 50;
  if (file.nodeId === "19") score += 100;
  if (name.includes("stable_audio_3")) score += 20;
  if (name.includes("production_assembly_music")) score += 20;
  if (name.endsWith(".mp3")) score += 10;
  return score;
}

async function loadWorkflow() {
  const raw = await fsp.readFile(WORKFLOW_PATH, "utf8");
  return JSON.parse(raw);
}

function patchWorkflow(workflow: any, args: { prompt: string; durationSeconds: number; title: string }) {
  const graph = JSON.parse(JSON.stringify(workflow));

  if (graph?.["52:31"]?.inputs) graph["52:31"].inputs.value = args.prompt;
  if (graph?.["52:36"]?.inputs) graph["52:36"].inputs.value = args.durationSeconds;
  if (graph?.["52:3"]?.inputs) graph["52:3"].inputs.seed = randomSeed();
  if (graph?.["19"]?.inputs) graph["19"].inputs.filename_prefix = `audio/production_assembly_music_${safeName(args.title)}_${Date.now()}`;
  if (graph?.["52:43"]?.inputs) graph["52:43"].inputs.choice = "Music";

  return graph;
}

async function submitPrompt(baseUrl: string, graph: any) {
  const response = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: graph,
      client_id: `otg_assembly_music_${Date.now()}_${randomUUID()}`,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.prompt_id) {
    throw new Error(data?.error || `ComfyUI submit failed (${response.status})`);
  }

  return String(data.prompt_id);
}

async function pollHistoryForAudio(baseUrl: string, promptId: string) {
  const started = Date.now();
  const timeoutMs = Number(process.env.OTG_ASSEMBLY_MUSIC_TIMEOUT_MS || 480_000);

  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { cache: "no-store" });
    const data = await response.json().catch(() => null);

    if (response.ok && data) {
      const promptBlock = data?.[promptId] ?? data;
      const audioFiles = collectHistoryFiles(promptBlock, []).filter((item) => AUDIO_EXT_RE.test(item.filename));
      if (audioFiles.length) {
        return audioFiles.slice().sort((a, b) => scoreAudioFile(b) - scoreAudioFile(a))[0];
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Timed out waiting for Stable Audio output.");
}

async function runComfyMusic(graph: any) {
  const errors: string[] = [];

  for (const baseUrl of comfyBaseUrlCandidates()) {
    try {
      const promptId = await submitPrompt(baseUrl, graph);
      const file = await pollHistoryForAudio(baseUrl, promptId);
      return { baseUrl, promptId, file };
    } catch (error) {
      errors.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No ComfyUI target produced music. ${errors.join(" | ")}`);
}

async function copyComfyAudioToLocal(baseUrl: string, file: HistoryFile, title: string) {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });

  const params = new URLSearchParams();
  params.set("filename", file.filename);
  params.set("type", file.type || "output");
  if (file.subfolder) params.set("subfolder", file.subfolder);

  const response = await fetch(`${baseUrl}/view?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not fetch generated music from ComfyUI (${response.status}).`);
  }

  const ext = path.extname(file.filename) || ".mp3";
  const localName = `${safeName(title)}_${Date.now()}${ext}`;
  const localPath = path.join(OUTPUT_DIR, localName);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(localPath, bytes);
  return { localName, localPath, sizeBytes: bytes.length };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const name = safeName(url.searchParams.get("name") || "");
  if (!name) return NextResponse.json({ ok: false, error: "Missing music name." }, { status: 400 });

  const filePath = path.join(OUTPUT_DIR, path.basename(name));
  if (!fs.existsSync(filePath)) return NextResponse.json({ ok: false, error: "Music file not found." }, { status: 404 });

  const bytes = await fsp.readFile(filePath);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".wav" ? "audio/wav" : ext === ".flac" ? "audio/flac" : ext === ".ogg" ? "audio/ogg" : "audio/mpeg";
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) return NextResponse.json({ ok: false, error: "Music prompt is required." }, { status: 400 });

    const durationSeconds = clampDuration(body?.durationSeconds);
    const title = safeName(body?.title || "assembly_background_music");

    const workflow = await loadWorkflow();
    const graph = patchWorkflow(workflow, { prompt, durationSeconds, title });
    const result = await runComfyMusic(graph);
    const local = await copyComfyAudioToLocal(result.baseUrl, result.file, title);

    return NextResponse.json({
      ok: true,
      prompt,
      durationSeconds,
      promptId: result.promptId,
      comfyBaseUrl: result.baseUrl,
      sourceFile: result.file,
      audioFileName: local.localName,
      musicFileName: local.localName,
      audioPath: local.localPath,
      musicPath: local.localPath,
      audioUrl: `/api/production/assembly-music?name=${encodeURIComponent(local.localName)}`,
      musicUrl: `/api/production/assembly-music?name=${encodeURIComponent(local.localName)}`,
      sizeBytes: local.sizeBytes,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Assembly music generation failed." },
      { status: 500 },
    );
  }
}
