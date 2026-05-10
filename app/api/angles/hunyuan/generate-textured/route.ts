import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_ROOT = process.cwd();
const HUNYUAN_URL = "http://127.0.0.1:8080";

const SEARCH_ROOTS = [
  "C:\\AI\\Hunyuan3D",
  "C:\\AI\\Hunyuan3D\\Hunyuan3D-2",
  "C:\\AI\\Angles3D",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJobId(value: string | null): string {
  const raw = value || `hunyuan-${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function walkGlbs(dir: string, maxDepth = 7): Promise<string[]> {
  if (maxDepth < 0) return [];

  let entries: any[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  let out: string[] = [];

  for (const e of entries) {
    const full = path.join(dir, e.name);

    if (e.isDirectory()) {
      const lower = e.name.toLowerCase();
      if (
        lower === ".git" ||
        lower === "__pycache__" ||
        lower === "python_standalone" ||
        lower === "huggingfacehub" ||
        lower === "node_modules"
      ) {
        continue;
      }
      out = out.concat(await walkGlbs(full, maxDepth - 1));
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".glb")) {
      out.push(full);
    }
  }

  return out;
}

async function findLatestGlb(afterMs: number) {
  const all: string[] = [];

  for (const root of SEARCH_ROOTS) {
    all.push(...(await walkGlbs(root)));
  }

  const rows = [];

  for (const file of all) {
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs >= afterMs - 2000) {
        rows.push({ file, mtimeMs: stat.mtimeMs, size: stat.size });
      }
    } catch {
      // ignore
    }
  }

  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows[0] || null;
}

function extractGlbCandidates(value: unknown): string[] {
  const out: string[] = [];

  const visit = (v: unknown) => {
    if (!v) return;

    if (typeof v === "string") {
      if (v.toLowerCase().includes(".glb")) out.push(v);
      return;
    }

    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }

    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      for (const key of ["path", "url", "name", "orig_name", "value"]) {
        visit(obj[key]);
      }
      for (const item of Object.values(obj)) visit(item);
    }
  };

  visit(value);
  return Array.from(new Set(out));
}

async function uploadToGradio(file: File) {
  const bytes = await file.arrayBuffer();
  const fd = new FormData();
  fd.append("files", new Blob([bytes], { type: file.type || "application/octet-stream" }), file.name || "input.png");

  const res = await fetch(`${HUNYUAN_URL}/upload`, {
    method: "POST",
    body: fd,
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    throw new Error(`Hunyuan upload failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();

  const first =
    Array.isArray(json) ? json[0] :
    Array.isArray(json?.files) ? json.files[0] :
    json;

  if (!first) {
    throw new Error(`Hunyuan upload returned no file object: ${JSON.stringify(json)}`);
  }

  if (typeof first === "string") {
    return {
      path: first,
      orig_name: file.name || "input.png",
      meta: { _type: "gradio.FileData" },
    };
  }

  return {
    ...first,
    orig_name: first.orig_name || file.name || "input.png",
    meta: first.meta || { _type: "gradio.FileData" },
  };
}

async function callGenerationAll(imageObject: unknown, prompt: string, seed: number) {
  const payload = {
    data: [
      prompt || "",
      imageObject,
      null,
      null,
      null,
      null,
      5,
      5,
      seed,
      256,
      true,
      8000,
      true,
    ],
    event_data: null,
    fn_index: 8,
    session_hash: `otg${Date.now().toString(36)}`,
    trigger_id: 19,
  };

  const endpoints = [
    `${HUNYUAN_URL}/run/predict`,
    `${HUNYUAN_URL}/api/predict`,
  ];

  let lastError = "";

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(900000),
      });

      const text = await res.text();

      if (!res.ok) {
        lastError = `${endpoint} failed: ${res.status} ${text}`;
        continue;
      }

      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    } catch (err) {
      lastError = `${endpoint} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  throw new Error(lastError || "Hunyuan generation failed.");
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  try {
    const form = await req.formData();
    const image = form.get("image");
    const prompt = String(form.get("prompt") || "");
    const jobId = safeJobId(String(form.get("jobId") || "") || null);
    const seedRaw = Number(form.get("seed"));
    const seed = Number.isFinite(seedRaw) && seedRaw > 0 ? Math.floor(seedRaw) : Math.floor(Math.random() * 9999999);

    if (!(image instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing multipart image file field named image." }, { status: 400 });
    }

    const outDir = path.join(REPO_ROOT, "data", "tmp", "angles_models", jobId);
    await ensureDir(outDir);

    const inputExt = path.extname(image.name || "input.png") || ".png";
    const inputPath = path.join(outDir, `input${inputExt}`);
    await fs.writeFile(inputPath, Buffer.from(await image.arrayBuffer()));

    const uploadedImageObject = await uploadToGradio(image);
    const generationResult = await callGenerationAll(uploadedImageObject, prompt, seed);

    const directCandidates = extractGlbCandidates(generationResult);

    let sourceGlb: string | null = null;

    for (const candidate of directCandidates) {
      const maybePath = candidate.replace(/^file=/, "");
      try {
        await fs.stat(maybePath);
        sourceGlb = maybePath;
        break;
      } catch {
        // Some Gradio URLs are not local paths; fallback to scanner.
      }
    }

    if (!sourceGlb) {
      for (let i = 0; i < 180; i++) {
        const latest = await findLatestGlb(startedAt);
        if (latest) {
          sourceGlb = latest.file;
          break;
        }
        await sleep(2000);
      }
    }

    if (!sourceGlb) {
      return NextResponse.json(
        {
          ok: false,
          error: "Hunyuan generation finished, but no new GLB was found.",
          generationResult,
          directCandidates,
        },
        { status: 504 }
      );
    }

    const outputGlb = path.join(outDir, "hunyuan_textured.glb");
    await fs.copyFile(sourceGlb, outputGlb);

    return NextResponse.json({
      ok: true,
      jobId,
      seed,
      sourceGlb,
      outputGlb,
      modelUrl: `/api/angles/hunyuan/model-file?jobId=${encodeURIComponent(jobId)}`,
      generationResult,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        hint: "Make sure Hunyuan is running on 127.0.0.1:8080 using tools\\angles\\start-hunyuan-texture-server.ps1.",
      },
      { status: 500 }
    );
  }
}
