import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export type ComfyFileRef = { filename: string; subfolder?: string; type?: string };

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : (fallback ?? "");
}

function normalizeBaseUrl(u: string): string {
  return (u || "").trim().replace(/\/+$/, "") || "http://127.0.0.1:8188";
}

export function comfyBaseUrl(): string {
  return normalizeBaseUrl(env("COMFY_BASE_URL", env("COMFY_URL", "http://127.0.0.1:8188")) || "http://127.0.0.1:8188");
}

function pickBaseUrl(override?: string): string {
  return normalizeBaseUrl(override || comfyBaseUrl());
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e: any) {
    // "fetch failed" is too opaque; include URL.
    throw new Error(`Fetch failed: ${url}${e?.message ? ` (${e.message})` : ""}`);
  }
}

export function resolveWorkflowRoot(): string {
  const root = env(
    "OTG_WORKFLOWS_ROOT",
    env("COMFY_WORKFLOWS_DIR", env("COMFY_WORKFLOWS_ROOT", path.join(process.cwd(), "comfy_workflows")))
  );
  return path.resolve(root);
}

export async function readWorkflowJson(relPathFromRoot: string): Promise<any> {
  const root = resolveWorkflowRoot();
  const candidate = path.join(root, relPathFromRoot);
  if (!fs.existsSync(candidate)) {
    // fallback to repo-local comfy_workflows
    const fallback = path.join(process.cwd(), "comfy_workflows", relPathFromRoot);
    if (!fs.existsSync(fallback)) throw new Error(`Workflow not found: ${relPathFromRoot}`);
    return JSON.parse(await fsp.readFile(fallback, "utf8"));
  }
  return JSON.parse(await fsp.readFile(candidate, "utf8"));
}

export async function uploadFileToComfy(absPath: string, fieldName = "image", baseUrlOverride?: string): Promise<string> {
  const base = pickBaseUrl(baseUrlOverride);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);
  const buf = await fsp.readFile(absPath);
  const filename = path.basename(absPath);

  const fd = new FormData();
  fd.append(fieldName, new Blob([buf]), filename);
  fd.append("overwrite", "true");

  // Most Comfy installs accept non-image files via /upload/image (it stores into input).
  // If a specific install rejects, try /upload/audio.
  const tryUpload = async (url: string) => {
    const r = await safeFetch(url, { method: "POST", body: fd as any });
    const text = await r.text();
    if (!r.ok) return { ok: false as const, status: r.status, text };
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const name = json?.name || json?.filename;
    if (!name) return { ok: false as const, status: r.status, text: `Upload did not return filename: ${text}` };
    return { ok: true as const, name: String(name) };
  };

  const r1 = await tryUpload(`${base}/upload/image`);
  if (r1.ok) return r1.name;

  const r2 = await tryUpload(`${base}/upload/audio`);
  if (r2.ok) return r2.name;

  throw new Error(`Comfy upload failed (${r1.status}) @ ${base}. ${r1.text.slice(0, 240)}`);
}

export async function submitWorkflow(workflow: any, clientId: string, baseUrlOverride?: string): Promise<string> {
  const base = pickBaseUrl(baseUrlOverride);
  const r = await safeFetch(`${base}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Comfy /prompt failed (${r.status}) @ ${base}: ${JSON.stringify(json)}`);
  const pid = json?.prompt_id ?? json?.promptId;
  if (!pid) throw new Error(`Comfy /prompt did not return prompt_id @ ${base}: ${JSON.stringify(json)}`);
  return String(pid);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function extractAudioFromHistory(record: any): ComfyFileRef[] {
  const out: ComfyFileRef[] = [];
  const outputs = record?.outputs;
  if (!outputs || typeof outputs !== "object") return out;

  for (const k of Object.keys(outputs)) {
    const node = outputs[k];

    const take = (arr: any[]) => {
      for (const it of arr) {
        if (!it) continue;
        const filename = it.filename || it.name;
        if (!filename) continue;
        out.push({
          filename: String(filename),
          subfolder: it.subfolder ? String(it.subfolder) : "",
          type: it.type ? String(it.type) : "output",
        });
      }
    };

    if (Array.isArray(node?.audio)) take(node.audio);
    if (Array.isArray(node?.audios)) take(node.audios);

    // Some nodes may store single audio object.
    if (node?.audio && typeof node.audio === "object" && !Array.isArray(node.audio)) {
      const it = node.audio;
      if (it?.filename)
        out.push({
          filename: String(it.filename),
          subfolder: it.subfolder ? String(it.subfolder) : "",
          type: it.type ? String(it.type) : "output",
        });
    }
  }

  return out;
}

export async function waitForAudio(promptId: string, timeoutMs = 180_000, baseUrlOverride?: string): Promise<ComfyFileRef> {
  const base = pickBaseUrl(baseUrlOverride);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const r = await safeFetch(`${base}/history/${encodeURIComponent(promptId)}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const rec = j?.[promptId] || j;
      const aud = extractAudioFromHistory(rec);
      if (aud.length) return aud[0];
    }
    await sleep(700);
  }

  throw new Error(`Timed out waiting for audio output @ ${base}`);
}

export async function fetchComfyViewBytes(f: ComfyFileRef, baseUrlOverride?: string): Promise<Buffer> {
  const base = pickBaseUrl(baseUrlOverride);
  const filename = encodeURIComponent(f.filename);
  const type = encodeURIComponent(f.type || "output");
  const subfolder = encodeURIComponent(f.subfolder || "");
  const url = `${base}/view?filename=${filename}&type=${type}&subfolder=${subfolder}`;

  const r = await safeFetch(url, { cache: "no-store" });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Comfy /view failed (${r.status}) @ ${base}: ${txt.slice(0, 200)}`);
  }
  return Buffer.from(await r.arrayBuffer());
}
